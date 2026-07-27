"""Static INT8 quantization for a YOLO ONNX export, via ONNX Runtime.

Dynamic quantization (quantize_dynamic) mostly speeds up MatMul/Gemm ops and
barely touches Conv layers -- which is where ~95%+ of YOLO's compute lives.
Static quantization calibrates activation ranges against real sample images
and quantizes Conv weights + activations to int8, which is what actually
gives the 1.5-3x CPU speedup on CNN-style detection models.

Usage:
    python quantize_yolo.py --model yolov8n.onnx --output yolov8n.int8.onnx
    python quantize_yolo.py --model yolo26n.onnx --output yolo26n.int8.onnx --calib-dir calib_images/

Then benchmark the quantized model exactly like any other:
    python benchmark_single_frame.py --image test.jpg --yolo-model yolov8n.int8.onnx

Accuracy note: calibration quality depends on how representative the sample
images are. Passing --calib-dir with a folder of real, varied frames (different
lighting, distances, backgrounds) gives a far more reliable quantized model
than calibrating off a single image -- especially for the small "cell phone"
class, which is the most sensitive to any accuracy loss here.
"""

import argparse
import glob
import os
from typing import List, Optional

import cv2
import numpy as np
from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
import onnxruntime as ort


def letterbox(img: np.ndarray, new_size: int, color: tuple = (114, 114, 114)) -> np.ndarray:
    """Resize + pad to a square input, preserving aspect ratio (standard YOLO preprocessing)."""
    h, w = img.shape[:2]
    scale = min(new_size / h, new_size / w)
    new_unpad = (int(round(w * scale)), int(round(h * scale)))
    resized = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)
    dw, dh = new_size - new_unpad[0], new_size - new_unpad[1]
    top, bottom = dh // 2, dh - dh // 2
    left, right = dw // 2, dw - dw // 2
    return cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)


class YoloCalibrationDataReader(CalibrationDataReader):
    def __init__(self, image_paths: List[str], input_name: str, imgsz: int):
        self.input_name = input_name
        self.imgsz = imgsz
        self._paths = iter(image_paths)

    def get_next(self) -> Optional[dict]:
        path = next(self._paths, None)
        if path is None:
            return None
        img = cv2.imread(path)
        if img is None:
            return self.get_next()
        img = letterbox(img, self.imgsz)
        blob = cv2.dnn.blobFromImage(img, scalefactor=1.0 / 255.0, size=(self.imgsz, self.imgsz), swapRB=True, crop=False)
        return {self.input_name: blob.astype(np.float32)}


def collect_calibration_images(args: argparse.Namespace) -> List[str]:
    if args.calib_dir:
        paths = sorted(
            p for ext in ("*.jpg", "*.jpeg", "*.png") for p in glob.glob(os.path.join(args.calib_dir, ext))
        )
        if not paths:
            raise RuntimeError(f"No .jpg/.jpeg/.png images found in {args.calib_dir}")
        return paths

    print(
        "[WARN] No --calib-dir given, calibrating off a single image "
        f"({args.image}). This works but is a weak calibration set -- for "
        "production accuracy, pass --calib-dir pointing at a folder of "
        "varied real frames (different distances/lighting/backgrounds)."
    )
    if not os.path.exists(args.image):
        raise FileNotFoundError(f"Calibration image not found: {args.image}")
    return [args.image]


def main() -> None:
    parser = argparse.ArgumentParser(description="Static INT8 quantization for a YOLO ONNX export")
    parser.add_argument("--model", required=True, help="input fp32 .onnx model, e.g. yolov8n.onnx")
    parser.add_argument("--output", default=None, help="output path (default: <model>.int8.onnx)")
    parser.add_argument("--calib-dir", default=None, help="folder of calibration images (recommended)")
    parser.add_argument("--image", default="test.jpg", help="single fallback calibration image if no --calib-dir")
    parser.add_argument("--imgsz", type=int, default=640, help="model input size (must match the export imgsz)")
    args = parser.parse_args()

    if not os.path.exists(args.model):
        raise FileNotFoundError(f"{args.model} not found")
    output_path = args.output or args.model.replace(".onnx", ".int8.onnx")

    input_name = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"]).get_inputs()[0].name

    calib_images = collect_calibration_images(args)
    print(f"[SETUP] calibrating with {len(calib_images)} image(s), input='{input_name}', imgsz={args.imgsz}")
    reader = YoloCalibrationDataReader(calib_images, input_name, args.imgsz)

    print(f"[RUN] quantizing {args.model} -> {output_path} ...")
    quantize_static(
        model_input=args.model,
        model_output=output_path,
        calibration_data_reader=reader,
        quant_format=QuantFormat.QDQ,
        per_channel=True,
        weight_type=QuantType.QInt8,
        activation_type=QuantType.QInt8,
    )

    orig_mb = os.path.getsize(args.model) / (1024 * 1024)
    quant_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[DONE] {args.model}: {orig_mb:.2f} MB -> {output_path}: {quant_mb:.2f} MB")
    print(f"\nBenchmark it:\n  python benchmark_single_frame.py --image {args.image} --yolo-model {output_path}")


if __name__ == "__main__":
    main()
