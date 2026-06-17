import { callLLM, parseJSONFromLLM } from './llmService.js';
import prisma from '../utils/db.js';
import { Prisma } from '@prisma/client';
import { DEFAULT_CUSTOM_AI_VIOLATION_EVENTS } from '../utils/proctoringConfig.js';

/* ── local helpers (no LLM required) ─────────────────────────────────── */

function hasLLMKey(): boolean {
  return !!(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function analyzeJobLocal(jobTitle: string, jobDescription?: string): {
  suggestedSkills: string[];
  suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  suggestedMcqCount: number;
  suggestedCodingCount: number;
  experienceLevel: string;
} {
  const text = `${jobTitle} ${jobDescription || ''}`;
  const patterns: [RegExp, string][] = [
    [/node\.?js/i, 'Node.js'], [/react\.?js|react\b/i, 'React'],
    [/typescript/i, 'TypeScript'], [/javascript/i, 'JavaScript'],
    [/python\b/i, 'Python'], [/\bjava\b/i, 'Java'],
    [/sql|mysql|postgres/i, 'SQL'], [/rest.?api|express/i, 'REST APIs'],
    [/mongodb|mongo\b/i, 'MongoDB'], [/docker|kubernetes/i, 'Docker'],
    [/aws|azure|gcp|cloud/i, 'Cloud/AWS'], [/vue\.?js/i, 'Vue.js'],
    [/angular\b/i, 'Angular'], [/django|flask/i, 'Django/Flask'],
    [/machine.?learning|ml\b/i, 'Machine Learning'],
    [/data.?struct|algorithm/i, 'Data Structures'],
    [/testing|jest|mocha/i, 'Testing'], [/css|html/i, 'CSS/HTML'],
    [/graphql/i, 'GraphQL'], [/redis/i, 'Redis'],
  ];
  const skills: string[] = [];
  for (const [re, skill] of patterns) {
    if (re.test(text)) skills.push(skill);
  }
  if ((skills.includes('Node.js') || skills.includes('React')) && !skills.includes('JavaScript')) {
    skills.unshift('JavaScript');
  }
  if (skills.length === 0) skills.push('Problem Solving', 'Algorithms', 'Data Structures', 'System Design');

  let experienceLevel = '2-5 years';
  if (/junior|entry|graduate|intern/i.test(text)) experienceLevel = '0-2 years';
  else if (/senior|lead|principal|staff/i.test(text)) experienceLevel = '5+ years';

  const suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed' =
    experienceLevel === '0-2 years' ? 'easy' :
    experienceLevel === '5+ years'  ? 'hard'  : 'mixed';

  return {
    suggestedSkills: skills.slice(0, 8),
    suggestedDifficulty,
    suggestedMcqCount: 10,
    suggestedCodingCount: 3,
    experienceLevel,
  };
}

function selectQuestionsLocally(
  mcqSummaries: QuestionSummary[],
  codingSummaries: QuestionSummary[],
  skills: string[],
  difficulty: string,
  mcqCount: number,
  codingCount: number,
  jobTitle: string,
  duration?: number
): QuestionSelection {
  const score = (q: QuestionSummary): number => {
    const hay = `${q.topic || ''} ${q.tags.join(' ')} ${q.text}`.toLowerCase();
    let s = 0;
    for (const skill of skills) {
      const kw = skill.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      for (const word of kw.split(/\s+/)) {
        if (word.length > 2 && hay.includes(word)) s++;
      }
    }
    if (difficulty === 'mixed' || q.difficulty === difficulty) s += 0.5;
    return s;
  };

  const pickedMcq = [...mcqSummaries].sort((a, b) => score(b) - score(a)).slice(0, mcqCount);
  const pickedCoding = [...codingSummaries].sort((a, b) => score(b) - score(a)).slice(0, codingCount);

  return {
    mcqQuestionIds: pickedMcq.map(q => q.id),
    codingQuestionIds: pickedCoding.map(q => q.id),
    mcqPreviews: pickedMcq.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    codingPreviews: pickedCoding.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    reasoning: `Selected ${pickedMcq.length} MCQ and ${pickedCoding.length} coding questions matched against: ${skills.join(', ')}.`,
    suggestedDuration: duration || pickedMcq.length * 2 + pickedCoding.length * 20,
    suggestedTestName: `${jobTitle} Assessment`,
    suggestedDescription: `Assessment for ${jobTitle} covering ${skills.slice(0, 3).join(', ')} and related topics.`,
  };
}

interface JobProfile {
  title: string;
  experience: string; // e.g., "0-2 years", "3-5 years", "5+ years"
  description?: string;
}

interface TestGenerationRequest {
  jobProfile: JobProfile;
  skills: string[];
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  mcqCount: number;
  codingCount: number;
  duration?: number; // minutes
}

interface QuestionSelection {
  mcqQuestionIds: string[];
  codingQuestionIds: string[];
  reasoning: string;
  suggestedDuration: number;
  suggestedTestName: string;
  suggestedDescription: string;
  mcqPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
  codingPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
}

interface QuestionSummary {
  id: string;
  type: 'mcq' | 'coding';
  text: string;
  difficulty: string;
  topic: string | null;
  tags: string[];
  marks: number;
}

export async function generateTestFromJobProfile(
  request: TestGenerationRequest,
  adminId: string
): Promise<QuestionSelection> {
  void adminId; // adminId kept for signature compat — questions are pooled across all admins

  // Fetch ALL questions from the database (no per-admin filter so the pool is as large as possible)
  const [mcqQuestions, codingQuestions] = await Promise.all([
    prisma.mCQQuestion.findMany({
      select: {
        id: true,
        questionText: true,
        difficulty: true,
        topic: true,
        tags: true,
        marks: true
      }
    }),
    prisma.codingQuestion.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        difficulty: true,
        topic: true,
        tags: true,
        marks: true
      }
    })
  ]);

  // Format questions for matching / LLM prompt
  const mcqSummaries: QuestionSummary[] = mcqQuestions.map((q: typeof mcqQuestions[number]) => ({
    id: q.id,
    type: 'mcq' as const,
    text: q.questionText.substring(0, 200) + (q.questionText.length > 200 ? '...' : ''),
    difficulty: q.difficulty || 'medium',
    topic: q.topic,
    tags: q.tags ? JSON.parse(q.tags) : [],
    marks: q.marks
  }));

  const codingSummaries: QuestionSummary[] = codingQuestions.map((q: typeof codingQuestions[number]) => ({
    id: q.id,
    type: 'coding' as const,
    text: `${q.title}: ${q.description.substring(0, 150)}${q.description.length > 150 ? '...' : ''}`,
    difficulty: q.difficulty || 'medium',
    topic: q.topic,
    tags: q.tags ? JSON.parse(q.tags) : [],
    marks: q.marks
  }));

  // Use local fallback when no LLM key is configured
  if (!hasLLMKey()) {
    return selectQuestionsLocally(
      mcqSummaries, codingSummaries,
      request.skills, request.difficulty,
      request.mcqCount, request.codingCount,
      request.jobProfile.title, request.duration
    );
  }

  try {
    const systemPrompt = `You are an expert test designer and HR consultant. Select the most appropriate questions from the library to evaluate candidates for a specific job role. Always respond with a valid JSON object.`;

    const userPrompt = `Create a test for the following job profile:

**Job Title:** ${request.jobProfile.title}
**Experience Required:** ${request.jobProfile.experience}
${request.jobProfile.description ? `**Job Description:** ${request.jobProfile.description}` : ''}

**Required Skills:** ${request.skills.join(', ')}
**Difficulty Level:** ${request.difficulty}
**MCQ Questions Needed:** ${request.mcqCount}
**Coding Questions Needed:** ${request.codingCount}

## Available MCQ Questions (${mcqSummaries.length} total):
${mcqSummaries.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  Question: ${q.text}`).join('\n')}

