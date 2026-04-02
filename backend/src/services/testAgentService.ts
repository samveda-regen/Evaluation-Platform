import { callLLM, parseJSONFromLLM } from './llmService.js';
import prisma from '../utils/db.js';
import { Prisma } from '@prisma/client';

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
  // Fetch all questions from the database
  const [mcqQuestions, codingQuestions] = await Promise.all([
    prisma.mCQQuestion.findMany({
      where: { OR: [{ adminId }, { adminId: null }] },
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
      where: { OR: [{ adminId }, { adminId: null }] },
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

  // Format questions for the LLM
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

  // Build the prompt for the LLM
  const systemPrompt = `You are an expert test designer and HR consultant. Your task is to select the most appropriate questions from a library to create a test for evaluating candidates for a specific job role.

You must select questions that:
1. Match the required skills for the role
2. Are appropriate for the experience level
3. Cover a good range of topics relevant to the position
4. Have the right difficulty distribution based on the specified difficulty level

Always respond with a valid JSON object containing your selections and reasoning.`;

  const userPrompt = `Create a test for the following job profile:

**Job Title:** ${request.jobProfile.title}
**Experience Required:** ${request.jobProfile.experience}
${request.jobProfile.description ? `**Job Description:** ${request.jobProfile.description}` : ''}

**Required Skills:** ${request.skills.join(', ')}
**Difficulty Level:** ${request.difficulty}
**Number of MCQ Questions Needed:** ${request.mcqCount}
**Number of Coding Questions Needed:** ${request.codingCount}

## Available MCQ Questions (${mcqSummaries.length} total):
${mcqSummaries.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}
  Question: ${q.text}`).join('\n')}

## Available Coding Questions (${codingSummaries.length} total):
${codingSummaries.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}
  ${q.text}`).join('\n')}

Please select the most appropriate questions for this test. If there aren't enough questions matching the exact criteria, select the closest matches available.

Respond with a JSON object in this exact format:
{
  "mcqQuestionIds": ["id1", "id2", ...],
  "codingQuestionIds": ["id1", "id2", ...],
  "reasoning": "Explanation of why these questions were selected",
  "suggestedDuration": <suggested_duration_in_minutes>,
  "suggestedTestName": "Suggested test name",
  "suggestedDescription": "Suggested test description"
}`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    temperature: 0.3 // Lower temperature for more consistent selection
  });

  const selection = parseJSONFromLLM(response.content) as QuestionSelection;

  // Validate that selected IDs exist
  const validMcqIds = mcqSummaries.map(q => q.id);
  const validCodingIds = codingSummaries.map(q => q.id);

  selection.mcqQuestionIds = selection.mcqQuestionIds.filter(id => validMcqIds.includes(id));
  selection.codingQuestionIds = selection.codingQuestionIds.filter(id => validCodingIds.includes(id));

  // Apply fallback duration if not suggested
  if (!selection.suggestedDuration || selection.suggestedDuration < 10) {
    selection.suggestedDuration = request.duration ||
      (selection.mcqQuestionIds.length * 2) + (selection.codingQuestionIds.length * 20);
  }

  return selection;
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
  }
): Promise<{ testId: string; testCode: string }> {
  // Calculate total marks
  const [mcqQuestions, codingQuestions] = await Promise.all([
    prisma.mCQQuestion.findMany({
      where: { id: { in: selection.mcqQuestionIds }, OR: [{ adminId }, { adminId: null }] },
      select: { id: true, marks: true }
    }),
    prisma.codingQuestion.findMany({
      where: { id: { in: selection.codingQuestionIds }, OR: [{ adminId }, { adminId: null }] },
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
        adminId
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
  const systemPrompt = `You are an expert HR consultant and technical recruiter. Analyze job requirements and suggest appropriate assessment parameters.`;

  const userPrompt = `Analyze this job posting and suggest assessment parameters:

**Job Title:** ${jobTitle}
${jobDescription ? `**Job Description:** ${jobDescription}` : ''}

Respond with a JSON object containing:
{
  "suggestedSkills": ["skill1", "skill2", ...], // Technical skills to assess (5-10 skills)
  "suggestedDifficulty": "easy|medium|hard|mixed", // Appropriate difficulty
  "suggestedMcqCount": <number>, // Suggested number of MCQ questions (5-20)
  "suggestedCodingCount": <number>, // Suggested number of coding questions (1-5)
  "experienceLevel": "0-1 years|1-3 years|3-5 years|5+ years" // Inferred experience level
}`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    temperature: 0.5
  });

  return parseJSONFromLLM(response.content) as {
    suggestedSkills: string[];
    suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
    suggestedMcqCount: number;
    suggestedCodingCount: number;
    experienceLevel: string;
  };
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
