# Python Speech Service (Optional)

Self-hosted speech-to-text transcription for the Speaking sub-type of Communication
questions, using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2
Whisper — no GPU or full PyTorch install required).

A separate service from `python_cv_service` on purpose: proctoring CV inference is
CPU-thread-pinned for sub-3s per-frame latency across many small images; this service
loads one larger model and processes a handful of longer audio clips per test — a
different resource/latency profile.

## Run

```bash
cd python_speech_service
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8020
```

The Whisper model downloads automatically from Hugging Face on first run (`base.en` is
~145MB) and is cached locally afterward. For fully offline deployments, pre-download the
model weights and set `HF_HOME` to a mounted cache directory.

## Backend configuration

Set in `backend/.env` (or the root `.env`):

```env
PYTHON_SPEECH_SERVICE_URL=http://localhost:8020
PYTHON_SPEECH_TIMEOUT_MS=30000
```

When configured, `backend/src/services/speechService.ts` posts a candidate's Speaking
recording to `/transcribe` and stores the transcript on `CommunicationAnswer.transcript`.
Speaking questions are rejected at save time if this isn't configured — unlike the CV
proctoring service, transcription isn't optional background enrichment; without it there's
nothing to grade.

## API

`POST /transcribe`

```json
{ "audio": "<base64-encoded audio bytes>", "mimeType": "audio/webm" }
```

Accepts any container faster-whisper/PyAV can decode (webm/opus from `MediaRecorder`, wav,
mp3, m4a, ogg — no separate system ffmpeg install needed, PyAV bundles it).

```json
{
  "transcript": "I believe strong communication skills are essential for remote teams to succeed.",
  "segments": [{ "text": "...", "start": 0.0, "end": 4.96, "avgLogprob": -0.18 }],
  "language": "en",
  "languageProbability": 1.0,
  "durationSec": 4.96,
  "wordCount": 12,
  "wordsPerMinute": 145.2,
  "pauseCount": 0,
  "longestPauseSec": 0.0
}
```

`wordsPerMinute`, `pauseCount`, and `longestPauseSec` are rough fluency signals (derived
from segment timing) passed to the LLM content/fluency grader alongside the transcript —
not a substitute for acoustic pronunciation scoring, which is a separate, harder problem
(see the Communication question category plan doc for the Phase 4b research note).

`GET /health` — `{"status": "ok", "model": "base.en", "device": "cpu"}`

## Tuning (environment variables)

```env
WHISPER_MODEL=base.en           # tiny.en/base.en/small.en/medium.en, or multilingual (drop .en) variants
WHISPER_DEVICE=cpu              # cpu | cuda
WHISPER_COMPUTE_TYPE=int8       # int8 (fastest on CPU) | float16 (GPU) | float32
PAUSE_THRESHOLD_SECONDS=0.6     # gap between segments counted as a "pause" for the fluency signal
```

Larger models improve accuracy at the cost of latency/memory — `base.en` was verified
locally to transcribe a ~5s clip in ~1.4s on CPU after a ~26s one-time model load.

## Notes

- Service is optional; the platform works without it — Speaking questions simply can't be
  auto-transcribed/graded until it's configured, same as the "Whisper not installed yet"
  gap this service closes.
- `.en` model variants are English-only and slightly faster/more accurate than the
  multilingual equivalents; switch to a multilingual model if non-English candidates are
  expected.
