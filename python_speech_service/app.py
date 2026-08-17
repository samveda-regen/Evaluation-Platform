"""Speech transcription service for the Speaking communication sub-type.

Deliberately a separate service from python_cv_service: proctoring CV inference
is CPU-thread-pinned for sub-3s per-frame latency on many small images, while
Whisper transcription loads one larger model and processes a handful of
longer audio clips per test — a different resource/latency profile.
"""
from typing import List, Optional
import base64
import logging
import os
import tempfile
import time

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


def _load_dotenv() -> None:
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

from fastapi import FastAPI, HTTPException  # type: ignore
from pydantic import BaseModel
from faster_whisper import WhisperModel

app = FastAPI(title="Speech Transcription Service", version="1.0.0")
logger = logging.getLogger("speech_service")

WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en").strip() or "base.en"
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu").strip() or "cpu"
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip() or "int8"
# Long-pause threshold (seconds) between consecutive speech segments, used as a rough
# fluency signal (filler/hesitation gaps) for the LLM grader downstream.
PAUSE_THRESHOLD_SECONDS = float(os.getenv("PAUSE_THRESHOLD_SECONDS", "0.6"))

logger.info(f"Loading Whisper model '{WHISPER_MODEL_NAME}' ({WHISPER_DEVICE}/{WHISPER_COMPUTE_TYPE})...")
_t0 = time.time()
model = WhisperModel(WHISPER_MODEL_NAME, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)
logger.info(f"Whisper model loaded in {time.time() - _t0:.1f}s")


class TranscribeRequest(BaseModel):
    audio: str  # base64-encoded audio file (any container ffmpeg/av can decode: wav, webm, mp3, ogg, m4a)
    mimeType: Optional[str] = None


class Segment(BaseModel):
    text: str
    start: float
    end: float
    avgLogprob: float


class TranscribeResponse(BaseModel):
    transcript: str
    segments: List[Segment]
    language: str
    languageProbability: float
    durationSec: float
    wordCount: int
    wordsPerMinute: float
    pauseCount: int
    longestPauseSec: float


@app.get("/health")
def health():
    return {"status": "ok", "model": WHISPER_MODEL_NAME, "device": WHISPER_DEVICE}


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(req: TranscribeRequest):
    if not req.audio:
        raise HTTPException(status_code=400, detail="audio is required")

    try:
        audio_bytes = base64.b64decode(req.audio)
    except Exception:
        raise HTTPException(status_code=400, detail="audio must be valid base64")

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio payload is empty")

    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments_iter, info = model.transcribe(tmp_path, beam_size=5, vad_filter=True)
        segments = [
            Segment(text=seg.text.strip(), start=seg.start, end=seg.end, avgLogprob=seg.avg_logprob)
            for seg in segments_iter
        ]
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    transcript = " ".join(seg.text for seg in segments).strip()
    duration_sec = segments[-1].end if segments else 0.0
    word_count = len(transcript.split()) if transcript else 0
    wpm = (word_count / duration_sec * 60.0) if duration_sec > 0 else 0.0

    pauses = []
    for i in range(1, len(segments)):
        gap = segments[i].start - segments[i - 1].end
        if gap > 0:
            pauses.append(gap)
    pause_count = sum(1 for p in pauses if p >= PAUSE_THRESHOLD_SECONDS)
    longest_pause = max(pauses) if pauses else 0.0

    return TranscribeResponse(
        transcript=transcript,
        segments=segments,
        language=info.language,
        languageProbability=info.language_probability,
        durationSec=duration_sec,
        wordCount=word_count,
        wordsPerMinute=round(wpm, 1),
        pauseCount=pause_count,
        longestPauseSec=round(longest_pause, 2),
    )
