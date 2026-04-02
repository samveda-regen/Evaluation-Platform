from typing import Any, Dict, List, Optional, Tuple
import asyncio
import base64
import time
import logging
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

# Load .env file from the same directory (uvicorn does not auto-load .env).
def _load_dotenv() -> None:
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, raw_val = line.partition("=")
            key = key.strip()
            raw_val = raw_val.strip()
            if raw_val.startswith(('"', "'")):
                raw_val = raw_val[1:-1]
            if key and key not in os.environ:
                os.environ[key] = raw_val

_load_dotenv()

import cv2
import numpy as np
from fastapi import FastAPI  # type: ignore
from pydantic import BaseModel
import mediapipe as mp

try:
    from ultralytics import YOLO
except Exception:
    YOLO = None


app = FastAPI(title="Proctoring CV Service", version="2.0.0")
logger = logging.getLogger("proctor_cv")
CV_DEBUG = os.getenv("CV_DEBUG", "false").strip().lower() == "true"

class AnalyzeRequest(BaseModel):
    frame: str
    sessionId: Optional[str] = None


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


# Contract-level cooldown (same purpose as old service)
VIOLATION_COOLDOWN_SECONDS = _env_float("VIOLATION_COOLDOWN_SECONDS", 3.0)

# New-engine detection behavior (adapted for frame API)
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
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL", "yolov8n.pt").strip() or "yolov8n.pt"
CV_ENABLED_EVENTS = {
    x.strip()
    for x in os.getenv(
        "CV_ENABLED_EVENTS",
        "face_not_detected,multiple_faces,phone_detected",
    ).split(",")
    if x.strip()
}

# Max width to resize frames before inference. Smaller = faster YOLO + MediaPipe.
# 640 is the native YOLO input size — no quality loss, ~3x speedup on large webcam frames.
CV_INFERENCE_MAX_WIDTH = _env_int("CV_INFERENCE_MAX_WIDTH", 640)
_CPU_CORES = max(2, int(os.cpu_count() or 2))
CV_INFERENCE_THREADS = _env_int("CV_INFERENCE_THREADS", max(2, min(16, _CPU_CORES)))
CV_MAX_INFLIGHT = _env_int("CV_MAX_INFLIGHT", max(16, CV_INFERENCE_THREADS * 8))

# Thread pool for CPU-bound inference — allows FastAPI to accept new HTTP connections
# while a frame is being processed rather than blocking the async event loop.
_inference_pool = ThreadPoolExecutor(max_workers=CV_INFERENCE_THREADS)
_analysis_slots = asyncio.Semaphore(CV_MAX_INFLIGHT)


_last_violation_emit: Dict[Tuple[str, str], float] = {}


def _new_session_state() -> Dict[str, Any]:
    return {
        "no_face_start": None,
        "multi_face_start": None,
        "away_start": None,
        "away_count": 0,
        "blocked_start": None,
        "last_phone_emit": 0.0,
    }


_session_state: Dict[str, Dict[str, Any]] = defaultdict(_new_session_state)


def decode_frame(frame_b64: str) -> Optional[np.ndarray]:
    try:
        frame_bytes = base64.b64decode(frame_b64)
        nparr = np.frombuffer(frame_bytes, np.uint8)
        return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception:
        return None


def _should_emit(event_type: str, session_id: Optional[str]) -> bool:
    sid = session_id or "default"
    now = time.time()
    key = (sid, event_type)
    last = _last_violation_emit.get(key, 0.0)
    if now - last < VIOLATION_COOLDOWN_SECONDS:
        return False
    _last_violation_emit[key] = now
    return True


def _add_violation(
    violations: List[Dict[str, Any]],
    session_id: Optional[str],
    event_type: str,
    severity: str,
    confidence: float,
    description: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> bool:
    if event_type not in CV_ENABLED_EVENTS:
        return False
    if not _should_emit(event_type, session_id):
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


_model = None
if YOLO is not None:
    try:
        _model = YOLO(YOLO_MODEL_PATH)
    except Exception:
        _model = None

_face_detector = mp.solutions.face_detection.FaceDetection(
    model_selection=1,
    min_detection_confidence=FACE_MIN_CONF,
)
_face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=False,
    max_num_faces=5,
    refine_landmarks=True,
    min_detection_confidence=FACE_MIN_CONF,
    min_tracking_confidence=FACE_MIN_CONF,
)
_haar_face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def _resize_for_inference(img_bgr: np.ndarray) -> np.ndarray:
    """Downscale frame to CV_INFERENCE_MAX_WIDTH before running any model.
    640px is YOLO's native input size — no accuracy loss, significant speedup."""
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
    """Returns (face_count, detail_dict, mesh_result).
    mesh_result is returned so _gaze_signal can reuse it without a second FaceMesh call."""
    try:
        img = _enhance_frame(img_bgr)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        det_count = 0
        mesh_count = 0
        haar_count = 0

        result = _face_detector.process(rgb)
        if result and result.detections:
            det_count = len(result.detections)

        mesh = _face_mesh.process(rgb)
        if mesh and mesh.multi_face_landmarks:
            mesh_count = len(mesh.multi_face_landmarks)

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = _haar_face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
        haar_count = len(faces)

        best = max(det_count, mesh_count, haar_count)
        return best, {"mediapipeFaceDetection": det_count, "mediapipeFaceMesh": mesh_count, "haar": haar_count}, mesh
    except Exception:
        return 0, {"mediapipeFaceDetection": 0, "mediapipeFaceMesh": 0, "haar": 0}, None


