# Communication Question Category (Written / Listening / Reading / Speaking)

## Context

Today the platform has exactly 3 question categories — MCQ, Coding, Behavioral — each hard-coded as its own Prisma model, its own admin form, its own candidate-rendering branch, and its own scoring branch. This adds a 4th category, **Communication**, split into 4 sub-types with genuinely different structures and grading methods:

| Sub-type | Structure | Grading |
|---|---|---|
| Written | Title + prompt, optional image *or* audio stimulus (recruiter picks per question), candidate types a response | LLM evaluates the typed text against the prompt (grammar/wording, IELTS-style) |
| Listening | Title + prompt + audio stimulus + MCQ options, with per-question player guardrails (replay limit, rewind on/off, speed lock) | Manual/auto MCQ exact-match (same as today's MCQ) |
| Reading | A shared passage + N linked MCQ questions ("passage group") | Manual/auto MCQ exact-match |
| Speaking | A topic (text and/or audio) + candidate records a spoken answer | WhisperX transcribes, a phoneme-level wav2vec2 model + forced aligner scores pronunciation against the transcript, a metrics aggregator computes WPM/pauses/Phone Error Rate, then Claude turns all of that into a final marks score + supplementary CEFR level (see Phase 4b) |

Research findings that shape this plan (from exploring the existing codebase):

- Every layer — Prisma schema (`TestQuestion` has one nullable FK per type), scoring (`scoreAttemptAnswers` in `backend/src/services/scoringService.ts`), the admin question-bank switch statements (`backend/src/controllers/repository.ts`, `frontend/src/pages/admin/repository/QuestionBank.tsx`), and candidate rendering (`frontend/src/pages/candidate/TestInterface.tsx`'s `RichQuestion.type` union) — is a **hard-coded 3-way fan-out, not a registry**. Adding Communication means touching all of these in parallel, the same way each existing type already does.
- `MediaAsset` currently only attaches to `MCQQuestion` (single FK). Audio upload/storage/validation/playback already works end-to-end for MCQ (`fileStorageService.ts` already allows `audio/mpeg|wav|ogg|webm` up to 50MB) — this plumbing is reusable, just needs a second FK for Communication.
- There is **no existing audio guardrail player** (replay limit / rewind lock / speed lock) — today's audio is a bare native `<audio controls>`. This must be built from scratch as a wrapper component.
- There is **no existing candidate audio-recording feature for answers** — the only `MediaRecorder` usage is `useProctoring.ts`'s continuous background evidence capture, architecturally unrelated to discrete per-question recording. Must be built from scratch.
- There is **no Whisper or any speech-to-text integration anywhere in the repo**. `python_cv_service` is a proctoring-only CV service (OpenCV/MediaPipe/YOLO, sub-3s latency budget, CPU-thread-pinned) — architecturally the wrong place to bolt on a Whisper model (different resource/latency profile). Self-hosted Whisper will live in a **new, separate Python service**.
- Closest existing analog for LLM grading: `backend/src/services/behavioralScoringService.ts` (`scoreBehavioralAnswer`) — builds a rubric prompt from question title/description/expectedAnswer + candidate answer, calls the shared `callLLM()` in `llmService.ts`, parses JSON, clamps marks. This is the template for Written and Speaking-content grading.
- "Full acoustic pronunciation model" is a genuinely open ML problem, not an API-integration task — it needs its own research spike (candidate approaches: phoneme-level forced alignment, wav2vec2-based pronunciation scoring, or a commercial pronunciation-assessment API). It's sequenced last (Phase 4b) so everything else ships and is usable first.

Given the size, this ships in phases — each phase is independently usable end-to-end (create question → candidate answers it → it's graded → it counts toward the test score) before moving to the next.

## Data Model (all sub-types, one Prisma model)

Following the existing "one wide row, nullable per-subtype columns" pattern (same as `TestQuestion`'s nullable FKs), add to `backend/prisma/schema.prisma`:

```prisma
enum QuestionRepositoryCategory { CODING, MCQ, BEHAVIORAL, COMMUNICATION }  // add COMMUNICATION

enum CommunicationSubType { WRITTEN, LISTENING, READING, SPEAKING }
enum WrittenStimulusType { NONE, IMAGE, AUDIO }

model ReadingPassage {
  id          String   @id @default(uuid())
  title       String
  passageText String
  adminId     String?
  admin       Admin?   @relation(fields: [adminId], references: [id])
  createdAt   DateTime @default(now())
  questions   CommunicationQuestion[]
}

model CommunicationQuestion {
  id                 String    @id @default(uuid())
  source             QuestionSource             @default(CUSTOM)
  repositoryCategory QuestionRepositoryCategory @default(COMMUNICATION)
  isEnabled          Boolean                    @default(true)
  subType            CommunicationSubType

  // shared
  title       String
  description String?      // prompt (Written/Listening) or topic text (Speaking); unused for Reading (passage carries text)
  marks       Int
  difficulty  String   @default("medium")
  topic       String?
  tags        String?  // JSON array

  // Written
  stimulusType   WrittenStimulusType? // NONE | IMAGE | AUDIO — recruiter's per-question choice
  evaluationNotes String?             // optional extra grading rubric beyond title+description

  // Listening & Reading (MCQ-shaped)
  options        String?  // JSON array
  correctAnswers String?  // JSON array
  explanation    String?
  isMultipleChoice Boolean @default(false)

  // Listening-only guardrails
  replayLimit      Int?     @default(1)
  allowRewind      Boolean? @default(true)
  allowSpeedChange Boolean? @default(true)
  fixedPlaybackSpeed Float? @default(1.0) // used when allowSpeedChange = false

  // Reading-only
  passageId String?
  passage   ReadingPassage? @relation(fields: [passageId], references: [id])

  // Speaking-only
  recordingTimeLimit Int?    // seconds

  adminId String?
  admin   Admin? @relation(fields: [adminId], references: [id])
  mediaAssets   MediaAsset[]
  testQuestions TestQuestion[]
  answers       CommunicationAnswer[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model CommunicationAnswer {
  id         String   @id @default(uuid())
  attemptId  String
  questionId String
  question   CommunicationQuestion @relation(fields: [questionId], references: [id])

  answerText      String?  // Written typed response
  selectedOptions String?  // JSON — Listening/Reading MCQ selection
  audioAssetId    String?  // Speaking recording (via MediaAsset)
  transcript      String?  // Speaking — Whisper output
  replayCount     Int?     @default(0) // Listening — guardrail telemetry

  isCorrect     Boolean? // Listening/Reading
  marksObtained Float?
  gradingDetail String?  // JSON — {contentScore, fluencyScore, pronunciationScore, reasoning} for Written/Speaking

  submittedAt DateTime @default(now())
  @@unique([attemptId, questionId])
}
```

Also: add `communicationQuestionId String?` + relation to `TestQuestion` (alongside the existing 3 nullable FKs) and extend `questionType` to accept `"communication"`; add `communicationQuestionId String?` + relation to `MediaAsset` (alongside its existing `mcqQuestionId`); add `communicationAnswers CommunicationAnswer[]` to `TestAttempt`.

## Phase 1 — Written (foundation: proves the whole pipeline with the simplest sub-type)

Ships: create a Written question (title, prompt, optional image/audio stimulus), candidate sees it and types a response, LLM grades it, score counts.

- **Schema**: the model above (all sub-type columns included now — cheaper than migrating repeatedly), migration.
- **Backend admin CRUD**: `backend/src/controllers/communicationQuestion.ts` (new, mirrors `mcqQuestion.ts`/`behavioralQuestion.ts`) — `createCommunicationQuestion`, `getCommunicationQuestions`, `getCommunicationQuestionById`, `updateCommunicationQuestion`, `deleteCommunicationQuestion`, with per-`subType` field validation (Written requires `title`+`description`; reject Listening-only fields, etc.). Routes in `backend/src/routes/admin.ts` mirroring the MCQ block.
- **Repository integration**: `backend/src/controllers/repository.ts` — add a `case 'COMMUNICATION'` branch everywhere the existing switch handles MCQ/Coding/Behavioral (`getRepositoryQuestions`, `createCustomCommunication`, `updateCustomCommunication`, `toggleRepositoryQuestion`, `deleteRepositoryQuestion`, `serializeCommunicationQuestion`).
- **Admin UI**: `frontend/src/pages/admin/CommunicationForm.tsx` (new) — a sub-type selector at the top; selecting `Written` reveals Title*, Description/Prompt* (compulsory, per your note — it's the LLM's evaluation reference), a stimulus-type toggle (None/Image/Audio) that conditionally shows the `MediaUploader` component (reuse from `MCQForm.tsx`, extended to post to `communicationQuestionId` instead of `mcqQuestionId`), optional `evaluationNotes`, then the shared marks/difficulty/topic/tags fields (reuse `DifficultyPicker`/`TagEditor` patterns already built in `AgentNewQuestionModal.tsx`). Other sub-types are stubbed (disabled/"coming soon") until their phases land.
- **Question Bank UI**: `frontend/src/pages/admin/repository/QuestionBank.tsx` — add `COMMUNICATION` to `SIDEBAR_ITEMS`, a sub-type filter/badge within that tab, icon mapping, and a "New Communication Question" entry in the create dropdown routing to `/admin/communication/new`.
- **Grading**: `backend/src/services/communicationScoringService.ts` (new) — `scoreWrittenAnswer(question, answerText)`, same shape as `scoreBehavioralAnswer` (system+user prompt built from title/description/evaluationNotes, rubric emphasizing grammar/wording/coherence per the IELTS-style note, calls shared `callLLM()`, parses JSON `{marksObtained, reasoning}` via `parseJSONFromLLM`). Wire an auto-grade path mirroring `autoGradeBehavioralAnswer` in `results.ts` (+ manual override endpoint `gradeCommunicationAnswer`).
- **Candidate flow**: `frontend/src/pages/candidate/TestInterface.tsx` — extend the `RichQuestion.type` union with `'communication'` (+ `subType`), add a render branch (Written: title/description/stimulus + `<textarea>`, same shape as today's Behavioral branch). `testStore.ts` — add `communicationAnswers` map + `saveCommunicationAnswer` action. Backend: `backend/src/controllers/candidate.ts` — extend the question-delivery `include`/mapper for `communicationQuestion`, and `backend/src/routes/candidate.ts` + a new `saveCommunicationAnswer` controller (upsert `CommunicationAnswer.answerText`, same pattern as `saveBehavioralAnswer`).
- **Scoring**: `backend/src/services/scoringService.ts` — extend `scoreAttemptAnswers`, `getAssignedQuestionIds`, `recalculateTestTotalMarks`, `recalculateTestsUsingQuestion` with a 4th branch (Written behaves like Behavioral: `pendingManualMarks` until AI/manually graded, then summed). Also extend `results.ts`'s `recalculateAttemptScore` and `reEvaluateAttempt`.

## Phase 2 — Listening (introduces the guarded audio player)

Ships: audio-stimulus MCQ questions with per-question playback guardrails.

- **Admin form**: extend `CommunicationForm.tsx`'s sub-type branch for Listening — Prompt title, Description, audio-only `MediaUploader`, an options/correct-answer editor identical to `MCQForm.tsx`'s (reuse that exact sub-component), optional Explanation, then a "Player Guardrails" section: replay-limit number input (default 1), "Allow rewind" checkbox, "Allow speed change" checkbox that reveals a fixed-speed selector (1x/0.75x/0.5x/0.25x) when unchecked.
- **New component**: `frontend/src/components/GuardedAudioPlayer.tsx` — wraps native `<audio>`, tracks replay count in state (blocks/warns past `replayLimit`, reporting the count back to the parent for `CommunicationAnswer.replayCount`), disables the native seek bar / ignores `seeking` events when `allowRewind` is false, locks `audio.playbackRate` and hides the browser's rate control when `allowSpeedChange` is false. Used by both `CommunicationForm.tsx` (admin preview) and `TestInterface.tsx` (candidate).
- **Candidate flow**: `TestInterface.tsx` Listening branch = `GuardedAudioPlayer` + the existing MCQ options-list rendering (reuse, don't reimplement).
- **Scoring**: Listening reuses the exact MCQ exact-match branch in `scoreAttemptAnswers` — same `options`/`correctAnswers` shape, just sourced from `CommunicationQuestion` rows instead of `MCQQuestion` rows. No new grading logic, just a second data source into the same comparison code.

## Phase 3 — Reading (passage groups)

Ships: a shared passage with multiple linked MCQ-shaped questions, displayed together.

- **Admin**: a small "Reading Passages" management UI (list/create passages — simplest as a section within `CommunicationForm.tsx`'s Reading branch: pick an existing passage from a dropdown or "+ New passage" inline modal reusing patterns from `AgentLibraryPickerModal.tsx`/`AgentNewQuestionModal.tsx`), then the same MCQ-shaped options/correct-answer editor as Listening (no audio, no guardrails).
- **Candidate flow**: `TestInterface.tsx` — when consecutive questions share a `passageId`, render the passage text once in a persistent side/top panel and cycle through its linked questions in the main panel (dedupe repeated passage rendering).
- **Scoring**: identical MCQ exact-match reuse as Listening.

## Phase 4 — Speaking

Concrete pipeline (agreed architecture — a modern, open-source implementation of the standard "Goodness of Pronunciation" approach used by real pronunciation-assessment systems):

```
[Candidate Audio]
       │
       ├──► 1. WhisperX (transcript + word-level timestamps)
       │
       ├──► 2. Wav2Vec2 phoneme CTC model + forced aligner
       │        (recognizes actually-spoken phonemes, aligns them
       │         against canonical phonemes G2P'd from the WhisperX
       │         transcript — no fixed script needed, since Speaking
       │         here is free-topic, not read-aloud)
       │
       ▼
[Metrics Aggregator] (WPM, pause count/duration, Phone Error Rate)
       │
       ▼
[3. Claude] ──► Final structured score
                 { marksObtained (primary, drives the rest of the
                   platform's marks-based scoring), cefrLevel
                   (A1–C2, supplementary), reasoning }
```

- **New component**: `frontend/src/components/AudioRecorder.tsx` — mic permission, `MediaRecorder`-based recording bounded by `recordingTimeLimit`, waveform/timer UI, produces a blob uploaded via the existing `adminApi`/candidate media-upload pipeline (reuse `fileStorageService.ts`, already supports audio up to 50MB) to get back an asset/file reference.
- **New Python service**: `python_speech_service/` (new sibling to `python_cv_service/`, same FastAPI-service shape). Two model stages: **WhisperX** (transcript + word timestamps, replaces plain `faster-whisper` from the earlier draft) and a separate **phoneme-level wav2vec2 CTC model** (e.g. `wav2vec2-lv-60-espeak-cv-ft`) + a grapheme-to-phoneme tool (`g2p_en`/espeak-ng) to get canonical phonemes from the WhisperX transcript, diffed against the recognized phonemes for Phone Error Rate and per-phone confidence. One endpoint `POST /transcribe-and-score` returning `{transcript, wordTimestamps, wpm, pauses, phoneErrorRate, perWordPronunciation}`. Separate service deliberately, per the earlier research: `python_cv_service` is CPU-thread-pinned for sub-3s per-frame proctoring inference — a different resource/latency profile than this pipeline. **GPU recommended** — meaningfully heavier than plain Whisper transcription alone (two models instead of one).
- **Backend**: `backend/src/services/speechService.ts` (new, mirrors `pythonVisionService.ts`'s call-out pattern) posts the candidate's recording to the speech service, stores `transcript` + the metrics on `CommunicationAnswer`.
- **Grading**: `communicationScoringService.ts` — `scoreSpeakingAnswer(question, transcript, metrics)` — Claude receives the transcript plus WPM/pauses/Phone Error Rate/per-word pronunciation data and returns structured JSON: `marksObtained` (0..question.marks, the number that actually counts toward the test score, consistent with every other question type) plus `cefrLevel` and `reasoning` as supplementary detail. Stored in `CommunicationAnswer.gradingDetail` as `{contentScore, fluencyScore, pronunciationScore, cefrLevel, reasoning}`.

**Infra note**: Whisper (and now WhisperX + the phoneme model) is not yet installed on the server — this needs to be set up there before `speechService.ts` can call it. Not blocking the plan, just a prerequisite to confirm before starting Phase 4 build work.

## Phase 5 (later, optional) — AI assistance

- Once Whisper transcription exists (4a), reuse it to auto-transcribe an uploaded Listening audio clip or feed a Reading passage into the existing `suggestNewQuestions`-style LLM prompt pattern (`backend/src/services/testAgentService.ts`) to draft candidate MCQs for the recruiter to review — answers the "can AI suggest questions from the audio?" question.
- Integrating Communication into the AI Test Generator wizard (`AgentTestForm.tsx`) — out of scope until the standalone category is solid, since that wizard already has its own significant complexity.

## Verification (per phase)

No automated test suite exists in this repo. For each phase: start a temp backend against the local dev DB, log in as the seeded admin, create one question of the relevant sub-type via the new API/UI, take the test as a candidate through the actual `TestInterface.tsx` flow (or via API calls mirroring it), submit an answer, confirm grading fires and `TestAttempt.score` updates correctly, then clean up test data — consistent with how every feature has been verified end-to-end rather than only type-checked.
