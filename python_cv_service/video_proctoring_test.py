"""Full AI-proctoring pipeline replica, driven by an uploaded video file.

This is NOT a simplified test — it ports app.py's actual analyze_request()
violation state machine verbatim (same constants, same thresholds, same
cooldown/duration logic, same MediaPipe consensus algorithm, same phone-only
YOLO filter), so results here should match what app.py would have flagged had
these frames arrived live from a browser. The only two differences:

1. Input is a video file, not live frames from the frontend. Frames are
   sampled at --interval seconds of VIDEO time (default 3.0s, matching the
   Node backend's PROCTOR_SESSION_MIN_INTERVAL_MS=3000 default rate limit —
   see backend/src/controllers/proctoring.ts), and each sampled frame's
   video-relative timestamp is used as the "now" clock for every duration
   threshold (NO_FACE_SECONDS, MULTI_FACE_SECONDS, etc.), so a 10-minute
   video is evaluated as 10 minutes of session time without actually waiting.
2. YOLO runs through ONNX Runtime, not PyTorch (see benchmark_single_frame.py
   for why — PyTorch's CPU wheels are MKL-linked and badly penalized on
   non-Intel CPUs).

Every violation this script flags gets its analyzed frame saved to disk
alongside a JSON sidecar with full metadata, for manual inspection —
loosely matching the backend's uploadSnapshot() naming convention
(fileStorageService.ts): "<sessionId>-violation-<capturedAtMs>.jpg/.json".

Only CV_ENABLED_EVENTS (env-configurable, same as app.py, default
face_not_detected/multiple_faces/phone_detected) are ever emitted as
violations — looking_away and camera_blocked are computed by the state
machine either way but stay silent unless explicitly enabled, exactly like
production.

Export ONNX weights once before running (no .pt supported):
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
    import torch  # noqa: E402
    torch.set_num_threads(1)
except Exception:
    torch = None

from ultralytics import YOLO  # noqa: E402

try:
    import onnxruntime as ort  # noqa: E402
except ImportError:
    ort = None


# --------------------------------------------------------------------------
# CPU affinity — same single-vCPU simulation as benchmark_single_frame.py.
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
# Constants — copied verbatim from app.py (same names, same defaults, same
# env vars), so this replica's thresholds are identical to production's.
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
PHONE_CLASS_ID = _env_int("PHONE_CLASS_ID", 67)
PHONE_CONF = _env_float("PHONE_CONF", 0.35)
PHONE_MIN_AREA_RATIO = _env_float("PHONE_MIN_AREA_RATIO", 0.00005)
NO_FACE_SECONDS = _env_float("NO_FACE_SECONDS", 5.0)
MULTI_FACE_SECONDS = _env_float("MULTI_FACE_SECONDS", 3.0)
LOOK_AWAY_SECONDS = _env_float("LOOK_AWAY_SECONDS", 3.0)
PHONE_EMIT_COOLDOWN_SECONDS = _env_float("PHONE_EMIT_COOLDOWN_SECONDS", 3.0)
CAMERA_BLOCKED_SECONDS = _env_float("CAMERA_BLOCKED_SECONDS", 1.2)
FACE_MIN_CONF = _env_float("FACE_MIN_CONF", 0.45)
GAZE_LEFT_RIGHT_THRESHOLD = _env_float("GAZE_LEFT_RIGHT_THRESHOLD", 0.35)
CAMERA_BLOCKED_DARK_THRESHOLD = _env_float("CAMERA_BLOCKED_DARK_THRESHOLD", 18.0)
CAMERA_BLOCKED_UNIFORM_THRESHOLD = _env_float("CAMERA_BLOCKED_UNIFORM_THRESHOLD", 8.0)
CV_INFERENCE_MAX_WIDTH = _env_int("CV_INFERENCE_MAX_WIDTH", 640)
CV_ENABLED_EVENTS = {
    x.strip()
    for x in os.getenv("CV_ENABLED_EVENTS", "face_not_detected,multiple_faces,phone_detected").split(",")
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
# Detection functions — ported verbatim from app.py.
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


def _phone_detections(img_bgr: np.ndarray, model: Optional[YOLO]) -> Tuple[List[Dict[str, Any]], int]:
    """Returns (phone_detections, total_raw_detections). The model still runs
    full 80-class detection every call (nothing here restricts what it looks
    for) -- total_raw_detections is reported purely for inspection/logging.
    Only the phone class actually drives a violation, exactly like app.py."""
    if model is None:
        return [], 0
    out: List[Dict[str, Any]] = []
    total = 0
    try:
        results = model.predict(img_bgr, verbose=False, conf=PHONE_CONF, iou=0.45, max_det=50, device="cpu")
        h, w = img_bgr.shape[:2]
        frame_area = float(max(1, h * w))
        model_names = getattr(model, "names", {}) or {}
        for res in results:
            boxes = res.boxes
            if boxes is None:
                continue
            total += len(boxes)
            for b in boxes:
                cls_idx = int(b.cls.item())
                conf = float(b.conf.item())
                label = str(model_names.get(cls_idx, "")).lower().strip()
                is_phone = cls_idx == PHONE_CLASS_ID or label in {"cell phone", "mobile phone", "phone", "smartphone"}
                if not is_phone or conf < PHONE_CONF:
                    continue
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]
                area_ratio = max(0.0, (x2 - x1) * (y2 - y1)) / frame_area
                if area_ratio < PHONE_MIN_AREA_RATIO:
                    continue
                out.append({"label": "cell phone", "confidence": conf * 100.0, "areaRatio": area_ratio, "source": "yolo"})
    except Exception:
        return [], 0
    return out, total


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
        "last_phone_emit": 0.0,
        "last_frame_capture_ts": None,
    }


# --------------------------------------------------------------------------
# analyze_frame() — port of app.py's analyze_request(), minus the FastAPI/
# base64 wrapper. Same order of operations, same duration/cooldown logic.
# --------------------------------------------------------------------------
def analyze_frame(
    img_bgr: np.ndarray,
    now: float,
    state: Dict[str, Any],
    last_violation_emit: Dict[Tuple[str, str], float],
    model: Optional[YOLO],
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
    if camera_blocked:
        face_count, face_details, mesh_result = 0, {"mediapipeFaceDetection": 0, "mediapipeFaceMesh": 0}, None
        looking_at_screen, gaze_direction, gaze_confidence = True, "unknown", 0.0
        phone_objects: List[Dict[str, Any]] = []
        timing["mediapipeMs"] = 0.0
        timing["yoloMs"] = 0.0
    else:
        t0 = time.perf_counter()
        face_count, face_details, mesh_result = _face_count_with_details(img)
        looking_at_screen, gaze_direction, gaze_confidence = _gaze_signal(img, mesh_result)
        timing["mediapipeMs"] = (time.perf_counter() - t0) * 1000.0

        t0 = time.perf_counter()
        phone_objects, total_raw_detections = _phone_detections(img, model)
        timing["yoloMs"] = (time.perf_counter() - t0) * 1000.0

    phone_count = len(phone_objects)
    objects.extend(phone_objects)

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

    if phone_count > 0 and (now - float(state["last_phone_emit"])) > PHONE_EMIT_COOLDOWN_SECONDS:
        if _add_violation(
            "phone_detected", "critical",
            max([o["confidence"] for o in phone_objects]) if phone_objects else 88.0,
            f"Mobile phone detected ({phone_count})",
            {"phoneCount": phone_count},
        ):
            state["last_phone_emit"] = now

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
            "totalRawDetections": total_raw_detections,
            "cameraBlocked": camera_blocked,
        },
    }
    return response, timing


# --------------------------------------------------------------------------
# Evidence storage — mirrors backend fileStorageService.ts's uploadSnapshot()
# naming: "<attemptId>-violation-<timestamp>.jpg". We use sessionId in place
# of attemptId (no DB/attempt concept in this standalone script).
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
def run_video(video_path: str, yolo_model_path: str, session_id: str, interval: float, output_dir: str, max_frames: Optional[int]) -> Dict[str, Any]:
    if ort is None:
        raise RuntimeError("onnxruntime is not installed. Run: pip install onnxruntime")
    if not yolo_model_path.endswith(".onnx"):
        raise ValueError(f"{yolo_model_path} is not a .onnx file — only ONNX Runtime models are supported here")
    if not os.path.exists(yolo_model_path):
        raise FileNotFoundError(
            f"{yolo_model_path} not found. Export it first, e.g.:\n"
            f"  yolo export model={yolo_model_path[:-5]}.pt format=onnx imgsz={CV_INFERENCE_MAX_WIDTH}"
        )

    print(f"[SETUP] loading YOLO model: {yolo_model_path}")
    model = YOLO(yolo_model_path, task="detect")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_s = (total_frames / fps) if fps > 0 else 0.0
    print(f"[SETUP] video: {video_path}  fps={fps:.2f}  frames={total_frames}  duration={duration_s:.1f}s")

    model_dir = os.path.join(output_dir, os.path.splitext(os.path.basename(yolo_model_path))[0])

    state = _new_session_state()
    last_violation_emit: Dict[Tuple[str, str], float] = {}

    # app.py's state defaults (last_phone_emit=0.0, _should_emit's cooldown-map
    # default of 0.0) rely on "now" always being a huge Unix epoch, so a fresh
    # 0.0 baseline is trivially "expired" on the first frame. Raw video time
    # starts at 0.0 too, which would wrongly suppress any violation resolving
    # within the first few seconds of video. Offsetting "now" by a fixed large
    # base restores that same trivially-expired behavior for the first frame.
    now_base = time.time()

    all_violations: List[Dict[str, Any]] = []
    timing_series: Dict[str, List[float]] = {"cameraBlockedMs": [], "mediapipeMs": [], "yoloMs": [], "totalMs": []}
    saved_paths: List[str] = []

    frame_idx = 0
    sampled_idx = 0
    next_sample_time = 0.0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        video_time = frame_idx / fps
        frame_idx += 1
        if video_time < next_sample_time:
            continue
        next_sample_time += interval

        captured_at_ms = int(video_time * 1000)
        response, timing = analyze_frame(frame, now_base + video_time, state, last_violation_emit, model, session_id)

        for k in timing_series:
            timing_series[k].append(timing[k])

        face = response["face"]
        stats = response["stats"]
        print(
            f"[FRAME] idx={sampled_idx:04d} t={video_time:7.2f}s  "
            f"camBlockMs={timing['cameraBlockedMs']:6.2f} mediapipeMs={timing['mediapipeMs']:6.2f} "
            f"yoloMs={timing['yoloMs']:7.2f} totalMs={timing['totalMs']:7.2f}  "
            f"faces={face['count']} gaze={face['gazeDirection']} "
            f"phones={stats['phoneCount']} allDetections={stats['totalRawDetections']}"
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
        if max_frames is not None and sampled_idx >= max_frames:
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
    for label, key in [("CameraCheck", "cameraBlockedMs"), ("MediaPipe", "mediapipeMs"), ("YOLO", "yoloMs"), ("Frame total", "totalMs")]:
        vals = timing[key]
        if not vals:
            continue
        print(f"  {label:<12} avg={statistics.mean(vals):7.2f}  min={min(vals):7.2f}  max={max(vals):7.2f}  median={statistics.median(vals):7.2f}")

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
    print(f"{'model':<20}{'frames':>10}{'violations':>13}{'avg_yolo_ms':>14}{'avg_frame_ms':>15}")
    for r in results:
        avg_yolo = statistics.mean(r["timing"]["yoloMs"]) if r["timing"]["yoloMs"] else 0.0
        avg_total = statistics.mean(r["timing"]["totalMs"]) if r["timing"]["totalMs"] else 0.0
        print(f"{os.path.basename(r['model']):<20}{r['sampled_frames']:>10}{len(r['violations']):>13}{avg_yolo:>14.2f}{avg_total:>15.2f}")

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
    parser = argparse.ArgumentParser(description="Full AI-proctoring pipeline replica driven by an uploaded video file")
    parser.add_argument("--video", required=True, help="path to the video file to analyze")
    parser.add_argument(
        "--yolo-model", nargs="+", default=["yolov8n.onnx"],
        help="one or more .onnx weights to test (e.g. --yolo-model yolov8n.onnx yolo26n.onnx)",
    )
    parser.add_argument("--session-id", default=None, help="default: derived from the video filename")
    parser.add_argument(
        "--interval", type=float, default=3.0,
        help="seconds of VIDEO time between analyzed frames (default 3.0, matching the backend's PROCTOR_SESSION_MIN_INTERVAL_MS rate limit)",
    )
    parser.add_argument("--output-dir", default="violation_evidence", help="where violated frames + JSON sidecars are saved")
    parser.add_argument("--max-frames", type=int, default=None, help="cap sampled frames processed (for quick tests on long videos)")
    parser.add_argument("--core", type=int, default=0, help="logical CPU core to pin this process to")
    parser.add_argument("--no-pin", action="store_true", help="skip CPU affinity pinning")
    parser.add_argument("--report-file", default=None, help="optional path to write a combined JSON report")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        raise FileNotFoundError(f"Video not found: {args.video}")
    session_id = args.session_id or os.path.splitext(os.path.basename(args.video))[0]

    print(f"[SETUP] cv2 threads = {cv2.getNumThreads()}")
    if torch is not None:
        print(f"[SETUP] torch threads = {torch.get_num_threads()}")
    if args.no_pin:
        print("[SETUP] CPU pinning skipped (--no-pin)")
    else:
        print(f"[SETUP] {pin_to_single_cpu(args.core)}")
    print(f"[SETUP] onnxruntime available providers: {ort.get_available_providers() if ort else 'N/A'}")
    print(f"[SETUP] session_id={session_id}  interval={args.interval}s  enabled_events={sorted(CV_ENABLED_EVENTS)}")

    results = []
    for model_path in args.yolo_model:
        print(f"\n{'#' * 78}\n# RUNNING: {model_path}\n{'#' * 78}")
        result = run_video(args.video, model_path, session_id, args.interval, args.output_dir, args.max_frames)
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