## Available Coding Questions (${codingSummaries.length} total):
${codingSummaries.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  ${q.text}`).join('\n')}

Respond with JSON:
{
  "mcqQuestionIds": ["id1", ...],
  "codingQuestionIds": ["id1", ...],
  "reasoning": "...",
  "suggestedDuration": <minutes>,
  "suggestedTestName": "...",
  "suggestedDescription": "..."
}`;

    const response = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { temperature: 0.3 });

    const selection = parseJSONFromLLM(response.content) as QuestionSelection;

    // Validate IDs against known pool
    const validMcqIds  = new Set(mcqSummaries.map(q => q.id));
    const validCodingIds = new Set(codingSummaries.map(q => q.id));
    selection.mcqQuestionIds    = selection.mcqQuestionIds.filter(id => validMcqIds.has(id));
    selection.codingQuestionIds = selection.codingQuestionIds.filter(id => validCodingIds.has(id));

    if (!selection.suggestedDuration || selection.suggestedDuration < 10) {
      selection.suggestedDuration = request.duration ||
        selection.mcqQuestionIds.length * 2 + selection.codingQuestionIds.length * 20;
    }

    // Attach summaries so the frontend can preview without a second fetch
    const mcqIdSet    = new Set(selection.mcqQuestionIds);
    const codingIdSet = new Set(selection.codingQuestionIds);
    selection.mcqPreviews    = mcqSummaries.filter(q => mcqIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));
    selection.codingPreviews = codingSummaries.filter(q => codingIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));

    return selection;
  } catch {
    // LLM call failed — fall back to keyword matching
    return selectQuestionsLocally(
      mcqSummaries, codingSummaries,
      request.skills, request.difficulty,
      request.mcqCount, request.codingCount,
      request.jobProfile.title, request.duration
    );
  }
}

