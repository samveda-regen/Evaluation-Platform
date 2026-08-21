# Python Speech Service (Optional)

Self-hosted speech-to-text transcription, plus pronunciation scoring, for the Speaking
sub-type of Communication questions.

- **Transcription**: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
  (CTranslate2 Whisper — no GPU or full PyTorch install required). Always on; required for
  content/fluency grading.
- **Pronunciation scoring** (optional, degrades gracefully): a phoneme-level check — the
  Whisper transcript is converted to its expected phonemes via `espeak-ng` G2P
  (`phonemizer`), the actual audio is independently run through
  `facebook/wav2vec2-lv-60-espeak-cv-ft` (a phoneme-recognition CTC model), and the two
  phoneme sequences are compared with a Levenshtein-based Phone Error Rate. This is a
  genuinely different (and harder) signal than transcription — ASR models are often robust
  to mispronunciation in ways a phoneme-level acoustic check should not be. If `espeak-ng`
  or the phoneme model can't load, the service logs a warning and continues serving
  transcription-only responses (`pronunciationAvailable: false`) rather than failing.

A separate service from `python_cv_service` on purpose: proctoring CV inference is
CPU-thread-pinned for sub-3s per-frame latency across many small images; this service
loads larger models and processes a handful of longer audio clips per test — a different
resource/latency profile.

## Run

```bash
cd python_speech_service
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8020
```

The Whisper model (`base.en`, ~145MB) and the phoneme model (wav2vec2-large, ~1.2GB)
download automatically from Hugging Face on first run and are cached locally afterward.
For fully offline deployments, pre-download the model weights and set `HF_HOME` to a
mounted cache directory.

**Pronunciation scoring also needs `espeak-ng` installed as a system package**, since
`phonemizer` shells out to it for text-to-phoneme conversion:

```bash
# Linux
apt-get install espeak-ng

# Windows (dev only — see PHONEMIZER_ESPEAK_LIBRARY/PATH below)
winget install eSpeak-NG.eSpeak-NG
```

On Linux, `phonemizer` typically finds a system-installed `espeak-ng` automatically. On
Windows, or if it doesn't, set:

```env
PHONEMIZER_ESPEAK_LIBRARY=C:\Program Files\eSpeak NG\libespeak-ng.dll
PHONEMIZER_ESPEAK_PATH=C:\Program Files\eSpeak NG\espeak-ng.exe
```

If `espeak-ng` isn't installed at all, transcription still works fine — only
`pronunciationAvailable` flips to `false`.

## Backend configuration

Set in `backend/.env` (or the root `.env`):

```env
PYTHON_SPEECH_SERVICE_URL=http://localhost:8020
PYTHON_SPEECH_TIMEOUT_MS=60000
```

When configured, `backend/src/services/speechService.ts` posts a candidate's Speaking
recording to `/transcribe` and stores the transcript (plus fluency/pronunciation signals)
on `CommunicationAnswer`. Speaking questions are rejected at save time if this isn't
configured — unlike the CV proctoring service, transcription isn't optional background
enrichment; without it there's nothing to grade.

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
  "words": [{ "word": "I", "start": 0.0, "end": 0.18, "probability": 0.99 }],
  "language": "en",
  "languageProbability": 1.0,
  "durationSec": 4.96,
  "wordCount": 12,
  "wordsPerMinute": 145.2,
  "pauseCount": 0,
  "longestPauseSec": 0.0,
  "pronunciationAvailable": true,
  "expectedPhonemes": "aɪ  b ᵻ l iː v  s t ɹ ɔ ŋ  ...",
  "recognizedPhonemes": "aɪ b ᵻ l iː v s t ɹ ɑː ŋ ...",
  "phoneErrorRate": 0.0727
}
```

`wordsPerMinute`, `pauseCount`, and `longestPauseSec` are rough fluency signals (derived
from word-level timestamps) passed to the LLM content/fluency grader alongside the
transcript. `phoneErrorRate` (0 = phonemes matched exactly, 1 = no match) is the
pronunciation-accuracy signal, also passed to the LLM — see `scoreSpeakingAnswer` in
`backend/src/services/communicationScoringService.ts` for how it's combined with content
and fluency into `marksObtained` (primary) and a supplementary `cefrLevel` estimate.

Verified locally: a clean TTS-synthesized reading of a sentence produced `phoneErrorRate`
≈0.07; the same audio acoustically degraded (low-pass filtered + pitch/time shifted, so
Whisper's transcript barely changed but the acoustic-phonetic content was destroyed)
produced `phoneErrorRate` ≈0.8 — confirming the metric actually tracks pronunciation
accuracy rather than just mirroring transcription confidence.

`GET /health` — `{"status": "ok", "model": "base.en", "device": "cpu", "pronunciationAvailable": true}`

## Tuning (environment variables)

```env
WHISPER_MODEL=base.en                 # tiny.en/base.en/small.en/medium.en, or multilingual (drop .en) variants
WHISPER_DEVICE=cpu                    # cpu | cuda
WHISPER_COMPUTE_TYPE=int8             # int8 (fastest on CPU) | float16 (GPU) | float32
PAUSE_THRESHOLD_SECONDS=0.6           # gap between words counted as a "pause" for the fluency signal
PRONUNCIATION_MODEL_ENABLED=true      # set false to skip loading the phoneme model entirely (saves ~1.2GB + load time)
PHONEME_MODEL=facebook/wav2vec2-lv-60-espeak-cv-ft
PHONEMIZER_LANGUAGE=en-us
```

Larger Whisper models improve transcription accuracy at the cost of latency/memory —
`base.en` was verified locally to transcribe a ~5s clip in ~1.4s on CPU after a one-time
model load. The phoneme model is a `wav2vec2-large` checkpoint (heavier); GPU is
recommended for it in production, per the original plan's Phase 4b note — CPU inference on
a ~5s clip was still well under a second in local testing, but that will scale with clip
length and concurrent load.

## Notes

- Transcription is optional at the platform level; pronunciation scoring is optional
  within that — the service degrades in two independent steps (no service configured ->
  no Speaking grading at all; service configured but no espeak-ng/phoneme model -> content
  and fluency grading works, pronunciation/CEFR does not).
- `.en` Whisper model variants are English-only and slightly faster/more accurate than the
  multilingual equivalents; switch to a multilingual model if non-English candidates are
  expected. The phoneme model and `PHONEMIZER_LANGUAGE` would also need matching
  non-English configuration in that case — this service has only been verified for English.