def _gaze_signal(img_bgr: np.ndarray, mesh_result: Any = None) -> Tuple[bool, str, float]:
    """Estimate gaze from face mesh. Accepts a pre-computed mesh_result to avoid
    a redundant FaceMesh inference call when called after _face_count_with_details."""
    try:
        if mesh_result is None:
            rgb = cv2.cvtColor(_enhance_frame(img_bgr), cv2.COLOR_BGR2RGB)
            mesh_result = _face_mesh.process(rgb)
        if not mesh_result or not mesh_result.multi_face_landmarks:
            return True, "unknown", 0.0

        lm = mesh_result.multi_face_landmarks[0].landmark
        left_eye = lm[33]
        right_eye = lm[263]
        nose = lm[1]
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


def _phone_detections(img_bgr: np.ndarray) -> List[Dict[str, Any]]:
    if _model is None:
        return []
    out: List[Dict[str, Any]] = []
    try:
        results = _model.predict(img_bgr, verbose=False, conf=PHONE_CONF, iou=0.45, max_det=20)
        h, w = img_bgr.shape[:2]
        frame_area = float(max(1, h * w))
        model_names = getattr(_model, "names", {}) or {}
        for res in results:
            boxes = res.boxes
            if boxes is None:
                continue
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
                out.append(
                    {
                        "label": "cell phone",
                        "confidence": conf * 100.0,
                        "areaRatio": area_ratio,
                        "source": "yolo",
                    }
                )
    except Exception:
        return []
    return out


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


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "yolo_loaded": _model is not None,
        "model": YOLO_MODEL_PATH if _model is not None else None,
        "voice_supported_in_this_api": False,
        "config": {
            "phoneConf": PHONE_CONF,
            "noFaceSeconds": NO_FACE_SECONDS,
            "multiFaceSeconds": MULTI_FACE_SECONDS,
            "lookAwaySeconds": LOOK_AWAY_SECONDS,
            "cameraBlockedSeconds": CAMERA_BLOCKED_SECONDS,
            "enabledEvents": sorted(list(CV_ENABLED_EVENTS)),
            "cvDebug": CV_DEBUG,
            "inferenceThreads": CV_INFERENCE_THREADS,
            "maxInflight": CV_MAX_INFLIGHT,
        },
    }


@app.post("/analyze")
async def analyze(req: AnalyzeRequest) -> Dict[str, Any]:
    # Hard cap in-flight analysis to protect the service under burst load.
    try:
        await asyncio.wait_for(_analysis_slots.acquire(), timeout=0.02)
    except asyncio.TimeoutError:
        return {"violations": [], "overloaded": True}

    try:
        # Run CPU-bound inference in a thread so the event loop stays free to accept
        # new connections from other candidates simultaneously.
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_inference_pool, analyze_request, req)
    finally:
        _analysis_slots.release()


