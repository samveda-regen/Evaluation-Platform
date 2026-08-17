#!/usr/bin/env bash
# Start the speech transcription service.
#
# One worker by default: the Whisper model is loaded once per worker process,
# and CPU transcription of a single candidate's recording is fast enough
# (~1-3s for a minute of audio with the base model) that concurrency across
# workers matters far less here than in the CV proctoring service.
#
# Environment variables:
#   WORKERS               - number of uvicorn worker processes (default: 1)
#   PORT                  - port to listen on (default: 8020)
#   WHISPER_MODEL          - faster-whisper model name (default: base.en)
#   WHISPER_DEVICE          - cpu | cuda (default: cpu)
#   WHISPER_COMPUTE_TYPE    - int8 | float16 | float32 (default: int8)

set -e

# Resolve uvicorn from this script's own .venv rather than relying on PATH — process
# managers (pm2, systemd) run this script in a fresh shell with no venv activated, so a
# bare `uvicorn` call fails with "command not found" even though `pip install` succeeded.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UVICORN="$SCRIPT_DIR/.venv/bin/uvicorn"
if [ ! -x "$UVICORN" ]; then
  UVICORN="uvicorn"  # fall back to PATH, e.g. if uvicorn is installed globally instead
fi

WORKERS="${WORKERS:-1}"
PORT="${PORT:-8020}"

echo "[Speech Service] Starting with $WORKERS worker(s) on port $PORT"

exec "$UVICORN" app:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers "$WORKERS" \
  --log-level info
