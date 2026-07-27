"""Single-vCPU, single-frame benchmark: YOLO (ONNX Runtime) + MediaPipe, sequential.

Measures how long ONE frame takes to evaluate on a process pinned to a
single CPU core, simulating a 1-vCPU server instance.

Runs MediaPipe then YOLO sequentially in the same thread, matching how
app.py's analyze_request() actually processes a frame today (MediaPipe
face/gaze, then YOLO phone detection, one after another inside a single
worker thread — app.py's concurrency comes from its ThreadPoolExecutor
handling multiple different frames at once, not from parallelizing a
single frame's own model calls). Running the two concurrently in earlier
versions of this script added artificial thread-contention overhead on
the pinned core that doesn't reflect production behavior.

YOLO runs through ONNX Runtime rather than raw PyTorch. PyTorch's CPU wheels
link against Intel MKL, which detects non-"GenuineIntel" CPUs and silently
falls back to an unoptimized codepath — on AMD droplets this alone can cause
a 5-10x slowdown. ONNX Runtime's CPU execution provider (MLAS) does not have
this penalty, so it gives a realistic cross-vendor CPU timing.

- MediaPipe: FaceDetection + FaceMesh for face count and gaze-away detection.
- YOLO (.onnx): full 80-class COCO detection. Its returned JSON is fed
  through a rule-based classifier (phone / laptop / book / extra person /
  extra display / other electronics).

Export a .pt model to ONNX once before running this script:
    yolo export model=yolov8n.pt format=onnx imgsz=640
    yolo export model=yolo26n.pt format=onnx imgsz=640

Usage:
    python benchmark_single_frame.py --image test.jpg
    python benchmark_single_frame.py --camera 0 --iterations 30
    python benchmark_single_frame.py --image test.jpg --core 0 --yolo-model yolov8n.onnx
"""

import argparse
import ctypes
import json
import os
import statistics
import time
from typing import Any, Dict, List, Tuple

# Must be set before numpy/torch/opencv/mediapipe import to actually take effect —
# these libs read thread-pool size from env at import/first-use time.
for _var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_var] = "1"
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import mediapipe as mp  # noqa: E402

cv2.setNumThreads(1)

try:
    import torch  # noqa: E402
    torch.set_num_threads(1)
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass  # must be called before any parallel work has started; ignore if too late
except Exception:
    torch = None

from ultralytics import YOLO  # noqa: E402

try:
    import onnxruntime as ort  # noqa: E402
except ImportError:
    ort = None


# --------------------------------------------------------------------------
# CPU affinity — pin the whole process to a single logical core so timings
# reflect a real 1-vCPU deployment rather than this dev machine's full core count.
# --------------------------------------------------------------------------
def pin_to_single_cpu(core: int) -> str:
    try:
        import psutil
        psutil.Process().cpu_affinity([core])
        return f"pinned via psutil -> core {core}"
    except Exception:
        pass
    try:
        if hasattr(os, "sched_setaffinity"):
            os.sched_setaffinity(0, {core})
            return f"pinned via os.sched_setaffinity -> core {core}"
    except Exception:
        pass
    try:
        if os.name == "nt":
            mask = 1 << core
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            ok = ctypes.windll.kernel32.SetProcessAffinityMask(handle, mask)
            if ok:
                return f"pinned via SetProcessAffinityMask -> core {core}"
    except Exception:
        pass
    return "could NOT pin CPU affinity (psutil not installed / unsupported OS) — running unpinned"


# --------------------------------------------------------------------------
# Rule-based classification, applied to YOLO's own returned JSON.
# Mirrors the categories app.py already tracks in `stats`
# (personCount, phoneCount, displayCount, bookCount, laptopCount, electronicCount).
# --------------------------------------------------------------------------
CLASS_CATEGORY: Dict[str, str] = {
    "person": "person",
    "cell phone": "phone",
    "laptop": "laptop",
    "book": "book",
    "tv": "display",
    "keyboard": "electronic",
    "mouse": "electronic",
    "remote": "electronic",
}

