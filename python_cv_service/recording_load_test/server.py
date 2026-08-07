"""
Standalone recording-upload capacity test — SERVER half.

Not part of the Evaluation-Platform app. Purpose-built to isolate and
measure exactly the CPU/disk/network cost a video-recording-upload endpoint
pays per chunk, with nothing else in the way: no auth, no database, no app
logic. Two operations, matching what any such endpoint fundamentally does:
  1. base64-decode the incoming chunk (real CPU work)
  2. write the decoded bytes to local disk (real disk I/O)

Run pinned to a single core so results directly answer "how many concurrent
users can ONE vCPU sustain for this workload":
    python3 server.py --port 9000 --core 0

Requires: fastapi, uvicorn, psutil — all already present in this project's
own python_cv_service venv (source ../.venv/bin/activate before running).
"""
import argparse
import base64
import os
import time
from pathlib import Path

from fastapi import FastAPI, Request
import uvicorn


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
    return "could NOT pin CPU affinity (psutil not installed / unsupported OS) — running unpinned"


app = FastAPI()
STORAGE_DIR = Path("recorded_chunks")
STORAGE_DIR.mkdir(exist_ok=True)

_stats = {"chunks_received": 0, "bytes_written": 0, "started_at": time.time()}


@app.post("/upload/{user_id}")
async def upload_chunk(user_id: str, request: Request):
    body = await request.json()
    chunk_b64 = body.get("chunkData", "")

    # Real cost #1: base64 decode — same operation the real backend does
    # (Buffer.from(chunkData, 'base64')).
    raw_bytes = base64.b64decode(chunk_b64)

    # Real cost #2: write to local disk — same operation the real backend
    # does (fs.writeFile). Filename includes user_id + a monotonically
    # increasing counter so concurrent users never collide on one file.
    _stats["chunks_received"] += 1
    _stats["bytes_written"] += len(raw_bytes)
    filename = STORAGE_DIR / f"{user_id}_{_stats['chunks_received']}.bin"
    with open(filename, "wb") as f:
        f.write(raw_bytes)

    return {"success": True, "bytesWritten": len(raw_bytes)}


@app.get("/stats")
async def stats():
    elapsed = max(0.001, time.time() - _stats["started_at"])
    return {
        **_stats,
        "elapsedSeconds": round(elapsed, 1),
        "avgThroughputMBps": round((_stats["bytes_written"] / (1024 * 1024)) / elapsed, 2),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Standalone recording-upload capacity test server")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--core", type=int, default=0, help="logical CPU core to pin this process to")
    parser.add_argument("--no-pin", action="store_true", help="skip CPU affinity pinning")
    args = parser.parse_args()

    if args.no_pin:
        print("[SETUP] CPU pinning skipped (--no-pin)")
    else:
        print(f"[SETUP] {pin_to_single_cpu(args.core)}")

    print(f"[SETUP] storing received chunks in ./{STORAGE_DIR}/")
    print(f"[SETUP] listening on 0.0.0.0:{args.port} — single worker, matching a single vCPU")
    uvicorn.run(app, host="0.0.0.0", port=args.port, workers=1, log_level="warning")
