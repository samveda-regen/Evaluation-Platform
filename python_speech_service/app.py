"""Speech transcription + pronunciation scoring service for the Speaking sub-type.

Deliberately a separate service from python_cv_service: proctoring CV inference
is CPU-thread-pinned for sub-3s per-frame latency on many small images, while
this service loads larger models and processes a handful of longer audio clips
per test — a different resource/latency profile.

Two independent capabilities:
  1. Transcription (faster-whisper) — always on, required for content/fluency grading.
  2. Pronunciation scoring (wav2vec2 phoneme CTC + espeak G2P) — optional, degrades
     gracefully if the phoneme model or espeak isn't available on this deployment.
     This estimates a Phone Error Rate between what the candidate was expected to
     say (G2P'd from the Whisper transcript) and what they were acoustically
     recognized as saying — a genuinely different (and harder) problem than
     transcription, since ASR models are often robust to mispronunciation in ways
     a phoneme-level pronunciation check should not be.
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

# PHONEMIZER_ESPEAK_LIBRARY / PHONEMIZER_ESPEAK_PATH (settable via .env, loaded above)
# must be visible before phonemizer/transformers touch espeak — the phoneme tokenizer
# initializes the phonemizer backend at construction time. On Linux with espeak-ng
# installed via the system package manager, phonemizer usually finds it automatically
# and these are unnecessary; Windows needs them pointed at the eSpeak NG install.

from fastapi import FastAPI, HTTPException  # type: ignore
from pydantic import BaseModel
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

app = FastAPI(title="Speech Transcription Service", version="2.0.0")
logger = logging.getLogger("speech_service")

WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en").strip() or "base.en"
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu").strip() or "cpu"
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip() or "int8"
# Gap (seconds) between consecutive recognized words, used as a rough fluency signal
# (hesitation/filler gaps) for the LLM grader downstream.
PAUSE_THRESHOLD_SECONDS = float(os.getenv("PAUSE_THRESHOLD_SECONDS", "0.6"))

logger.info(f"Loading Whisper model '{WHISPER_MODEL_NAME}' ({WHISPER_DEVICE}/{WHISPER_COMPUTE_TYPE})...")
_t0 = time.time()
model = WhisperModel(WHISPER_MODEL_NAME, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)
logger.info(f"Whisper model loaded in {time.time() - _t0:.1f}s")

# -- Pronunciation scoring (optional, degrades gracefully) ------------------------
PRONUNCIATION_MODEL_ENABLED = os.getenv("PRONUNCIATION_MODEL_ENABLED", "true").strip().lower() == "true"
PHONEME_MODEL_NAME = os.getenv("PHONEME_MODEL", "facebook/wav2vec2-lv-60-espeak-cv-ft").strip()
PHONEMIZER_LANGUAGE = os.getenv("PHONEMIZER_LANGUAGE", "en-us").strip()

phoneme_processor = None
phoneme_model = None
phonemize_fn = None
pronunciation_available = False

if PRONUNCIATION_MODEL_ENABLED:
    try:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        from phonemizer import phonemize as _phonemize
        from phonemizer.separator import Separator

        _t0 = time.time()
        phoneme_processor = Wav2Vec2Processor.from_pretrained(PHONEME_MODEL_NAME)
        phoneme_model = Wav2Vec2ForCTC.from_pretrained(PHONEME_MODEL_NAME)
        phoneme_model.eval()
        # word must differ from phone as a *string* (phonemizer rejects identical
        # separators) but both are still plain whitespace, so str.split() tokenizes
        # correctly either way. Without a distinct word separator, phonemizer glues the
        # last phone of one word onto the first phone of the next (e.g. "aɪ"+"b" ->
        # "aɪb"), corrupting phone-level tokenization.
        _phone_separator = Separator(phone=" ", word="  ", syllable="")

        def phonemize_fn(text: str) -> str:
            return _phonemize(
                text, language=PHONEMIZER_LANGUAGE, backend="espeak",
                separator=_phone_separator, strip=True, preserve_punctuation=False,
            )

        pronunciation_available = True
        logger.info(f"Phoneme model '{PHONEME_MODEL_NAME}' loaded in {time.time() - _t0:.1f}s")
    except Exception as e:
        logger.warning(f"Pronunciation scoring unavailable (transcription still works): {e}")
        pronunciation_available = False


def phone_error_rate(expected: List[str], recognized: List[str]) -> float:
    """Levenshtein edit distance between two phone sequences, normalized by the
    expected length (standard PER definition, mirrors word error rate but at the
    phone level)."""
    n, m = len(expected), len(recognized)
    if n == 0:
        return 0.0 if m == 0 else 1.0
    prev_row = list(range(m + 1))
    for i in range(1, n + 1):
        curr_row = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if expected[i - 1] == recognized[j - 1] else 1
            curr_row[j] = min(
                prev_row[j] + 1,       # deletion
                curr_row[j - 1] + 1,   # insertion
                prev_row[j - 1] + cost,  # substitution
            )
        prev_row = curr_row
    return min(1.0, prev_row[m] / n)


class TranscribeRequest(BaseModel):
    audio: str  # base64-encoded audio file (any container ffmpeg/av can decode: wav, webm, mp3, ogg, m4a)
    mimeType: Optional[str] = None


class Segment(BaseModel):
    text: str
    start: float
    end: float
    avgLogprob: float


class Word(BaseModel):
    word: str
    start: float
    end: float
    probability: float


class TranscribeResponse(BaseModel):
    transcript: str
    segments: List[Segment]
    words: List[Word]
    language: str
    languageProbability: float
    durationSec: float
    wordCount: int
    wordsPerMinute: float
    pauseCount: int
    longestPauseSec: float
    pronunciationAvailable: bool
    expectedPhonemes: Optional[str] = None
    recognizedPhonemes: Optional[str] = None
    phoneErrorRate: Optional[float] = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": WHISPER_MODEL_NAME,
        "device": WHISPER_DEVICE,
        "pronunciationAvailable": pronunciation_available,
    }


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
        # Decode once at 16kHz mono, shared by both the transcription and the
        # pronunciation model — avoids decoding the same clip twice.
        audio_array = decode_audio(tmp_path, sampling_rate=16000)

        segments_iter, info = model.transcribe(
            audio_array, beam_size=5, vad_filter=True, word_timestamps=True,
        )
        segments = []
        words: List[Word] = []
        for seg in segments_iter:
            segments.append(Segment(text=seg.text.strip(), start=seg.start, end=seg.end, avgLogprob=seg.avg_logprob))
            for w in (seg.words or []):
                words.append(Word(word=w.word.strip(), start=w.start, end=w.end, probability=w.probability))
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

    # Word-level gaps give a finer-grained hesitation signal than segment-level gaps
    # (VAD segments can span multiple words with an in-sentence pause between them).
    pauses = []
    for i in range(1, len(words)):
        gap = words[i].start - words[i - 1].end
        if gap > 0:
            pauses.append(gap)
    pause_count = sum(1 for p in pauses if p >= PAUSE_THRESHOLD_SECONDS)
    longest_pause = max(pauses) if pauses else 0.0

    expected_phonemes = None
    recognized_phonemes = None
    per = None
    if pronunciation_available and transcript:
        try:
            import torch
            expected_phonemes = phonemize_fn(transcript).strip()

            inputs = phoneme_processor(audio_array, sampling_rate=16000, return_tensors="pt")
            with torch.no_grad():
                logits = phoneme_model(inputs.input_values).logits
            pred_ids = torch.argmax(logits, dim=-1)
            recognized_phonemes = phoneme_processor.batch_decode(pred_ids)[0].strip()

            per = phone_error_rate(expected_phonemes.split(), recognized_phonemes.split())
        except Exception as e:
            logger.error(f"Pronunciation scoring failed (transcript still returned): {e}")

    return TranscribeResponse(
        transcript=transcript,
        segments=segments,
        words=words,
        language=info.language,
        languageProbability=info.language_probability,
        durationSec=duration_sec,
        wordCount=word_count,
        wordsPerMinute=round(wpm, 1),
        pauseCount=pause_count,
        longestPauseSec=round(longest_pause, 2),
        pronunciationAvailable=pronunciation_available,
        expectedPhonemes=expected_phonemes,
        recognizedPhonemes=recognized_phonemes,
        phoneErrorRate=round(per, 4) if per is not None else None,
    )