MAX_ALLOWED = {
    "person": 1,
    "display": 1,
    "laptop": 1,
}


def classify_from_json(detections_json: str, conf_threshold: float) -> Tuple[Dict[str, int], List[Dict[str, Any]]]:
    """Parse YOLO's returned detections JSON and apply rule-based classification."""
    try:
        detections = json.loads(detections_json)
    except Exception:
        detections = []

    counts: Dict[str, int] = {"person": 0, "phone": 0, "laptop": 0, "book": 0, "display": 0, "electronic": 0}
    for det in detections:
        conf = float(det.get("confidence", 0.0))
        if conf < conf_threshold:
            continue
        name = str(det.get("name", "")).lower().strip()
        category = CLASS_CATEGORY.get(name)
        if category:
            counts[category] += 1

    violations: List[Dict[str, Any]] = []
    if counts["person"] == 0:
        violations.append({"eventType": "no_person_detected", "severity": "high"})
    elif counts["person"] > MAX_ALLOWED["person"]:
        violations.append({"eventType": "multiple_people_detected", "severity": "critical", "count": counts["person"]})
    if counts["phone"] > 0:
        violations.append({"eventType": "phone_detected", "severity": "critical", "count": counts["phone"]})
    if counts["laptop"] > MAX_ALLOWED["laptop"]:
        violations.append({"eventType": "extra_laptop_detected", "severity": "medium", "count": counts["laptop"]})
    if counts["book"] > 0:
        violations.append({"eventType": "book_detected", "severity": "medium", "count": counts["book"]})
    if counts["display"] > MAX_ALLOWED["display"]:
        violations.append({"eventType": "extra_display_detected", "severity": "high", "count": counts["display"]})
    if counts["electronic"] > 0:
        violations.append({"eventType": "unauthorized_electronic_device", "severity": "medium", "count": counts["electronic"]})

    return counts, violations


# --------------------------------------------------------------------------
# MediaPipe: face count + gaze-away, same logic/thresholds as app.py.
# --------------------------------------------------------------------------
GAZE_LEFT_RIGHT_THRESHOLD = 0.35

_face_detector = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.65)
_face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=False,
    max_num_faces=3,
    refine_landmarks=False,
    min_detection_confidence=0.65,
    min_tracking_confidence=0.65,
)


def evaluate_mediapipe(img_bgr: np.ndarray) -> Dict[str, Any]:
    t0 = time.perf_counter()
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    det_count = 0
    det_result = _face_detector.process(rgb)
    if det_result and det_result.detections:
        det_count = len(det_result.detections)

    mesh_count = 0
    mesh_result = _face_mesh.process(rgb)
    if mesh_result and mesh_result.multi_face_landmarks:
        mesh_count = len(mesh_result.multi_face_landmarks)

    if det_count == 0 and mesh_count == 0:
        face_count = 0
    elif det_count == 0 or mesh_count == 0:
        face_count = min(max(det_count, mesh_count), 1)
    else:
        face_count = min(det_count, mesh_count)

    looking_at_screen, gaze_direction = True, "unknown"
    if mesh_result and mesh_result.multi_face_landmarks:
        lm = mesh_result.multi_face_landmarks[0].landmark
        left_eye, right_eye, nose = lm[33], lm[263], lm[1]
        eye_width = abs(right_eye.x - left_eye.x)
        if eye_width >= 1e-5:
            rel_x = (nose.x - (left_eye.x + right_eye.x) / 2.0) / eye_width
            if rel_x < -GAZE_LEFT_RIGHT_THRESHOLD:
                looking_at_screen, gaze_direction = False, "left"
            elif rel_x > GAZE_LEFT_RIGHT_THRESHOLD:
                looking_at_screen, gaze_direction = False, "right"
            else:
                looking_at_screen, gaze_direction = True, "center"

    violations: List[Dict[str, Any]] = []
    if face_count == 0:
        violations.append({"eventType": "face_not_detected", "severity": "high"})
    elif face_count > 1:
        violations.append({"eventType": "multiple_faces", "severity": "critical", "count": face_count})
    elif not looking_at_screen:
        violations.append({"eventType": "looking_away", "severity": "medium", "direction": gaze_direction})

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return {
        "faceCount": face_count,
        "lookingAtScreen": looking_at_screen,
        "gazeDirection": gaze_direction,
        "violations": violations,
        "elapsedMs": elapsed_ms,
    }


