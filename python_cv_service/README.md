# Python CV Service (Optional)

This service adds stronger computer-vision detection (OpenCV + YOLO + MediaPipe face detection) for proctoring.

## Run

> Note: MediaPipe currently does not ship wheels for Python 3.14.
> Use Python 3.11–3.12 (recommended) for this service.

```bash
cd python_cv_service
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8010
```

Optional (YOLO object detection, requires torch and long-path-safe environment):

```bash
pip install -r requirements-yolo.txt
```

## Build unified dataset in this project

This repo includes a merger script that combines extracted ZIP datasets into one YOLO dataset with classes:
`person`, `cell phone`, `book`, `laptop`, `monitor`.

```bash
python prepare_dataset.py
```

Generated structure:
- `dataset/images/train`
- `dataset/images/val`
- `dataset/labels/train`
- `dataset/labels/val`
- `dataset.yaml`
- `dataset_db/class_distribution.txt`

## Backend configuration

Set in `backend/.env`:

```env
PYTHON_CV_SERVICE_URL=http://localhost:8010
PYTHON_CV_TIMEOUT_MS=2500
PYTHON_CV_RETRY_COUNT=1
PYTHON_CV_RETRY_DELAY_MS=150
```

When configured, backend proctoring analysis calls `app.py` (`/analyze`) with frame snapshots and merges violations.

## Detection outputs

- `face_not_detected`
- `multiple_faces`
- `looking_away`
- `phone_detected`
- `camera_blocked`

## Tuning (environment variables)

```env
VIOLATION_COOLDOWN_SECONDS=3
PHONE_CONF=0.35
PHONE_MIN_AREA_RATIO=0.00005
NO_FACE_SECONDS=5
MULTI_FACE_SECONDS=3
LOOK_AWAY_SECONDS=3
PHONE_EMIT_COOLDOWN_SECONDS=3
CAMERA_BLOCKED_SECONDS=1.2
FACE_MIN_CONF=0.45
GAZE_LEFT_RIGHT_THRESHOLD=0.35
CAMERA_BLOCKED_DARK_THRESHOLD=18
CAMERA_BLOCKED_UNIFORM_THRESHOLD=8
YOLO_MODEL=yolov8n.pt
CV_ENABLED_EVENTS=face_not_detected,multiple_faces,phone_detected
CV_DEBUG=false
```

Lower confidence thresholds increase sensitivity but may increase false positives.

## Live violation test client

Run with webcam and verify live violations quickly:

```bash
cd python_cv_service
.venv\\Scripts\\activate
python test_ai.py --url http://127.0.0.1:8010/analyze --session-id demo
```

This prints live violation events from `app.py`.

## LIVE LOGS

Use these logs to monitor real-time AI proctoring behavior.

### 1) Start CV service with console logs

```bash
cd python_cv_service
.venv\\Scripts\\activate
uvicorn app:app --host 0.0.0.0 --port 8010 --log-level info
```

### 2) Run live test client (camera feed -> CV service)

```bash
python test_ai.py --url http://127.0.0.1:8010/analyze --session-id demo
```

### 3) Log lines to watch

- Python CV trigger logs:
  - `[AI_PROCTOR_TRIGGER][python_cv] session=... event=face_not_detected|multiple_faces|phone_detected ...`
- Test client live logs:
  - `[HEARTBEAT] req=... faceCount=... detected=... violations=... trace=None`
  - `[VIOLATION] event=... severity=... conf=...`

### 4) Backend trace logs (when connected)

Enable in `backend/.env`:

```env
PROCTOR_TRACE=true
```

Then watch for:

- `[PROCTOR_TRACE][backend][python_cv_result] ...`
- `[PROCTOR_TRACE][backend][python_violation_trigger] ...`
- `[PROCTOR_TRACE][backend][stored_violations] ...`

## About training for higher accuracy

The current service uses pretrained YOLO weights. For production-grade accuracy in your test environment, you should fine-tune on your own labeled dataset (classroom/webcam style images for phone, book, laptop, multi-person, no-person cases).

Recommended next step:
- Create a custom dataset in YOLO format
- Train/fine-tune with Ultralytics (`yolo detect train ...`)
- Set `YOLO_MODEL` to your trained `.pt`

You can also use the included trainer script:

```bash
python train_yolo.py --data dataset.yaml --model yolov8n.pt --epochs 80
```

Dataset YAML template is provided at `dataset.example.yaml`.

## Notes

- Service is optional; platform works without it.
- YOLO model file (`yolov8n.pt`) is auto-fetched by ultralytics if internet is available.
- For fully offline deployments, pre-download model weights and mount locally.