export async function createTestFromSelection(
  adminId: string,
  selection: QuestionSelection,
  testSettings: {
    name?: string;
    description?: string;
    duration?: number;
    startTime: Date;
    endTime?: Date;
    passingMarks?: number;
    negativeMarking?: number;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    maxViolations?: number;
    companyId?: string;
  }
): Promise<{ testId: string; testCode: string }> {
  // Calculate total marks — no adminId filter so we can tally marks for any selected question
  const [mcqQuestions, codingQuestions] = await Promise.all([
    prisma.mCQQuestion.findMany({
      where: { id: { in: selection.mcqQuestionIds } },
      select: { id: true, marks: true }
    }),
    prisma.codingQuestion.findMany({
      where: { id: { in: selection.codingQuestionIds } },
      select: { id: true, marks: true }
    })
  ]);

  const totalMarks =
    mcqQuestions.reduce((sum: number, q: { marks: number }) => sum + q.marks, 0) +
    codingQuestions.reduce((sum: number, q: { marks: number }) => sum + q.marks, 0);

  // Generate unique test code
  const testCode = generateTestCode();

  // Create test with questions in a transaction
  const test = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const newTest = await tx.test.create({
      data: {
        testCode,
        name: testSettings.name || selection.suggestedTestName,
        description: testSettings.description || selection.suggestedDescription,
        duration: testSettings.duration || selection.suggestedDuration,
        startTime: testSettings.startTime,
        endTime: testSettings.endTime,
        totalMarks,
        passingMarks: testSettings.passingMarks,
        negativeMarking: testSettings.negativeMarking || 0,
        shuffleQuestions: testSettings.shuffleQuestions ?? false,
        shuffleOptions: testSettings.shuffleOptions ?? false,
        maxViolations: testSettings.maxViolations ?? 3,
        customAIViolations: JSON.stringify(DEFAULT_CUSTOM_AI_VIOLATION_EVENTS),
        adminId,
        ...(testSettings.companyId ? { companyId: testSettings.companyId } : {})
      }
    });

    // Add MCQ questions
    let orderIndex = 0;
    for (const mcqId of selection.mcqQuestionIds) {
      await tx.testQuestion.create({
        data: {
          testId: newTest.id,
          questionType: 'mcq',
          mcqQuestionId: mcqId,
          orderIndex: orderIndex++
        }
      });
    }

    // Add coding questions
    for (const codingId of selection.codingQuestionIds) {
      await tx.testQuestion.create({
        data: {
          testId: newTest.id,
          questionType: 'coding',
          codingQuestionId: codingId,
          orderIndex: orderIndex++
        }
      });
    }

    return newTest;
  });

  return { testId: test.id, testCode: test.testCode };
}

function generateTestCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function analyzeJobRequirements(
  jobTitle: string,
  jobDescription?: string
): Promise<{
  suggestedSkills: string[];
  suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  suggestedMcqCount: number;
  suggestedCodingCount: number;
  experienceLevel: string;
}> {
  if (!hasLLMKey()) {
    return analyzeJobLocal(jobTitle, jobDescription);
  }

  try {
    const systemPrompt = `You are an expert HR consultant and technical recruiter. Analyze job requirements and suggest appropriate assessment parameters.`;

    const userPrompt = `Analyze this job posting and suggest assessment parameters:

**Job Title:** ${jobTitle}
${jobDescription ? `**Job Description:** ${jobDescription}` : ''}

Respond with a JSON object containing:
{
  "suggestedSkills": ["skill1", "skill2", ...],
  "suggestedDifficulty": "easy|medium|hard|mixed",
  "suggestedMcqCount": <number>,
  "suggestedCodingCount": <number>,
  "experienceLevel": "0-1 years|1-3 years|3-5 years|5+ years"
}`;

    const response = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { temperature: 0.5 });

    return parseJSONFromLLM(response.content) as {
      suggestedSkills: string[];
      suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
      suggestedMcqCount: number;
      suggestedCodingCount: number;
      experienceLevel: string;
    };
  } catch {
    return analyzeJobLocal(jobTitle, jobDescription);
  }
}

export async function suggestQuestionTags(
  questionText: string,
  questionType: 'mcq' | 'coding'
): Promise<{
  suggestedTags: string[];
  suggestedTopic: string;
  suggestedDifficulty: 'easy' | 'medium' | 'hard';
}> {
  const systemPrompt = `You are a technical expert who categorizes test questions. Analyze questions and suggest appropriate tags, topics, and difficulty levels.`;

  const userPrompt = `Analyze this ${questionType === 'mcq' ? 'multiple choice' : 'coding'} question and suggest categorization:

**Question:**
${questionText}

Respond with a JSON object:
{
  "suggestedTags": ["tag1", "tag2", ...], // 3-5 relevant skill/topic tags
  "suggestedTopic": "topic", // Main topic/category
  "suggestedDifficulty": "easy|medium|hard" // Difficulty level
}`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    temperature: 0.3
  });

  return parseJSONFromLLM(response.content) as {
    suggestedTags: string[];
    suggestedTopic: string;
    suggestedDifficulty: 'easy' | 'medium' | 'hard';
  };
}