# --------------------------------------------------------------------------
# YOLO (ONNX Runtime): full detection + rule-based classification of the returned JSON.
# --------------------------------------------------------------------------
def evaluate_yolo(img_bgr: np.ndarray, model: YOLO, conf_threshold: float) -> Dict[str, Any]:
    t0 = time.perf_counter()
    # device="cpu" forces CPU execution even if a GPU-capable onnxruntime/torch
    # build happens to be installed — this benchmark is measuring CPU-only timing.
    results = model.predict(img_bgr, verbose=False, conf=conf_threshold, iou=0.45, max_det=50, device="cpu")
    if results:
        result = results[0]
        detections_json = result.to_json() if hasattr(result, "to_json") else result.tojson()
    else:
        detections_json = "[]"
    counts, violations = classify_from_json(detections_json, conf_threshold)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return {
        "counts": counts,
        "violations": violations,
        "rawJson": detections_json,
        "elapsedMs": elapsed_ms,
    }


def load_frame(args: argparse.Namespace) -> np.ndarray:
    if args.camera is not None:
        cap = cv2.VideoCapture(args.camera)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open camera {args.camera}")
        ok, frame = cap.read()
        cap.release()
        if not ok:
            raise RuntimeError("Failed to read a frame from camera")
    else:
        frame = cv2.imread(args.image)
        if frame is None:
            raise RuntimeError(f"Cannot read image: {args.image}")

    h, w = frame.shape[:2]
    if w > args.max_width:
        scale = args.max_width / float(w)
        frame = cv2.resize(frame, (args.max_width, int(h * scale)), interpolation=cv2.INTER_AREA)
    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description="Single-vCPU, single-frame YOLO (ONNX Runtime) + MediaPipe sequential benchmark")
    parser.add_argument("--image", default="test.jpg", help="path to a still image to benchmark against")
    parser.add_argument("--camera", type=int, default=None, help="use a live camera index instead of --image")
    parser.add_argument(
        "--yolo-model",
        default="yolov8n.onnx",
        help="ONNX weights file, e.g. yolov8n.onnx or yolo26n.onnx (export with: yolo export model=<x>.pt format=onnx)",
    )
    parser.add_argument("--conf", type=float, default=0.35, help="confidence threshold for detections")
    parser.add_argument("--max-width", type=int, default=640, help="resize frame to this width before inference")
    parser.add_argument("--iterations", type=int, default=20, help="timed iterations")
    parser.add_argument("--warmup", type=int, default=3, help="untimed warmup iterations")
    parser.add_argument("--core", type=int, default=0, help="logical CPU core to pin this process to")
    parser.add_argument("--no-pin", action="store_true", help="skip CPU affinity pinning")
    args = parser.parse_args()

    print(f"[SETUP] cv2 threads = {cv2.getNumThreads()}")
    if torch is not None:
        print(f"[SETUP] torch threads = {torch.get_num_threads()}")
    if args.no_pin:
        print("[SETUP] CPU pinning skipped (--no-pin)")
    else:
        print(f"[SETUP] {pin_to_single_cpu(args.core)}")

    if args.yolo_model.endswith(".onnx"):
        if ort is None:
            raise RuntimeError("onnxruntime is not installed. Run: pip install onnxruntime")
        if not os.path.exists(args.yolo_model):
            raise FileNotFoundError(
                f"{args.yolo_model} not found. Export it first, e.g.:\n"
                f"  yolo export model={args.yolo_model[:-5]}.pt format=onnx imgsz={args.max_width}"
            )
        print(f"[SETUP] onnxruntime available providers: {ort.get_available_providers()}")

    print(f"[SETUP] loading YOLO model: {args.yolo_model}")
    model = YOLO(args.yolo_model, task="detect")

    frame = load_frame(args)
    print(f"[SETUP] frame size: {frame.shape[1]}x{frame.shape[0]}")

    print(f"[SETUP] warming up ({args.warmup} iterations)...")
    for _ in range(args.warmup):
        evaluate_mediapipe(frame)
        evaluate_yolo(frame, model, args.conf)

    if args.yolo_model.endswith(".onnx"):
        session = getattr(getattr(model.predictor, "model", None), "session", None)
        if session is not None:
            print(f"[SETUP] onnxruntime active providers: {session.get_providers()}")

    frame_ms: List[float] = []
    yolo_ms: List[float] = []
    mp_ms: List[float] = []
    last_yolo_res: Dict[str, Any] = {}
    last_mp_res: Dict[str, Any] = {}

    print(f"\n[RUN] {args.iterations} timed iterations ({args.yolo_model} then MediaPipe, sequential per frame)\n")
    for i in range(1, args.iterations + 1):
        t0 = time.perf_counter()
        mp_res = evaluate_mediapipe(frame)
        yolo_res = evaluate_yolo(frame, model, args.conf)
        wall_ms = (time.perf_counter() - t0) * 1000.0

        frame_ms.append(wall_ms)
        yolo_ms.append(yolo_res["elapsedMs"])
        mp_ms.append(mp_res["elapsedMs"])
        last_yolo_res, last_mp_res = yolo_res, mp_res

        print(
            f"  iter={i:02d}  frame_total={wall_ms:7.2f}ms  "
            f"(mediapipe={mp_res['elapsedMs']:7.2f}ms  yolo={yolo_res['elapsedMs']:7.2f}ms)  "
            f"faces={mp_res['faceCount']}  gaze={mp_res['gazeDirection']}  "
            f"yolo_violations={[v['eventType'] for v in yolo_res['violations']]}"
        )

    print("\n" + "=" * 72)
    print("SUMMARY — time to evaluate ONE frame on this (pinned) vCPU")
    print("=" * 72)
    model_label = args.yolo_model.ljust(14)
    print(f"{model_label} avg={statistics.mean(yolo_ms):7.2f}ms  min={min(yolo_ms):7.2f}ms  max={max(yolo_ms):7.2f}ms  median={statistics.median(yolo_ms):7.2f}ms")
    print(f"MediaPipe      avg={statistics.mean(mp_ms):7.2f}ms  min={min(mp_ms):7.2f}ms  max={max(mp_ms):7.2f}ms  median={statistics.median(mp_ms):7.2f}ms")
    print(f"Frame total    avg={statistics.mean(frame_ms):7.2f}ms  min={min(frame_ms):7.2f}ms  max={max(frame_ms):7.2f}ms  median={statistics.median(frame_ms):7.2f}ms")
    print(f"Effective max single-frame throughput: {1000.0 / statistics.mean(frame_ms):.2f} frames/sec on this vCPU")

    print("\n" + "-" * 72)
    print(f"Last frame — {args.yolo_model} rule-based classification (from returned JSON):")
    print(json.dumps({"counts": last_yolo_res.get("counts"), "violations": last_yolo_res.get("violations")}, indent=2))
    print("\nLast frame — MediaPipe face/gaze evaluation:")
    print(json.dumps(
        {k: v for k, v in last_mp_res.items() if k != "elapsedMs"},
        indent=2,
    ))


if __name__ == "__main__":
    main()
