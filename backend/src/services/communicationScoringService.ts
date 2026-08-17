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

interface ScoreSpeakingAnswerInput {
  title: string;
  description: string | null;
  evaluationNotes: string | null;
  maxMarks: number;
  transcript: string;
  wordsPerMinute: number;
  pauseCount: number;
  longestPauseSec: number;
}

interface ScoreSpeakingAnswerResult {
  marksObtained: number;
  contentScore: number;
  fluencyScore: number;
  reasoning: string;
}

// Auto-grades a Speaking communication answer from its Whisper transcript plus rough timing-derived
// fluency signals (words/minute, pause count/length) — not acoustic pronunciation, which is a
// separate, harder problem (see the Communication question category plan's Phase 4b note). Marks
// are the primary score; content and fluency sub-scores are informational context for the reviewer.
export async function scoreSpeakingAnswer(input: ScoreSpeakingAnswerInput): Promise<ScoreSpeakingAnswerResult> {
  const { title, description, evaluationNotes, maxMarks, transcript, wordsPerMinute, pauseCount, longestPauseSec } = input;

  if (!transcript || !transcript.trim()) {
    return { marksObtained: 0, contentScore: 0, fluencyScore: 0, reasoning: 'No speech was detected in the recording.' };
  }

  const systemPrompt = 'You are an expert spoken-English examiner, grading a transcribed spoken response in the style of IELTS Speaking band descriptors (fluency and coherence, lexical resource, grammatical range and accuracy, task response). You only have the transcript and rough timing signals (words per minute, pause count/length) — not the audio itself, so do not comment on pronunciation, accent, or intonation. Respond with JSON only, no markdown.';

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

## Instructions
Judge content (does it directly and substantively address the topic) and fluency/coherence (sentence structure, filler-word-like disfluencies visible in the transcript, and whether the pacing/pause signals suggest hesitant speech) separately, then combine into a single overall score. Do not penalize for things you cannot know from a transcript (accent, pronunciation, tone).

Score on a continuous scale from 0 to ${maxMarks}, one decimal place. Content and fluency sub-scores are on a 0-10 scale each, for reviewer context only — they do not need to average to the marks value.

Respond with strict JSON only:
{
  "marksObtained": <number between 0 and ${maxMarks}, one decimal place>,
  "contentScore": <0-10>,
  "fluencyScore": <0-10>,
  "reasoning": "<2-3 sentence justification covering content and fluency>"
}`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { temperature: 0.2, maxTokens: 450 });

  const parsed = parseJSONFromLLM(response.content) as {
    marksObtained?: unknown; contentScore?: unknown; fluencyScore?: unknown; reasoning?: unknown;
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

  return {
    marksObtained: clampedMarks,
    contentScore: clampScore10(parsed.contentScore),
    fluencyScore: clampScore10(parsed.fluencyScore),
    reasoning,
  };
}
