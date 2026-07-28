"""
Optimized full AI-proctoring pipeline replica, driven by an uploaded video file.

CHANGES FROM THE PREVIOUS VERSION (why this one is faster, same accuracy):

1. Object detection no longer goes through Ultralytics' YOLO() / model.predict().
   It talks to onnxruntime.InferenceSession directly. This removes:
     - Ultralytics' AutoBackend building its own ORT session with DEFAULT
       thread settings (which, under a single-core CPU pin, causes ORT's
       internal thread pool to contend with itself on that one core).
       This build sets intra_op_num_threads=1, inter_op_num_threads=1,
       ORT_SEQUENTIAL explicitly -> no contention, no oversubscription.
     - torch as a dependency entirely. NMS is done with cv2.dnn.NMSBoxes
       (pure C++, single-threaded, no GIL/tensor overhead) instead of
       torchvision.ops.nms.
     - Note: scanning all 80 COCO classes costs essentially the same as
       scanning one, since the model's forward pass produces every class's
       score in a single tensor regardless. What actually varies with class/
       object count is postprocessing (thresholding + NMS), and NMS only
       runs for classes that have a surviving candidate box in a given
       frame — so a typical sparse exam-desk frame costs almost nothing
       extra for scanning all 80 vs. just 4.

2. MediaPipe pipeline (FaceDetection + FaceMesh consensus, gaze) is
   UNCHANGED — per your own measurements its cost wasn't the problem, and
   it's the part that actually needs both models for the consensus logic.

3. Sequential per-frame processing is kept sequential (camera-blocked check
   -> face pipeline -> object detection), on purpose. On a single vCPU,
   wrapping this in threading does not parallelize anything (there's no
   second core to schedule onto) — it only adds context-switch and cache-
   thrashing overhead. Threading here would make things slower, not faster.

ALL-CLASS OBJECT DETECTION (with a violation-triggering subset):
   Every frame is scanned across all 80 standard COCO classes and every
   detected object is logged (response["objects"], stats.allDetectedClasses)
   for audit/evidence purposes. Only the classes configured in
   VIOLATION_CLASSES below actually raise a proctoring violation — currently
   cell phone, book, laptop, tv/monitor. Each has its own confidence + min-
   area threshold and its own independent emit cooldown.

   IMPORTANT CAVEAT: standard COCO (what stock YOLO/YOLO26 .pt weights are
   trained on) has NO "calculator" class. There is no COCO class that maps
   to it. Options if calculator detection is a hard requirement:
     (a) fine-tune/train a small custom detector on a calculator class and
         export that separately alongside the COCO model, merging results, or
     (b) accept a heuristic proxy (e.g. flag small rectangular objects near
         the hands for manual review) knowing it will have real false-positive/
         false-negative rates since it's not actually recognizing calculators.
   This script does NOT fabricate a calculator class — CALCULATOR_CLASS_ID
   is left as a config slot you can wire up once you have a model that
   actually has one.

Violation state machine, cooldown logic, evidence saving, and CLI are
otherwise unchanged from the previous version.

Export ONNX weights once before running (still needs ultralytics installed,
but only as a one-time CLI export tool -- not imported by this script):
    yolo export model=yolov8n.pt format=onnx imgsz=640
    yolo export model=yolo26n.pt format=onnx imgsz=640

Usage:
    python video_proctoring_test.py --video session.mp4 --yolo-model yolov8n.onnx
    python video_proctoring_test.py --video session.mp4 --yolo-model yolov8n.onnx yolo26n.onnx
    python video_proctoring_test.py --video session.mp4 --yolo-model yolov8n.onnx --interval 3.0 --output-dir violation_evidence
"""

import argparse
import ctypes
import json
import os
import statistics
import time
from typing import Any, Dict, List, Optional, Tuple

for _var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_var, "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


