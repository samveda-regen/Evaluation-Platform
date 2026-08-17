import { callLLM, parseJSONFromLLM } from './llmService.js';

interface ScoreWrittenAnswerInput {
  title: string;
  description: string;
  evaluationNotes: string | null;
  maxMarks: number;
  answerText: string;
}

interface ScoreWrittenAnswerResult {
  marksObtained: number;
  reasoning: string;
}

// Auto-grades a Written communication answer (free-text response to a prompt, optionally with an
// image/audio stimulus) using the shared LLM client — grammar/wording/coherence-focused, IELTS-style,
// rather than the content-correctness rubric used for Behavioral answers. Never persists anything
// itself, mirroring scoreBehavioralAnswer's contract.
export async function scoreWrittenAnswer(input: ScoreWrittenAnswerInput): Promise<ScoreWrittenAnswerResult> {
  const { title, description, evaluationNotes, maxMarks, answerText } = input;

  if (!answerText || !answerText.trim()) {
    return { marksObtained: 0, reasoning: 'No answer was provided by the candidate.' };
  }

  const systemPrompt = 'You are an expert English-language writing examiner, grading in the style of IELTS Writing band descriptors (task response, coherence and cohesion, lexical resource, grammatical range and accuracy). Score strictly and fairly using only the candidate\'s actual written text. Never invent details, and never reward vague or off-topic answers with a high score. Respond with JSON only, no markdown.';

  const userPrompt = `## Writing Prompt
Title: ${title}
Prompt: ${description}
${evaluationNotes && evaluationNotes.trim() ? `\n## Additional grading notes from the recruiter\n${evaluationNotes.trim()}` : ''}

## Maximum marks for this question
${maxMarks}

## Candidate's written response
${answerText}

## Instructions
Judge the response primarily on grammar, vocabulary/wording, coherence, and how directly it addresses the prompt — not on whether you personally agree with its opinions or content. Penalize grammatical errors, awkward phrasing, and responses that drift off-topic. Do not penalize brevity if the response is otherwise correct and on-topic.

Score on a continuous scale from 0 to ${maxMarks}, using exactly one decimal place (e.g. 3.4, 7.2, 1.5). Do not default to round numbers unless truly warranted. The score must never be negative and must never exceed ${maxMarks}.

Respond with strict JSON only:
{
  "marksObtained": <number between 0 and ${maxMarks}, one decimal place>,
  "reasoning": "<2-3 sentence justification covering grammar/wording and task response>"
}`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { temperature: 0.2, maxTokens: 400 });

  const parsed = parseJSONFromLLM(response.content) as { marksObtained?: unknown; reasoning?: unknown };

  const rawMarks = Number(parsed.marksObtained);
  if (!Number.isFinite(rawMarks)) {
    throw new Error('LLM did not return a valid numeric score');
  }

  const clamped = Math.min(maxMarks, Math.max(0, rawMarks));
  const rounded = Math.round(clamped * 10) / 10;

  const reasoning = typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
    ? parsed.reasoning.trim()
    : 'No reasoning provided.';

  return { marksObtained: rounded, reasoning };
}

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
type CefrLevel = typeof CEFR_LEVELS[number];

interface ScoreSpeakingAnswerInput {
  title: string;
  description: string | null;
  evaluationNotes: string | null;
  maxMarks: number;
  transcript: string;
  wordsPerMinute: number;
  pauseCount: number;
  longestPauseSec: number;
  // Phone Error Rate (0 = perfect match to expected pronunciation, 1 = no overlap) from the
  // wav2vec2 phoneme-CTC model vs. the espeak-G2P'd transcript — null when the Python speech
  // service's pronunciation model isn't available on this deployment.
  phoneErrorRate: number | null;
}

interface ScoreSpeakingAnswerResult {
  marksObtained: number;
  contentScore: number;
  fluencyScore: number;
  cefrLevel: CefrLevel | null;
  reasoning: string;
}

// Auto-grades a Speaking communication answer from its Whisper transcript, timing-derived fluency
// signals (words/minute, pause count/length), and — when available — a phone-level pronunciation
// accuracy signal (Phone Error Rate) computed separately from the transcript by the Python speech
// service, since ASR transcripts are often robust to mispronunciation in ways a phoneme-level
// acoustic check should not be. Marks are the primary score (drives scoring like every other
// question type); cefrLevel is supplementary context for the reviewer, not the primary output.
export async function scoreSpeakingAnswer(input: ScoreSpeakingAnswerInput): Promise<ScoreSpeakingAnswerResult> {
  const { title, description, evaluationNotes, maxMarks, transcript, wordsPerMinute, pauseCount, longestPauseSec, phoneErrorRate } = input;

  if (!transcript || !transcript.trim()) {
    return { marksObtained: 0, contentScore: 0, fluencyScore: 0, cefrLevel: null, reasoning: 'No speech was detected in the recording.' };
  }

  const hasPronunciation = typeof phoneErrorRate === 'number' && Number.isFinite(phoneErrorRate);

  const systemPrompt = `You are an expert spoken-English examiner, grading a transcribed spoken response in the style of IELTS Speaking band descriptors (fluency and coherence, lexical resource, grammatical range and accuracy, task response)${hasPronunciation ? ', with an additional phone-level pronunciation accuracy signal' : ''}. You only have the transcript, rough timing signals (words per minute, pause count/length)${hasPronunciation ? ', and a Phone Error Rate score' : ''} — not the audio itself, so do not comment on accent, intonation, or anything pronunciation-related beyond what the Phone Error Rate signal tells you${hasPronunciation ? '' : ' (none was provided for this answer)'}. Respond with JSON only, no markdown.`;

  const userPrompt = `## Speaking Topic
Title: ${title}
${description && description.trim() ? `Topic/prompt: ${description.trim()}` : ''}
${evaluationNotes && evaluationNotes.trim() ? `\n## Additional grading notes from the recruiter\n${evaluationNotes.trim()}` : ''}

## Maximum marks for this question
${maxMarks}

## Transcript of candidate's spoken response
${transcript}

## Timing signals (derived from speech-to-text, not exact — use only as a rough fluency indicator)
Words per minute: ${wordsPerMinute}
Long pauses (>0.6s) detected: ${pauseCount}
Longest pause: ${longestPauseSec}s
${hasPronunciation ? `\n## Pronunciation signal\nPhone Error Rate: ${(phoneErrorRate as number).toFixed(3)} (0 = phonemes matched the expected pronunciation of the transcript exactly, 1 = essentially no match — computed separately from a phoneme-recognition model, not from the transcript, so it can catch mispronunciation the transcript alone would not reveal)` : '\n## Pronunciation signal\nNot available for this answer — do not estimate or guess a CEFR level that implies pronunciation was assessed; base cefrLevel only on fluency, vocabulary, and grammar visible in the transcript, or return null if you cannot responsibly estimate it without any acoustic signal.'}

## Instructions
Judge content (does it directly and substantively address the topic) and fluency/coherence (sentence structure, filler-word-like disfluencies visible in the transcript, and whether the pacing/pause signals suggest hesitant speech) separately, then combine into a single overall score. marksObtained is the primary result and must be driven mainly by content and fluency/coherence — do not let the Phone Error Rate dominate it (a candidate can answer well with an accent that raises PER without being wrong). Use the pronunciation signal only as one input toward the supplementary cefrLevel estimate (A1-C2), alongside vocabulary range and grammatical accuracy from the transcript.

Score on a continuous scale from 0 to ${maxMarks}, one decimal place. Content and fluency sub-scores are on a 0-10 scale each, for reviewer context only — they do not need to average to the marks value.

Respond with strict JSON only:
{
  "marksObtained": <number between 0 and ${maxMarks}, one decimal place>,
  "contentScore": <0-10>,
  "fluencyScore": <0-10>,
  "cefrLevel": <one of "A1","A2","B1","B2","C1","C2", or null if you cannot responsibly estimate it>,
  "reasoning": "<2-3 sentence justification covering content and fluency, and pronunciation only if a Phone Error Rate signal was provided>"
}`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { temperature: 0.2, maxTokens: 500 });

  const parsed = parseJSONFromLLM(response.content) as {
    marksObtained?: unknown; contentScore?: unknown; fluencyScore?: unknown; cefrLevel?: unknown; reasoning?: unknown;
  };

  const rawMarks = Number(parsed.marksObtained);
  if (!Number.isFinite(rawMarks)) {
    throw new Error('LLM did not return a valid numeric score');
  }

  const clampedMarks = Math.round(Math.min(maxMarks, Math.max(0, rawMarks)) * 10) / 10;
  const clampScore10 = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(10, Math.max(0, n)) * 10) / 10 : 0;
  };

  const reasoning = typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
    ? parsed.reasoning.trim()
    : 'No reasoning provided.';

  const cefrLevel = (CEFR_LEVELS as readonly string[]).includes(String(parsed.cefrLevel))
    ? (parsed.cefrLevel as CefrLevel)
    : null;

  return {
    marksObtained: clampedMarks,
    contentScore: clampScore10(parsed.contentScore),
    fluencyScore: clampScore10(parsed.fluencyScore),
    cefrLevel,
    reasoning,
  };
}
