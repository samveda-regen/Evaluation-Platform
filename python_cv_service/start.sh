#!/usr/bin/env bash
# Start the Python CV service with multiple workers for scale.
#
# Each worker is a separate process with its own copy of YOLO + MediaPipe loaded
# in memory. More workers = more concurrent frames processed simultaneously.
#
# Rule of thumb:
#   CPU-only  : WORKERS = number of physical cores (e.g. 4 on a 4-core droplet)
#   GPU       : WORKERS = 1-2 (GPU is shared; more workers fight over it)
#
# Environment variables:
#   WORKERS              - number of uvicorn worker processes (default: 4)
#   CV_INFERENCE_THREADS - thread-pool size within each worker (default: 2)
#   PORT                 - port to listen on (default: 8010)

set -e

WORKERS="${WORKERS:-4}"
PORT="${PORT:-8010}"

echo "[CV Service] Starting with $WORKERS workers on port $PORT"

exec uvicorn app:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers "$WORKERS" \
  --log-level warning