def _load_dotenv() -> None:
    """Load .env from this directory, exactly like app.py does — so this
    replica honors the same threshold/config overrides production uses."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, raw_val = line.partition("=")
            key = key.strip()
            raw_val = raw_val.strip()
            if raw_val.startswith(('"', "'")):
                raw_val = raw_val[1:-1]
            if key and key not in os.environ:
                os.environ[key] = raw_val


_load_dotenv()

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import mediapipe as mp  # noqa: E402

cv2.setNumThreads(1)

try:
    import onnxruntime as ort  # noqa: E402
except ImportError:
    ort = None


# --------------------------------------------------------------------------
# CPU affinity — simulate a single-vCPU production box.
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
            if ctypes.windll.kernel32.SetProcessAffinityMask(handle, mask):
                return f"pinned via SetProcessAffinityMask -> core {core}"
    except Exception:
        pass
    return "could NOT pin CPU affinity — running unpinned"


# --------------------------------------------------------------------------
# Constants — copied verbatim from app.py.
# --------------------------------------------------------------------------
def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except Exception:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


VIOLATION_COOLDOWN_SECONDS = _env_float("VIOLATION_COOLDOWN_SECONDS", 3.0)
NO_FACE_SECONDS = _env_float("NO_FACE_SECONDS", 5.0)
MULTI_FACE_SECONDS = _env_float("MULTI_FACE_SECONDS", 3.0)
LOOK_AWAY_SECONDS = _env_float("LOOK_AWAY_SECONDS", 3.0)
OBJECT_EMIT_COOLDOWN_SECONDS = _env_float("OBJECT_EMIT_COOLDOWN_SECONDS", 3.0)
CAMERA_BLOCKED_SECONDS = _env_float("CAMERA_BLOCKED_SECONDS", 1.2)
FACE_MIN_CONF = _env_float("FACE_MIN_CONF", 0.45)
GAZE_LEFT_RIGHT_THRESHOLD = _env_float("GAZE_LEFT_RIGHT_THRESHOLD", 0.35)
CAMERA_BLOCKED_DARK_THRESHOLD = _env_float("CAMERA_BLOCKED_DARK_THRESHOLD", 18.0)
CAMERA_BLOCKED_UNIFORM_THRESHOLD = _env_float("CAMERA_BLOCKED_UNIFORM_THRESHOLD", 8.0)
CV_INFERENCE_MAX_WIDTH = _env_int("CV_INFERENCE_MAX_WIDTH", 640)

# --------------------------------------------------------------------------
# Full standard COCO 80-class list (index == model class id). The model's
# forward pass computes scores for ALL of these in a single tensor
# regardless of how many we act on, so scanning all 80 costs essentially
# nothing extra at the inference stage — only postprocessing (thresholding +
# NMS) scales with candidate box count, not class count, and NMS is only run
# for classes that actually have a candidate box in a given frame.
# --------------------------------------------------------------------------
COCO_CLASS_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator",
    "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]

# --------------------------------------------------------------------------
# VIOLATION_CLASSES — the subset of the 80 classes that actually raise a
# proctoring violation. Everything else in COCO_CLASS_NAMES still gets
# detected and logged (see GENERIC_* thresholds below and the "objects"
# field in analyze_frame's response) for audit purposes, but does not by
# itself trigger a violation event.
#   label            display name used in violation descriptions/objects
#   event_type       violation event name (must appear in CV_ENABLED_EVENTS
#                    to actually be emitted — same opt-in gate as app.py)
#   severity         "critical" | "high" | "medium" | "low"
#   conf             per-class confidence threshold
#   min_area_ratio   per-class minimum box-area / frame-area ratio (filters
#                    out tiny spurious detections; phones are small in
#                    frame so this is much lower than for a laptop/book)
#
# NOTE: there is no "calculator" class in COCO. CALCULATOR_CLASS_ID is left
# unset — wire it up once you have a model that was actually trained with
# that class (see module docstring for options).
# --------------------------------------------------------------------------
CALCULATOR_CLASS_ID = _env_int("CALCULATOR_CLASS_ID", -1)  # -1 = disabled, no COCO class exists for this

VIOLATION_CLASSES: Dict[int, Dict[str, Any]] = {
    67: {  # cell phone
        "label": "cell phone",
        "event_type": "phone_detected",
        "severity": "critical",
        "conf": _env_float("PHONE_CONF", 0.35),
        "min_area_ratio": _env_float("PHONE_MIN_AREA_RATIO", 0.00005),
    },
    73: {  # book
        "label": "book",
        "event_type": "book_detected",
        "severity": "medium",
        "conf": _env_float("BOOK_CONF", 0.40),
        "min_area_ratio": _env_float("BOOK_MIN_AREA_RATIO", 0.001),
    },
    63: {  # laptop — a second computer/device on the desk
        "label": "laptop",
        "event_type": "secondary_device_detected",
        "severity": "high",
        "conf": _env_float("LAPTOP_CONF", 0.40),
        "min_area_ratio": _env_float("LAPTOP_MIN_AREA_RATIO", 0.01),
    },
    62: {  # tv — used as the closest COCO stand-in for "extra monitor/display"
        "label": "tv/monitor",
        "event_type": "extra_display_detected",
        "severity": "high",
        "conf": _env_float("DISPLAY_CONF", 0.40),
        "min_area_ratio": _env_float("DISPLAY_MIN_AREA_RATIO", 0.01),
    },
}
if CALCULATOR_CLASS_ID >= 0:
    VIOLATION_CLASSES[CALCULATOR_CLASS_ID] = {
        "label": "calculator",
        "event_type": "calculator_detected",
        "severity": "medium",
        "conf": _env_float("CALCULATOR_CONF", 0.40),
        "min_area_ratio": _env_float("CALCULATOR_MIN_AREA_RATIO", 0.0005),
    }

# Thresholds applied to every OTHER COCO class (the ~76 not in
# VIOLATION_CLASSES) purely for informational logging/evidence — these
# never raise a violation regardless of CV_ENABLED_EVENTS.
GENERIC_OBJECT_CONF = _env_float("GENERIC_OBJECT_CONF", 0.45)
GENERIC_OBJECT_MIN_AREA_RATIO = _env_float("GENERIC_OBJECT_MIN_AREA_RATIO", 0.001)

PHONE_IOU = _env_float("OBJECT_IOU", 0.45)  # shared NMS IoU threshold across all classes

CV_ENABLED_EVENTS = {
    x.strip()
    for x in os.getenv(
        "CV_ENABLED_EVENTS",
        "face_not_detected,multiple_faces,phone_detected,book_detected,"
        "secondary_device_detected,extra_display_detected",
    ).split(",")
    if x.strip()
}

_face_detector = mp.solutions.face_detection.FaceDetection(
    model_selection=1, min_detection_confidence=max(FACE_MIN_CONF, 0.65)
)
_face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=False,
    max_num_faces=3,
    refine_landmarks=False,
    min_detection_confidence=max(FACE_MIN_CONF, 0.65),
    min_tracking_confidence=max(FACE_MIN_CONF, 0.65),
)


# --------------------------------------------------------------------------
# ONNX Runtime multi-class object detector — direct session, no Ultralytics.
# --------------------------------------------------------------------------
class MultiClassDetectorONNX:
    """
    Thin, dependency-light wrapper around onnxruntime that scans all classes
    the model knows (all 80 for stock COCO weights) — the forward pass
    already computes every class's score in one tensor, so this costs the
    same as scanning one. Postprocessing (thresholding/NMS) only runs for
    classes with a surviving candidate box, so a typical sparse exam-desk
    frame stays cheap. See VIOLATION_CLASSES for which classes actually
    raise a violation vs. get logged for audit only.
    """

    def __init__(self, model_path: str, violation_classes: Dict[int, Dict[str, Any]] = VIOLATION_CLASSES):
        if ort is None:
            raise RuntimeError("onnxruntime is not installed. Run: pip install onnxruntime")
        if not model_path.endswith(".onnx"):
            raise ValueError(f"{model_path} is not a .onnx file — only ONNX Runtime models are supported here")
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"{model_path} not found. Export it first, e.g.:\n"
                f"  yolo export model={model_path[:-5]}.pt format=onnx imgsz={CV_INFERENCE_MAX_WIDTH}"
            )

        so = ort.SessionOptions()
        so.intra_op_num_threads = 1   # prevents ORT's own thread pool from
        so.inter_op_num_threads = 1   # oversubscribing a single pinned core
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.session = ort.InferenceSession(model_path, sess_options=so, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        in_shape = self.session.get_inputs()[0].shape
        # Fall back to 640 if the exported graph has a dynamic input dim
        h = in_shape[2] if isinstance(in_shape[2], int) else CV_INFERENCE_MAX_WIDTH
        w = in_shape[3] if isinstance(in_shape[3], int) else CV_INFERENCE_MAX_WIDTH
        self.imgsz = max(h, w)
        self.violation_classes = violation_classes

        # Diagnostic: the decode logic in detect() assumes a single output
        # tensor shaped (1, 4+nc, num_boxes) -- YOLOv8's classic raw-anchor
        # grid format. Models with a different export shape (e.g. an
        # NMS-free/end-to-end head that outputs already-decoded detections
        # as (1, num_dets, 6)) will silently produce garbage under that
        # assumption instead of erroring, since the decode just reads
        # whatever is at each tensor position. Print it so a shape mismatch
        # is visible immediately instead of showing up as bogus detections.
        outputs = self.session.get_outputs()
        print(f"[SETUP] {model_path} input shape={in_shape}  outputs=" + ", ".join(f"{o.name}:{o.shape}" for o in outputs))
        if len(outputs) != 1:
            print(f"[WARN] {model_path} has {len(outputs)} output tensors — detect() only reads outputs[0], results may be wrong")
        self.model_path = model_path

    @staticmethod
    def _letterbox(img: np.ndarray, new_size: int, color=(114, 114, 114)):
        h, w = img.shape[:2]
        r = min(new_size / h, new_size / w)
        new_unpad = (int(round(w * r)), int(round(h * r)))
        dw, dh = new_size - new_unpad[0], new_size - new_unpad[1]
        dw /= 2.0
        dh /= 2.0
        if (w, h) != new_unpad:
            img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
        img = cv2.copyMakeBorder(img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
        return img, r, dw, dh

    def _preprocess(self, img_bgr: np.ndarray):
        lb_img, ratio, dw, dh = self._letterbox(img_bgr, self.imgsz)
        rgb = cv2.cvtColor(lb_img, cv2.COLOR_BGR2RGB)
        blob = rgb.astype(np.float32) / 255.0
        blob = blob.transpose(2, 0, 1)[None]  # (1,3,H,W)
        blob = np.ascontiguousarray(blob)
        return blob, ratio, dw, dh

    def detect(self, img_bgr: np.ndarray, iou_thres: float = PHONE_IOU) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, List[Dict[str, Any]]]]:
        """
        Scans ALL classes the model was trained on (all 80 for stock COCO
        weights) — the forward pass already produced scores for every class
        in one tensor, so this adds no meaningful cost over checking a
        handful of classes. Per-class thresholding/NMS only runs for classes
        that actually have a candidate box in this frame.

        Returns (violation_detections, all_detections):
          - violation_detections: event_type -> list of detections, for the
            classes configured in VIOLATION_CLASSES (drives the state machine)
          - all_detections: class_name -> list of detections, for EVERY class
            found in frame (audit/logging; includes the violation classes too)
        """
        blob, ratio, dw, dh = self._preprocess(img_bgr)
        raw = self.session.run(None, {self.input_name: blob})[0]
        preds = raw[0]  # expected (4+nc, num_boxes), e.g. (84, 8400)
        if preds.shape[0] > preds.shape[1]:
            preds = preds.T  # normalize to (attrs, num_boxes)

        nc = preds.shape[0] - 4
        frame_area = float(max(1, img_bgr.shape[0] * img_bgr.shape[1]))

        violation_detections: Dict[str, List[Dict[str, Any]]] = {cfg["event_type"]: [] for cfg in self.violation_classes.values()}
        all_detections: Dict[str, List[Dict[str, Any]]] = {}

        for class_id in range(nc):
            cfg = self.violation_classes.get(class_id)
            if cfg is not None:
                conf_thres = cfg["conf"]
                min_area_ratio = cfg["min_area_ratio"]
                label = cfg["label"]
            else:
                conf_thres = GENERIC_OBJECT_CONF
                min_area_ratio = GENERIC_OBJECT_MIN_AREA_RATIO
                label = COCO_CLASS_NAMES[class_id] if class_id < len(COCO_CLASS_NAMES) else f"class_{class_id}"

            scores = preds[4 + class_id]  # (num_boxes,)
            mask = scores >= conf_thres
            if not np.any(mask):  # cheap skip — most classes are absent in a given frame
                continue

            cx, cy, bw, bh = preds[0, mask], preds[1, mask], preds[2, mask], preds[3, mask]
            x1 = (cx - bw / 2 - dw) / ratio
            y1 = (cy - bh / 2 - dh) / ratio
            x2 = (cx + bw / 2 - dw) / ratio
            y2 = (cy + bh / 2 - dh) / ratio
            kept_scores = scores[mask]

            nms_input = [[float(x1[i]), float(y1[i]), float(x2[i] - x1[i]), float(y2[i] - y1[i])] for i in range(len(kept_scores))]
            keep = cv2.dnn.NMSBoxes(nms_input, kept_scores.tolist(), conf_thres, iou_thres)
            keep = np.array(keep).flatten() if len(keep) else np.array([], dtype=int)
            if len(keep) == 0:
                continue

            dets_for_class: List[Dict[str, Any]] = []
            for i in keep:
                area_ratio = max(0.0, (x2[i] - x1[i]) * (y2[i] - y1[i])) / frame_area
                if area_ratio < min_area_ratio:
                    continue
                dets_for_class.append({
                    "label": label,
                    "confidence": float(kept_scores[i]) * 100.0,
                    "areaRatio": float(area_ratio),
                    "source": "onnxruntime",
                })

            if not dets_for_class:
                continue

            all_detections[label] = dets_for_class
            if cfg is not None:
                violation_detections[cfg["event_type"]] = dets_for_class

        return violation_detections, all_detections


# --------------------------------------------------------------------------
# Detection functions — face/gaze/camera-blocked logic (unchanged).
# --------------------------------------------------------------------------
def _resize_for_inference(img_bgr: np.ndarray) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    if w <= CV_INFERENCE_MAX_WIDTH:
        return img_bgr
    scale = CV_INFERENCE_MAX_WIDTH / w
    return cv2.resize(img_bgr, (CV_INFERENCE_MAX_WIDTH, int(h * scale)), interpolation=cv2.INTER_AREA)


def _enhance_frame(img_bgr: np.ndarray) -> np.ndarray:
    try:
        ycrcb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2YCrCb)
        y, cr, cb = cv2.split(ycrcb)
        y_eq = cv2.equalizeHist(y)
        return cv2.cvtColor(cv2.merge([y_eq, cr, cb]), cv2.COLOR_YCrCb2BGR)
    except Exception:
        return img_bgr


def _face_count_with_details(img_bgr: np.ndarray) -> Tuple[int, Dict[str, int], Any]:
    try:
        img = _enhance_frame(img_bgr)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        det_count = 0
        mesh_count = 0

        result = _face_detector.process(rgb)
        if result and result.detections:
            det_count = len(result.detections)

        mesh = _face_mesh.process(rgb)
        if mesh and mesh.multi_face_landmarks:
            mesh_count = len(mesh.multi_face_landmarks)

        if det_count == 0 and mesh_count == 0:
            face_count = 0
        elif det_count == 0 or mesh_count == 0:
            face_count = min(max(det_count, mesh_count), 1)
        else:
            face_count = min(det_count, mesh_count)

        return face_count, {"mediapipeFaceDetection": det_count, "mediapipeFaceMesh": mesh_count}, mesh
    except Exception:
        return 0, {"mediapipeFaceDetection": 0, "mediapipeFaceMesh": 0}, None


def _gaze_signal(img_bgr: np.ndarray, mesh_result: Any = None) -> Tuple[bool, str, float]:
    try:
        if mesh_result is None:
            rgb = cv2.cvtColor(_enhance_frame(img_bgr), cv2.COLOR_BGR2RGB)
            mesh_result = _face_mesh.process(rgb)
        if not mesh_result or not mesh_result.multi_face_landmarks:
            return True, "unknown", 0.0

        lm = mesh_result.multi_face_landmarks[0].landmark
        left_eye, right_eye, nose = lm[33], lm[263], lm[1]
        eye_width = abs(right_eye.x - left_eye.x)
        if eye_width < 1e-5:
            return True, "unknown", 0.0
        eye_center_x = (left_eye.x + right_eye.x) / 2.0
        rel_x = float((nose.x - eye_center_x) / eye_width)

        if rel_x < -GAZE_LEFT_RIGHT_THRESHOLD:
            return False, "left", 80.0
        if rel_x > GAZE_LEFT_RIGHT_THRESHOLD:
            return False, "right", 80.0
        return True, "center", 85.0
    except Exception:
        return True, "unknown", 0.0


def _camera_blocked_signal(img_bgr: np.ndarray) -> Tuple[bool, str, float]:
    try:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        brightness = float(np.mean(gray))
        std_dev = float(np.std(gray))
        if brightness < CAMERA_BLOCKED_DARK_THRESHOLD:
            return True, "dark_frame", 95.0
        if std_dev < CAMERA_BLOCKED_UNIFORM_THRESHOLD:
            return True, "uniform_frame", 88.0
        return False, "clear", max(0.0, min(99.0, 100.0 - std_dev))
    except Exception:
        return False, "unknown", 0.0


def _new_session_state() -> Dict[str, Any]:
    return {
        "no_face_start": None,
        "multi_face_start": None,
        "away_start": None,
        "away_count": 0,
        "blocked_start": None,
        "last_object_emit": {},  # event_type -> last emit timestamp, per flagged class
        "last_frame_capture_ts": None,
    }


# --------------------------------------------------------------------------
# analyze_frame() — same violation state machine as before.
# --------------------------------------------------------------------------
def analyze_frame(
    img_bgr: np.ndarray,
    now: float,
    state: Dict[str, Any],
    last_violation_emit: Dict[Tuple[str, str], float],
    object_detector: Optional[MultiClassDetectorONNX],
    session_id: str,
) -> Tuple[Dict[str, Any], Dict[str, float]]:
    t_all0 = time.perf_counter()
    timing: Dict[str, float] = {}

    img = _resize_for_inference(img_bgr)

    GAP_RESET_THRESHOLD = max(NO_FACE_SECONDS, MULTI_FACE_SECONDS, LOOK_AWAY_SECONDS) + 2.0
    last_ts = state.get("last_frame_capture_ts")
    if last_ts is not None and (now - float(last_ts)) > GAP_RESET_THRESHOLD:
        state["no_face_start"] = None
        state["multi_face_start"] = None
        state["away_start"] = None
        state["blocked_start"] = None
    state["last_frame_capture_ts"] = now

    violations: List[Dict[str, Any]] = []
    objects: List[Dict[str, Any]] = []

    t0 = time.perf_counter()
    camera_blocked, blocked_reason, blocked_confidence = _camera_blocked_signal(img)
    timing["cameraBlockedMs"] = (time.perf_counter() - t0) * 1000.0

    total_raw_detections = 0
    detections_by_type: Dict[str, List[Dict[str, Any]]] = {}
    all_detections: Dict[str, List[Dict[str, Any]]] = {}
    if camera_blocked:
        face_count, face_details, mesh_result = 0, {"mediapipeFaceDetection": 0, "mediapipeFaceMesh": 0}, None
        looking_at_screen, gaze_direction, gaze_confidence = True, "unknown", 0.0
        timing["mediapipeMs"] = 0.0
        timing["yoloMs"] = 0.0
    else:
        t0 = time.perf_counter()
        face_count, face_details, mesh_result = _face_count_with_details(img)
        looking_at_screen, gaze_direction, gaze_confidence = _gaze_signal(img, mesh_result)
        timing["mediapipeMs"] = (time.perf_counter() - t0) * 1000.0

        t0 = time.perf_counter()
        if object_detector is not None:
            detections_by_type, all_detections = object_detector.detect(img)
            total_raw_detections = sum(len(v) for v in all_detections.values())
        timing["yoloMs"] = (time.perf_counter() - t0) * 1000.0

    for dets in all_detections.values():
        objects.extend(dets)
    phone_count = len(detections_by_type.get("phone_detected", []))  # kept for stats.phoneCount backward-compat

    def _should_emit(event_type: str) -> bool:
        key = (session_id, event_type)
        last = last_violation_emit.get(key, 0.0)
        if now - last < VIOLATION_COOLDOWN_SECONDS:
            return False
        last_violation_emit[key] = now
        return True

    def _add_violation(event_type: str, severity: str, confidence: float, description: str, metadata: Optional[Dict[str, Any]] = None) -> bool:
        if event_type not in CV_ENABLED_EVENTS:
            return False
        if not _should_emit(event_type):
            return False
        violations.append(
            {
                "eventType": event_type,
                "severity": severity,
                "confidence": max(0.0, min(100.0, confidence)),
                "description": description,
                "metadata": metadata or {},
            }
        )
        return True

    if camera_blocked:
        if state["blocked_start"] is None:
            state["blocked_start"] = now
        elif now - float(state["blocked_start"]) > CAMERA_BLOCKED_SECONDS:
            blocked_duration = now - float(state["blocked_start"])
            if _add_violation(
                "camera_blocked", "critical", max(75.0, blocked_confidence),
                "Camera view is blocked or unavailable",
                {"reason": blocked_reason, "durationSeconds": round(blocked_duration, 2)},
            ):
                state["blocked_start"] = now
    else:
        state["blocked_start"] = None

    if face_count == 0:
        if state["no_face_start"] is None:
            state["no_face_start"] = now
        elif now - float(state["no_face_start"]) > NO_FACE_SECONDS:
            no_face_duration = now - float(state["no_face_start"])
            if _add_violation(
                "face_not_detected", "high", 92.0,
                "No candidate detected in camera frame",
                {"faceCount": face_count, "durationSeconds": round(no_face_duration, 2)},
            ):
                state["no_face_start"] = now
    else:
        state["no_face_start"] = None

    if face_count > 1:
        if state["multi_face_start"] is None:
            state["multi_face_start"] = now
        elif now - float(state["multi_face_start"]) > MULTI_FACE_SECONDS:
            if _add_violation(
                "multiple_faces", "critical", 90.0,
                f"Multiple faces detected (faces={face_count})",
                {"faceCount": face_count},
            ):
                state["multi_face_start"] = now
    else:
        state["multi_face_start"] = None

    if face_count > 0 and not looking_at_screen:
        if state["away_start"] is None:
            state["away_start"] = now
        elif now - float(state["away_start"]) > LOOK_AWAY_SECONDS:
            away_duration = now - float(state["away_start"])
            state["away_count"] = int(state.get("away_count", 0)) + 1
            if _add_violation(
                "looking_away", "medium", max(65.0, gaze_confidence),
                f"Candidate appears to be looking {gaze_direction}",
                {"direction": gaze_direction, "durationSeconds": round(away_duration, 2), "frequency": int(state["away_count"])},
            ):
                state["away_start"] = now
    else:
        state["away_start"] = None

    for class_id, cfg in VIOLATION_CLASSES.items():
        event_type = cfg["event_type"]
        dets = detections_by_type.get(event_type, [])
        if not dets:
            continue
        last_emit = state["last_object_emit"].get(event_type, 0.0)
        if (now - last_emit) <= OBJECT_EMIT_COOLDOWN_SECONDS:
            continue
        count = len(dets)
        best_conf = max(o["confidence"] for o in dets)
        if _add_violation(
            event_type, cfg["severity"], best_conf,
            f"{cfg['label'].capitalize()} detected ({count})",
            {"count": count, "label": cfg["label"]},
        ):
            state["last_object_emit"][event_type] = now

    timing["totalMs"] = (time.perf_counter() - t_all0) * 1000.0

    response = {
        "violations": violations,
        "objects": objects,
        "face": {
            "detected": face_count > 0,
            "count": face_count,
            "lookingAtScreen": looking_at_screen,
            "gazeDirection": gaze_direction,
            "gazeConfidence": gaze_confidence,
            "cameraBlocked": camera_blocked,
        },
        "stats": {
            "personCount": face_count,
            "phoneCount": phone_count,
            "objectCounts": {et: len(dets) for et, dets in detections_by_type.items() if dets},
            "allDetectedClasses": {label: len(dets) for label, dets in all_detections.items()},
            "totalRawDetections": total_raw_detections,
            "cameraBlocked": camera_blocked,
        },
    }
    return response, timing


# --------------------------------------------------------------------------
# Evidence storage — mirrors backend fileStorageService.ts's uploadSnapshot().
# --------------------------------------------------------------------------
def save_violation_evidence(
    output_dir: str, session_id: str, frame: np.ndarray, captured_at_ms: int, violations: List[Dict[str, Any]], extra: Dict[str, Any]
) -> str:
    os.makedirs(output_dir, exist_ok=True)
    base = f"{session_id}-violation-{captured_at_ms}"
    img_path = os.path.join(output_dir, base + ".jpg")
    json_path = os.path.join(output_dir, base + ".json")
    cv2.imwrite(img_path, frame)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"violations": violations, "capturedAtMs": captured_at_ms, **extra}, f, indent=2)
    return img_path


# --------------------------------------------------------------------------
# Video driver
# --------------------------------------------------------------------------
def run_video(
    video_path: str, yolo_model_path: str, session_id: str, interval: float, output_dir: str,
    max_frames: Optional[int], frame_access: str = "seek",
) -> Dict[str, Any]:
    print(f"[SETUP] loading ONNX model: {yolo_model_path}")
    print(f"[SETUP] scanning all COCO classes (audit); violations raised for: "
          f"{', '.join(cfg['label'] for cfg in VIOLATION_CLASSES.values())}")
    object_detector = MultiClassDetectorONNX(yolo_model_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_s = (total_frames / fps) if fps > 0 else 0.0
    print(f"[SETUP] video: {video_path}  fps={fps:.2f}  frames={total_frames}  duration={duration_s:.1f}s")
    print(f"[SETUP] frame_access={frame_access}")

    model_dir = os.path.join(output_dir, os.path.splitext(os.path.basename(yolo_model_path))[0])

    state = _new_session_state()
    last_violation_emit: Dict[Tuple[str, str], float] = {}
    now_base = time.time()

    all_violations: List[Dict[str, Any]] = []
    timing_series: Dict[str, List[float]] = {"cameraBlockedMs": [], "mediapipeMs": [], "yoloMs": [], "totalMs": []}
    saved_paths: List[str] = []
    sampled_idx = 0

    def _process_sample(video_time: float, frame: np.ndarray) -> bool:
        """Runs analyze_frame on one sampled frame, logs, saves evidence.
        Returns False if max_frames has been reached (caller should stop)."""
        nonlocal sampled_idx
        captured_at_ms = int(video_time * 1000)
        response, timing = analyze_frame(frame, now_base + video_time, state, last_violation_emit, object_detector, session_id)

        for k in timing_series:
            timing_series[k].append(timing[k])

        face = response["face"]
        stats = response["stats"]
        obj_summary = ", ".join(f"{k}={v}" for k, v in stats["allDetectedClasses"].items()) or "none"
        print(
            f"[FRAME] idx={sampled_idx:04d} t={video_time:7.2f}s  "
            f"camBlockMs={timing['cameraBlockedMs']:6.2f} mediapipeMs={timing['mediapipeMs']:6.2f} "
            f"onnxMs={timing['yoloMs']:7.2f} totalMs={timing['totalMs']:7.2f}  "
            f"faces={face['count']} gaze={face['gazeDirection']} "
            f"objects=[{obj_summary}]"
        )

        if response["violations"]:
            saved_path = save_violation_evidence(
                model_dir, session_id, frame, captured_at_ms, response["violations"],
                {"videoTimeSeconds": round(video_time, 2), "frameIndex": sampled_idx, "face": face, "stats": stats},
            )
            saved_paths.append(saved_path)
            for v in response["violations"]:
                v_record = dict(v)
                v_record["videoTimeSeconds"] = round(video_time, 2)
                v_record["evidencePath"] = saved_path
                all_violations.append(v_record)
                print(
                    f"[VIOLATION] t={video_time:7.2f}s event={v['eventType']:<20} severity={v['severity']:<8} "
                    f"conf={v['confidence']:5.1f}  desc=\"{v['description']}\"  saved={saved_path}"
                )

        sampled_idx += 1
        return max_frames is None or sampled_idx < max_frames

    if frame_access == "seek":
        # FAST PATH: jump the demuxer straight to each sample timestamp.
        # cap.set(CAP_PROP_POS_MSEC, ...) seeks to the nearest preceding
        # keyframe and only decodes forward the short span to the target
        # time -- NOT every frame in the video. This is what actually breaks
        # the "wall time tracks real-time video duration" ceiling, since
        # decode cost per sample no longer depends on how many frames
        # separate consecutive samples.
        #
        # Caveat: precision depends on container/codec/backend. Variable
        # frame rate (VFR) recordings or unusual containers can seek less
        # reliably -- if you see repeated/skipped timestamps in the log,
        # fall back to --frame-access sequential.
        t = 0.0
        while t < duration_s or (duration_s == 0 and total_frames == 0):
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ok, frame = cap.read()
            if not ok:
                break
            if not _process_sample(t, frame):
                break
            t += interval
    else:
        # FALLBACK PATH: sequential grab()+retrieve(). grab() skips the
        # colorspace-conversion/copy cost for frames we don't keep, but the
        # underlying codec still has to decode every inter-frame in order --
        # so total wall time here is bounded by ~real-time video decode
        # speed, regardless of `interval`. Use this only if seeking proves
        # unreliable for a given video.
        frame_idx = 0
        next_sample_time = 0.0
        while True:
            ok = cap.grab()
            if not ok:
                break
            video_time = frame_idx / fps
            frame_idx += 1
            if video_time < next_sample_time:
                continue
            next_sample_time += interval
            ok, frame = cap.retrieve()
            if not ok:
                break
            if not _process_sample(video_time, frame):
                break

    cap.release()

    return {
        "model": yolo_model_path,
        "video": video_path,
        "fps": fps,
        "duration_s": duration_s,
        "sampled_frames": sampled_idx,
        "violations": all_violations,
        "timing": timing_series,
        "saved_paths": saved_paths,
    }


def print_report(result: Dict[str, Any]) -> None:
    model = result["model"]
    timing = result["timing"]
    violations = result["violations"]

    print("\n" + "=" * 78)
    print(f"REPORT — {model}")
    print("=" * 78)
    print(f"Video: {result['video']}  (duration={result['duration_s']:.1f}s, fps={result['fps']:.2f})")
    print(f"Sampled frames analyzed: {result['sampled_frames']}")
    print(f"Enabled violation types: {', '.join(sorted(CV_ENABLED_EVENTS))}")

    print("\nPer-frame computation time (ms):")
    for label, key in [("CameraCheck", "cameraBlockedMs"), ("MediaPipe", "mediapipeMs"), ("ONNX phone-det", "yoloMs"), ("Frame total", "totalMs")]:
        vals = timing[key]
        if not vals:
            continue
        print(f"  {label:<14} avg={statistics.mean(vals):7.2f}  min={min(vals):7.2f}  max={max(vals):7.2f}  median={statistics.median(vals):7.2f}")

    print(f"\nVIOLATIONS FLAGGED ({len(violations)} total):")
    for v in violations:
        print(
            f"  [{v['videoTimeSeconds']:7.2f}s] {v['eventType']:<20} severity={v['severity']:<8} "
            f"conf={v['confidence']:5.1f}  desc=\"{v['description']}\"  -> {v['evidencePath']}"
        )

    counts: Dict[str, int] = {}
    for v in violations:
        counts[v["eventType"]] = counts.get(v["eventType"], 0) + 1
    print("\nViolation counts by type:")
    if counts:
        for et, c in sorted(counts.items()):
            print(f"  {et}: {c}")
    else:
        print("  (none)")


def print_comparison(results: List[Dict[str, Any]]) -> None:
    if len(results) < 2:
        return
    print("\n" + "=" * 78)
    print("MODEL COMPARISON")
    print("=" * 78)
    print(f"{'model':<20}{'frames':>10}{'violations':>13}{'avg_onnx_ms':>14}{'avg_frame_ms':>15}")
    for r in results:
        avg_onnx = statistics.mean(r["timing"]["yoloMs"]) if r["timing"]["yoloMs"] else 0.0
        avg_total = statistics.mean(r["timing"]["totalMs"]) if r["timing"]["totalMs"] else 0.0
        print(f"{os.path.basename(r['model']):<20}{r['sampled_frames']:>10}{len(r['violations']):>13}{avg_onnx:>14.2f}{avg_total:>15.2f}")

    def _key(v: Dict[str, Any]) -> Tuple[str, int]:
        return (v["eventType"], round(v["videoTimeSeconds"]))

    for i, r in enumerate(results):
        others = set()
        for j, r2 in enumerate(results):
            if j != i:
                others |= {_key(v) for v in r2["violations"]}
        mine = {_key(v) for v in r["violations"]}
        only_mine = mine - others
        label = os.path.basename(r["model"])
        if only_mine:
            print(f"\nViolations only in {label}: " + ", ".join(f"{et}@{t}s" for et, t in sorted(only_mine)))
        else:
            print(f"\nViolations only in {label}: (none)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Optimized AI-proctoring pipeline replica driven by an uploaded video file")
    parser.add_argument("--video", required=True, help="path to the video file to analyze")
    parser.add_argument(
        "--yolo-model", nargs="+", default=["yolov8n.onnx"],
        help="one or more .onnx weights to test (e.g. --yolo-model yolov8n.onnx yolo26n.onnx)",
    )
    parser.add_argument("--session-id", default=None, help="default: derived from the video filename")
    parser.add_argument(
        "--interval", type=float, default=3.0,
        help="seconds of VIDEO time between analyzed frames (default 3.0, matching PROCTOR_SESSION_MIN_INTERVAL_MS)",
    )
    parser.add_argument("--output-dir", default="violation_evidence", help="where violated frames + JSON sidecars are saved")
    parser.add_argument("--max-frames", type=int, default=None, help="cap sampled frames processed (for quick tests on long videos)")
    parser.add_argument(
        "--frame-access", choices=["seek", "sequential"], default="seek",
        help="'seek' (default) jumps the demuxer directly to each sample timestamp -- fast, "
             "decode cost no longer scales with video length. 'sequential' decodes every frame "
             "via grab()/retrieve() -- slower (bounded by real-time video decode speed), only "
             "needed as a fallback if seeking behaves unreliably on a given video (e.g. VFR).",
    )
    parser.add_argument("--core", type=int, default=0, help="logical CPU core to pin this process to")
    parser.add_argument("--no-pin", action="store_true", help="skip CPU affinity pinning")
    parser.add_argument("--report-file", default=None, help="optional path to write a combined JSON report")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        raise FileNotFoundError(f"Video not found: {args.video}")
    session_id = args.session_id or os.path.splitext(os.path.basename(args.video))[0]

    print(f"[SETUP] cv2 threads = {cv2.getNumThreads()}")
    if args.no_pin:
        print("[SETUP] CPU pinning skipped (--no-pin)")
    else:
        print(f"[SETUP] {pin_to_single_cpu(args.core)}")
    print(f"[SETUP] onnxruntime available providers: {ort.get_available_providers() if ort else 'N/A'}")
    print(f"[SETUP] session_id={session_id}  interval={args.interval}s  enabled_events={sorted(CV_ENABLED_EVENTS)}")

    results = []
    for model_path in args.yolo_model:
        print(f"\n{'#' * 78}\n# RUNNING: {model_path}\n{'#' * 78}")
        result = run_video(args.video, model_path, session_id, args.interval, args.output_dir, args.max_frames, args.frame_access)
        results.append(result)
        print_report(result)

    print_comparison(results)

    if args.report_file:
        with open(args.report_file, "w", encoding="utf-8") as f:
            json.dump(
                [{"model": r["model"], "sampled_frames": r["sampled_frames"], "violations": r["violations"],
                  "timing_summary": {k: (statistics.mean(v) if v else 0.0) for k, v in r["timing"].items()}} for r in results],
                f, indent=2,
            )
        print(f"\n[DONE] combined report written to {args.report_file}")


if __name__ == "__main__":
    main()