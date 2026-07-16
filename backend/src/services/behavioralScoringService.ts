import { callLLM, parseJSONFromLLM } from './llmService';

interface ScoreBehavioralAnswerInput {
  title: string;
  description: string;
  expectedAnswer: string | null;
  maxMarks: number;
  answerText: string;
}

interface ScoreBehavioralAnswerResult {
  marksObtained: number;
  reasoning: string;
}

// Auto-grades a free-text behavioral answer against the question library's benchmark
// expected answer using the project's shared LLM client. Never persists anything itself —
// callers must still go through the existing manual grade endpoint to save the score, so an
// admin always reviews/confirms before a hallucinated score can land in the DB.
export async function scoreBehavioralAnswer(input: ScoreBehavioralAnswerInput): Promise<ScoreBehavioralAnswerResult> {
  const { title, description, expectedAnswer, maxMarks, answerText } = input;

  if (!answerText || !answerText.trim()) {
    return { marksObtained: 0, reasoning: 'No answer was provided by the candidate.' };
  }

  const systemPrompt = 'You are an expert technical interviewer grading a candidate\'s answer to a behavioral interview question. Score strictly and fairly using only evidence present in the candidate\'s answer, compared against the benchmark expected answer. Never invent details the candidate did not state, and never reward vague or generic answers with a high score. Respond with JSON only, no markdown.';

  const userPrompt = `## Question
Title: ${title}
Prompt: ${description && description.trim() ? description : '(no additional prompt)'}

## Benchmark expected answer (grading reference, not shown to the candidate)
${expectedAnswer && expectedAnswer.trim() ? expectedAnswer : '(no benchmark provided — grade against general best practice for this question)'}

## Maximum marks for this question
${maxMarks}

## Candidate's answer
${answerText}

## Instructions
Judge how well the candidate's answer demonstrates the competency being evaluated relative to the benchmark: specificity of the example, ownership/actions taken, reasoning, outcome, and overall alignment with the benchmark's substance.

Score on a continuous scale from 0 to ${maxMarks}, using exactly one decimal place (e.g. 3.4, 7.2, 1.5). Do not default to round numbers unless truly warranted. The score must never be negative and must never exceed ${maxMarks}.

Respond with strict JSON only:
{
  "marksObtained": <number between 0 and ${maxMarks}, one decimal place>,
  "reasoning": "<2-3 sentence justification citing specific parts of the candidate's answer>"
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