def analyze_request(req: AnalyzeRequest) -> Dict[str, Any]:
    img = decode_frame(req.frame)
    if img is None:
        return {"violations": []}

    # Downscale to inference resolution before running any model.
    # 640px is YOLO's native input size — no accuracy loss, ~3x faster on 1080p+ frames.
    img = _resize_for_inference(img)

    sid = req.sessionId or "default"
    state = _session_state[sid]
    now = time.time()

    violations: List[Dict[str, Any]] = []
    objects: List[Dict[str, Any]] = []

    # FaceMesh is computed once here and reused by _gaze_signal to eliminate duplicate inference.
    face_count, face_details, mesh_result = _face_count_with_details(img)
    looking_at_screen, gaze_direction, gaze_confidence = _gaze_signal(img, mesh_result)
    camera_blocked, blocked_reason, blocked_confidence = _camera_blocked_signal(img)
    phone_objects = _phone_detections(img)
    phone_count = len(phone_objects)
    objects.extend(phone_objects)

    # CAMERA BLOCKED > CAMERA_BLOCKED_SECONDS
    if camera_blocked:
        if state["blocked_start"] is None:
            state["blocked_start"] = now
        elif now - float(state["blocked_start"]) > CAMERA_BLOCKED_SECONDS:
            blocked_duration = now - float(state["blocked_start"])
            emitted = _add_violation(
                violations,
                req.sessionId,
                "camera_blocked",
                "critical",
                max(75.0, blocked_confidence),
                "Camera view is blocked or unavailable",
                {
                    "reason": blocked_reason,
                    "durationSeconds": round(blocked_duration, 2),
                },
            )
            if emitted:
                state["blocked_start"] = now
    else:
        state["blocked_start"] = None

    # NO FACE > NO_FACE_SECONDS
    if face_count == 0:
        if state["no_face_start"] is None:
            state["no_face_start"] = now
        elif now - float(state["no_face_start"]) > NO_FACE_SECONDS:
            no_face_duration = now - float(state["no_face_start"])
            emitted = _add_violation(
                violations,
                req.sessionId,
                "face_not_detected",
                "high",
                92.0,
                "No candidate detected in camera frame",
                {"faceCount": face_count, "durationSeconds": round(no_face_duration, 2)},
            )
            # Reset start only when we actually emitted so the next interval
            # re-measures from now (avoids spamming back-to-back violations).
            if emitted:
                state["no_face_start"] = now
    else:
        state["no_face_start"] = None

    # MULTI FACE > MULTI_FACE_SECONDS
    if face_count > 1:
        if state["multi_face_start"] is None:
            state["multi_face_start"] = now
        elif now - float(state["multi_face_start"]) > MULTI_FACE_SECONDS:
            emitted = _add_violation(
                violations,
                req.sessionId,
                "multiple_faces",
                "critical",
                90.0,
                f"Multiple faces detected (faces={face_count})",
                {"faceCount": face_count},
            )
            if emitted:
                state["multi_face_start"] = now
    else:
        state["multi_face_start"] = None

    # LOOK AWAY > LOOK_AWAY_SECONDS (only when a face exists)
    if face_count > 0 and not looking_at_screen:
        if state["away_start"] is None:
            state["away_start"] = now
        elif now - float(state["away_start"]) > LOOK_AWAY_SECONDS:
            away_duration = now - float(state["away_start"])
            state["away_count"] = int(state.get("away_count", 0)) + 1
            emitted = _add_violation(
                violations,
                req.sessionId,
                "looking_away",
                "medium",
                max(65.0, gaze_confidence),
                f"Candidate appears to be looking {gaze_direction}",
                {
                    "direction": gaze_direction,
                    "durationSeconds": round(away_duration, 2),
                    "frequency": int(state["away_count"]),
                },
            )
            if emitted:
                state["away_start"] = now
    else:
        state["away_start"] = None

    # PHONE (debounced)
    if phone_count > 0 and (now - float(state["last_phone_emit"])) > PHONE_EMIT_COOLDOWN_SECONDS:
        emitted = _add_violation(
            violations,
            req.sessionId,
            "phone_detected",
            "critical",
            max([o["confidence"] for o in phone_objects]) if phone_objects else 88.0,
            f"Mobile phone detected ({phone_count})",
            {"phoneCount": phone_count},
        )
        if emitted:
            state["last_phone_emit"] = now

    response = {
        "violations": violations,
        "objects": objects,
        "face": {
            "detected": face_count > 0,
            "count": face_count,
            "confidence": 80.0 if face_count > 0 else 0.0,
            "lookingAtScreen": looking_at_screen,
            "gazeDirection": gaze_direction,
            "gazeConfidence": gaze_confidence,
            "cameraBlocked": camera_blocked,
        },
        "stats": {
            "personCount": face_count,
            "phoneCount": phone_count,
            "displayCount": 0,
            "bookCount": 0,
            "laptopCount": 0,
            "electronicCount": 0,
            "cameraBlocked": camera_blocked,
            "yoloLoaded": _model is not None,
        },
    }
    if CV_DEBUG:
        response["debug"] = {
            "faceDetectors": face_details,
            "frame": {"height": int(img.shape[0]), "width": int(img.shape[1])},
        }

    try:
        for violation in violations:
            logger.info(
                "[AI_PROCTOR_TRIGGER][python_cv] session=%s event=%s severity=%s confidence=%.2f",
                sid,
                str(violation.get("eventType")),
                str(violation.get("severity")),
                float(violation.get("confidence", 0.0)),
            )
        logger.info(
            "[PROCTOR_TRACE][adapter][analyze] session=%s violations=%d types=%s faceCount=%d phone=%d",
            sid,
            len(violations),
            [v.get("eventType") for v in violations],
            face_count,
            phone_count,
        )
    except Exception:
        pass

    return response
