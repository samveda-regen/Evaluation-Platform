import { callLLM, parseJSONFromLLM } from './llmService.js';
import prisma from '../utils/db.js';
import { Prisma } from '@prisma/client';
import { DEFAULT_CUSTOM_AI_VIOLATION_EVENTS } from '../utils/proctoringConfig.js';

const MAX_TEST_VIOLATIONS = 150;

/* ── local helpers (no LLM required) ─────────────────────────────────── */

function hasLLMKey(): boolean {
  return !!(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export type RoleClassification = 'technical' | 'semi-technical' | 'non-technical';

// Fully technical job-title categories that don't necessarily name a specific
// stack (e.g. "Full Stack Developer") — matched against the title only, so a
// description mentioning an unrelated tool doesn't misfire this.
const ROLE_TITLE_PATTERNS: [RegExp, string[]][] = [
  // Single-language developer titles: seed the named language plus its common companion stack,
  // not just the literal word in the title.
  [/python (developer|engineer)/i, ['Python', 'Django/Flask', 'SQL', 'REST APIs', 'Git', 'Data Structures']],
  [/java (developer|engineer)/i, ['Java', 'Spring Boot', 'SQL', 'REST APIs', 'Git', 'Data Structures']],
  [/(\.net|c#) developer/i, ['C#', 'ASP.NET', 'SQL', 'REST APIs', 'Git']],
  [/php developer/i, ['PHP', 'Laravel', 'SQL', 'REST APIs', 'Git']],
  [/ruby (developer|on rails)/i, ['Ruby', 'Rails', 'SQL', 'REST APIs', 'Git']],
  [/go(lang)? developer/i, ['Go', 'REST APIs', 'SQL', 'Git', 'Microservices']],
  [/full[\s-]?stack/i, ['JavaScript', 'React', 'Node.js', 'SQL', 'REST APIs', 'Git']],
  [/front[\s-]?end/i, ['JavaScript', 'React', 'CSS/HTML', 'REST APIs', 'Git']],
  [/back[\s-]?end/i, ['Node.js', 'SQL', 'REST APIs', 'System Design', 'Git']],
  [/devops|site reliability|\bsre\b/i, ['Docker', 'Kubernetes', 'CI/CD', 'Cloud/AWS', 'Linux']],
  [/data scientist/i, ['Python', 'Machine Learning', 'SQL', 'Data Structures']],
  [/data engineer/i, ['Python', 'SQL', 'ETL', 'Apache Spark']],
  [/machine learning|\bml engineer/i, ['Python', 'Machine Learning', 'TensorFlow', 'Data Structures']],
  [/mobile (developer|engineer)|android developer|ios developer/i, ['React Native', 'REST APIs', 'Git']],
  [/\bqa\b|quality assurance|test engineer|sdet/i, ['Testing', 'REST APIs', 'Git']],
  [/software (engineer|developer)/i, ['Data Structures', 'Algorithms', 'System Design', 'Git']],
  [/web developer/i, ['JavaScript', 'CSS/HTML', 'REST APIs']],
  [/database administrator|\bdba\b/i, ['SQL', 'System Design']],
  [/security engineer|cybersecurity/i, ['Cybersecurity', 'Networking']],
  [/systems? administrator|network engineer/i, ['Networking', 'Linux']],
];

// Roles that touch technical tools/concepts but aren't primarily an engineering
// job — still worth assessing on the (smaller) overlap, not blocked outright.
const SEMI_TECHNICAL_ROLE_PATTERNS: [RegExp, string[]][] = [
  [/technical writer/i, ['Documentation', 'Git', 'REST APIs']],
  [/business analyst/i, ['SQL', 'System Design']],
  [/product manager/i, ['Agile', 'SQL', 'System Design']],
  [/project manager/i, ['Agile', 'System Design']],
  [/scrum master/i, ['Agile']],
  [/(it|help.?desk|technical) support/i, ['Networking', 'Linux']],
  [/network technician/i, ['Networking']],
  [/ux\/?ui designer|ui\/?ux designer/i, ['CSS/HTML', 'Problem Solving']],
  [/sales engineer/i, ['REST APIs', 'System Design']],
  [/warehouse (operator|associate|coordinator)|inventory (coordinator|associate|specialist)|logistics coordinator/i, ['SQL', 'Problem Solving']],
];

function analyzeJobLocal(jobTitle: string, jobDescription?: string, experienceHint?: string): {
  suggestedSkills: string[];
  suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  suggestedMcqCount: number;
  suggestedCodingCount: number;
  suggestedBehavioralCount: number;
  experienceLevel: string;
  roleClassification: RoleClassification;
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
  let roleClassification: RoleClassification = 'non-technical';

  // Seed from a recognized fully-technical role-title category first (covers
  // generic titles like "Full Stack Developer" that don't name a specific stack).
  for (const [re, roleSkills] of ROLE_TITLE_PATTERNS) {
    if (re.test(jobTitle)) {
      for (const s of roleSkills) if (!skills.includes(s)) skills.push(s);
      roleClassification = 'technical';
      break;
    }
  }

  // Otherwise check semi-technical role categories (smaller, still-relevant skill set).
  if (roleClassification === 'non-technical') {
    for (const [re, roleSkills] of SEMI_TECHNICAL_ROLE_PATTERNS) {
      if (re.test(jobTitle)) {
        for (const s of roleSkills) if (!skills.includes(s)) skills.push(s);
        roleClassification = 'semi-technical';
        break;
      }
    }
  }

  // Layer on specific technology mentions from the title/description.
  for (const [re, skill] of patterns) {
    if (re.test(text) && !skills.includes(skill)) skills.push(skill);
  }
  if ((skills.includes('Node.js') || skills.includes('React')) && !skills.includes('JavaScript')) {
    skills.unshift('JavaScript');
  }
  // If a tech keyword was found in the text but the title itself didn't match
  // a known role category, the role still has real technical overlap.
  if (roleClassification === 'non-technical' && skills.length > 0) {
    roleClassification = 'technical';
  }
  // No match at all: don't invent generic CS skills for an unrecognized/non-technical title —
  // leave it empty so the caller knows nothing relevant was detected.

  // Prefer the experience level explicitly chosen by the admin in the form
  // over guessing from free text.
  let experienceLevel = '2-5 years';
  if (experienceHint && /0-2|entry|junior/i.test(experienceHint)) experienceLevel = '0-2 years';
  else if (experienceHint && /5\+|senior/i.test(experienceHint)) experienceLevel = '5+ years';
  else if (experienceHint && /2-5|mid/i.test(experienceHint)) experienceLevel = '2-5 years';
  else if (/junior|entry|graduate|intern/i.test(text)) experienceLevel = '0-2 years';
  else if (/senior|lead|principal|staff/i.test(text)) experienceLevel = '5+ years';

  const suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed' =
    experienceLevel === '0-2 years' ? 'easy' :
    experienceLevel === '5+ years'  ? 'hard'  : 'mixed';

  // Layer in a couple of soft-skill / behavioral competency tags (using the same
  // vocabulary as the behavioral question bank: communication, teamwork, leadership)
  // so these suggestions also surface relevant behavioral questions, not just MCQ/coding.
  if (roleClassification !== 'non-technical') {
    if (!skills.some(s => s.toLowerCase() === 'communication')) skills.push('Communication');
    if (!skills.some(s => s.toLowerCase() === 'teamwork')) skills.push('Teamwork');
    if (experienceLevel === '5+ years' && !skills.some(s => s.toLowerCase() === 'leadership')) skills.push('Leadership');
  }

  return {
    suggestedSkills: skills.slice(0, 10),
    suggestedDifficulty,
    suggestedMcqCount: 10,
    suggestedCodingCount: 3,
    suggestedBehavioralCount: roleClassification === 'non-technical' ? 0 : 2,
    experienceLevel,
    roleClassification,
  };
}

// Counts how many distinct skill keywords actually appear in a question's topic/tags/text. This
// is the single source of truth for "is this question relevant to the requested skills" — used
// both by the local keyword-matching selector and as a hard filter on whatever the LLM picks, so
// a question is never included in a generated test unless it genuinely matches a requested skill.
function skillMatchCount(q: QuestionSummary, skills: string[]): number {
  const hay = `${q.topic || ''} ${q.tags.join(' ')} ${q.text}`.toLowerCase();
  let matches = 0;
  for (const skill of skills) {
    const kw = skill.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    for (const word of kw.split(/\s+/)) {
      if (word.length > 2 && hay.includes(word)) matches++;
    }
  }
  return matches;
}

function selectQuestionsLocally(
  mcqSummaries: QuestionSummary[],
  codingSummaries: QuestionSummary[],
  behavioralSummaries: QuestionSummary[],
  writtenSummaries: QuestionSummary[],
  readingSummaries: QuestionSummary[],
  speakingSummaries: QuestionSummary[],
  skills: string[],
  difficulty: string,
  mcqCount: number,
  codingCount: number,
  behavioralCount: number,
  writtenCount: number,
  readingCount: number,
  speakingCount: number,
  jobTitle: string,
  duration?: number
): QuestionSelection {
  // Only ever consider questions with at least one real skill-keyword match — difficulty is used
  // purely to break ties among those matches, never to pull in an otherwise-irrelevant question.
  // If fewer matching questions exist in the library than requested, the picked list is simply
  // shorter than mcqCount/codingCount/behavioralCount — it is never padded with weak matches.
  const rank = (pool: QuestionSummary[], count: number): QuestionSummary[] =>
    pool
      .map(q => ({ q, matches: skillMatchCount(q, skills) }))
      .filter(({ matches }) => matches > 0)
      .sort((a, b) => {
        if (b.matches !== a.matches) return b.matches - a.matches;
        const bonus = (x: QuestionSummary) => (difficulty === 'mixed' || x.difficulty === difficulty) ? 1 : 0;
        return bonus(b.q) - bonus(a.q);
      })
      .slice(0, count)
      .map(({ q }) => q);

  const pickedMcq = rank(mcqSummaries, mcqCount);
  const pickedCoding = rank(codingSummaries, codingCount);
  const pickedBehavioral = rank(behavioralSummaries, behavioralCount);
  const pickedWritten = rank(writtenSummaries, writtenCount);
  const pickedReading = rank(readingSummaries, readingCount);
  const pickedSpeaking = rank(speakingSummaries, speakingCount);

  const shortfalls: string[] = [];
  if (pickedMcq.length < mcqCount) shortfalls.push(`${pickedMcq.length}/${mcqCount} MCQ`);
  if (pickedCoding.length < codingCount) shortfalls.push(`${pickedCoding.length}/${codingCount} coding`);
  if (pickedBehavioral.length < behavioralCount) shortfalls.push(`${pickedBehavioral.length}/${behavioralCount} behavioral`);
  if (pickedWritten.length < writtenCount) shortfalls.push(`${pickedWritten.length}/${writtenCount} written`);
  if (pickedReading.length < readingCount) shortfalls.push(`${pickedReading.length}/${readingCount} reading`);
  if (pickedSpeaking.length < speakingCount) shortfalls.push(`${pickedSpeaking.length}/${speakingCount} speaking`);

  return {
    mcqQuestionIds: pickedMcq.map(q => q.id),
    codingQuestionIds: pickedCoding.map(q => q.id),
    behavioralQuestionIds: pickedBehavioral.map(q => q.id),
    writtenQuestionIds: pickedWritten.map(q => q.id),
    readingQuestionIds: pickedReading.map(q => q.id),
    speakingQuestionIds: pickedSpeaking.map(q => q.id),
    mcqPreviews: pickedMcq.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    codingPreviews: pickedCoding.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    behavioralPreviews: pickedBehavioral.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    writtenPreviews: pickedWritten.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    readingPreviews: pickedReading.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    speakingPreviews: pickedSpeaking.map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic })),
    reasoning: `Selected ${pickedMcq.length} MCQ, ${pickedCoding.length} coding, ${pickedBehavioral.length} behavioral, ${pickedWritten.length} written, ${pickedReading.length} reading, and ${pickedSpeaking.length} speaking questions that genuinely match: ${skills.join(', ')}.`
      + (shortfalls.length ? ` No filler questions were added — the library only had ${shortfalls.join(', ')} matching these skills.` : ''),
    suggestedDuration: duration || pickedMcq.length * 2 + pickedCoding.length * 20 + pickedBehavioral.length * 5 + pickedWritten.length * 5 + pickedReading.length * 3 + pickedSpeaking.length * 5,
    suggestedTestName: `${jobTitle} Assessment`,
    suggestedDescription: `Assessment for ${jobTitle} covering ${skills.slice(0, 3).join(', ')} and related topics.`,
  };
}

function normalizeMaxViolations(value?: number): number {
  if (value === undefined || value === null) return 3;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(MAX_TEST_VIOLATIONS, Math.max(1, parsed));
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
  behavioralCount: number;
  writtenCount?: number;
  readingCount?: number;
  speakingCount?: number;
  duration?: number; // minutes
}

interface QuestionSelection {
  mcqQuestionIds: string[];
  codingQuestionIds: string[];
  behavioralQuestionIds: string[];
  writtenQuestionIds?: string[];
  readingQuestionIds?: string[];
  speakingQuestionIds?: string[];
  reasoning: string;
  suggestedDuration: number;
  suggestedTestName: string;
  suggestedDescription: string;
  mcqPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
  codingPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
  behavioralPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
  writtenPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
  readingPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
  speakingPreviews?: Array<{ id: string; text: string; difficulty: string; topic: string | null }>;
}

interface QuestionSummary {
  id: string;
  type: 'mcq' | 'coding' | 'behavioral' | 'written' | 'reading' | 'speaking';
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
  const [mcqQuestions, codingQuestions, behavioralQuestions, writtenQuestions, readingQuestions, speakingQuestions] = await Promise.all([
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
    }),
    prisma.behavioralQuestion.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        difficulty: true,
        topic: true,
        tags: true,
        marks: true
      }
    }),
    prisma.communicationQuestion.findMany({
      where: { subType: 'WRITTEN' },
      select: { id: true, title: true, description: true, difficulty: true, topic: true, tags: true, marks: true }
    }),
    prisma.communicationQuestion.findMany({
      where: { subType: 'READING' },
      select: { id: true, title: true, description: true, difficulty: true, topic: true, tags: true, marks: true, passage: { select: { title: true } } }
    }),
    prisma.communicationQuestion.findMany({
      where: { subType: 'SPEAKING' },
      select: { id: true, title: true, description: true, difficulty: true, topic: true, tags: true, marks: true }
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

  const behavioralSummaries: QuestionSummary[] = behavioralQuestions.map((q: typeof behavioralQuestions[number]) => ({
    id: q.id,
    type: 'behavioral' as const,
    text: `${q.title}: ${q.description.substring(0, 150)}${q.description.length > 150 ? '...' : ''}`,
    difficulty: q.difficulty || 'medium',
    topic: q.topic,
    tags: q.tags ? JSON.parse(q.tags) : [],
    marks: q.marks
  }));

  const writtenSummaries: QuestionSummary[] = writtenQuestions.map((q: typeof writtenQuestions[number]) => ({
    id: q.id,
    type: 'written' as const,
    text: `${q.title}${q.description ? `: ${q.description.substring(0, 150)}${q.description.length > 150 ? '...' : ''}` : ''}`,
    difficulty: q.difficulty || 'medium',
    topic: q.topic,
    tags: q.tags ? JSON.parse(q.tags) : [],
    marks: q.marks
  }));

  const readingSummaries: QuestionSummary[] = readingQuestions.map((q: typeof readingQuestions[number]) => ({
    id: q.id,
    type: 'reading' as const,
    text: `${q.passage?.title ? `[${q.passage.title}] ` : ''}${q.title}`,
    difficulty: q.difficulty || 'medium',
    topic: q.topic,
    tags: q.tags ? JSON.parse(q.tags) : [],
    marks: q.marks
  }));

  const speakingSummaries: QuestionSummary[] = speakingQuestions.map((q: typeof speakingQuestions[number]) => ({
    id: q.id,
    type: 'speaking' as const,
    text: `${q.title}${q.description ? `: ${q.description.substring(0, 150)}${q.description.length > 150 ? '...' : ''}` : ''}`,
    difficulty: q.difficulty || 'medium',
    topic: q.topic,
    tags: q.tags ? JSON.parse(q.tags) : [],
    marks: q.marks
  }));

  // Narrow the candidate pool down to genuinely skill-relevant questions BEFORE building the LLM
  // prompt (and before local keyword ranking) — keeps the prompt small and the round trip fast
  // regardless of how large the question library grows, since it no longer scales 1:1 with total
  // library size. This also guarantees the model can only ever pick from candidates that already
  // pass the same skill-relevance bar enforced as a hard filter afterward.
  const relevantMcq = mcqSummaries.filter(q => skillMatchCount(q, request.skills) > 0);
  const relevantCoding = codingSummaries.filter(q => skillMatchCount(q, request.skills) > 0);
  const relevantBehavioral = behavioralSummaries.filter(q => skillMatchCount(q, request.skills) > 0);
  const relevantWritten = writtenSummaries.filter(q => skillMatchCount(q, request.skills) > 0);
  const relevantReading = readingSummaries.filter(q => skillMatchCount(q, request.skills) > 0);
  const relevantSpeaking = speakingSummaries.filter(q => skillMatchCount(q, request.skills) > 0);

  const writtenCount = request.writtenCount || 0;
  const readingCount = request.readingCount || 0;
  const speakingCount = request.speakingCount || 0;

  // Use local fallback when no LLM key is configured
  if (!hasLLMKey()) {
    return selectQuestionsLocally(
      relevantMcq, relevantCoding, relevantBehavioral, relevantWritten, relevantReading, relevantSpeaking,
      request.skills, request.difficulty,
      request.mcqCount, request.codingCount, request.behavioralCount, writtenCount, readingCount, speakingCount,
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
**Behavioral Questions Needed:** ${request.behavioralCount}
**Written (Communication) Questions Needed:** ${writtenCount}
**Reading (Communication) Questions Needed:** ${readingCount}
**Speaking (Communication) Questions Needed:** ${speakingCount}

## Available MCQ Questions (${relevantMcq.length} that match the required skills, out of ${mcqSummaries.length} in the library):
${relevantMcq.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  Question: ${q.text}`).join('\n') || '(none)'}

## Available Coding Questions (${relevantCoding.length} that match the required skills, out of ${codingSummaries.length} in the library):
${relevantCoding.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  ${q.text}`).join('\n') || '(none)'}

## Available Behavioral Questions (${relevantBehavioral.length} that match the required skills, out of ${behavioralSummaries.length} in the library):
${relevantBehavioral.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  ${q.text}`).join('\n') || '(none)'}

## Available Written Questions (${relevantWritten.length} that match the required skills, out of ${writtenSummaries.length} in the library):
${relevantWritten.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  ${q.text}`).join('\n') || '(none)'}

## Available Reading Questions (${relevantReading.length} that match the required skills, out of ${readingSummaries.length} in the library):
${relevantReading.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  ${q.text}`).join('\n') || '(none)'}

## Available Speaking Questions (${relevantSpeaking.length} that match the required skills, out of ${speakingSummaries.length} in the library):
${relevantSpeaking.map(q => `- ID: ${q.id} | Difficulty: ${q.difficulty} | Topic: ${q.topic || 'General'} | Tags: [${q.tags.join(', ')}] | Marks: ${q.marks}\n  ${q.text}`).join('\n') || '(none)'}

Pick behavioral questions whose tags/topic best match the role's soft-skill needs (e.g. seniority-appropriate leadership/ownership for senior roles, collaboration/learning for junior roles) — not just generic picks.

Only select a question if it genuinely tests one of the **Required Skills** listed above (via its topic, tags, or content) — never select a question just to reach the requested count. If the library doesn't contain enough genuinely relevant questions for a category, return fewer than the requested count for that category rather than padding it with unrelated questions.

Respond with JSON:
{
  "mcqQuestionIds": ["id1", ...],
  "codingQuestionIds": ["id1", ...],
  "behavioralQuestionIds": ["id1", ...],
  "writtenQuestionIds": ["id1", ...],
  "readingQuestionIds": ["id1", ...],
  "speakingQuestionIds": ["id1", ...],
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

    // Validate IDs against the pool actually offered to the model (the pre-filtered,
    // skill-relevant subset) — this alone is enough to guarantee the model couldn't have picked
    // an irrelevant question, since irrelevant ones were never in the prompt to begin with.
    const mcqById = new Map(relevantMcq.map(q => [q.id, q]));
    const codingById = new Map(relevantCoding.map(q => [q.id, q]));
    const behavioralById = new Map(relevantBehavioral.map(q => [q.id, q]));
    const writtenById = new Map(relevantWritten.map(q => [q.id, q]));
    const readingById = new Map(relevantReading.map(q => [q.id, q]));
    const speakingById = new Map(relevantSpeaking.map(q => [q.id, q]));
    selection.mcqQuestionIds    = selection.mcqQuestionIds.filter(id => mcqById.has(id));
    selection.codingQuestionIds = selection.codingQuestionIds.filter(id => codingById.has(id));
    selection.behavioralQuestionIds = (selection.behavioralQuestionIds || []).filter(id => behavioralById.has(id));
    selection.writtenQuestionIds = (selection.writtenQuestionIds || []).filter(id => writtenById.has(id));
    selection.readingQuestionIds = (selection.readingQuestionIds || []).filter(id => readingById.has(id));
    selection.speakingQuestionIds = (selection.speakingQuestionIds || []).filter(id => speakingById.has(id));

    if (!selection.suggestedDuration || selection.suggestedDuration < 10) {
      selection.suggestedDuration = request.duration ||
        selection.mcqQuestionIds.length * 2 + selection.codingQuestionIds.length * 20 + selection.behavioralQuestionIds.length * 5
        + selection.writtenQuestionIds.length * 5 + selection.readingQuestionIds.length * 3 + selection.speakingQuestionIds.length * 5;
    }

    // Attach summaries so the frontend can preview without a second fetch
    const mcqIdSet    = new Set(selection.mcqQuestionIds);
    const codingIdSet = new Set(selection.codingQuestionIds);
    const behavioralIdSet = new Set(selection.behavioralQuestionIds);
    const writtenIdSet = new Set(selection.writtenQuestionIds);
    const readingIdSet = new Set(selection.readingQuestionIds);
    const speakingIdSet = new Set(selection.speakingQuestionIds);
    selection.mcqPreviews    = relevantMcq.filter(q => mcqIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));
    selection.codingPreviews = relevantCoding.filter(q => codingIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));
    selection.behavioralPreviews = relevantBehavioral.filter(q => behavioralIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));
    selection.writtenPreviews = relevantWritten.filter(q => writtenIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));
    selection.readingPreviews = relevantReading.filter(q => readingIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));
    selection.speakingPreviews = relevantSpeaking.filter(q => speakingIdSet.has(q.id)).map(q => ({ id: q.id, text: q.text, difficulty: q.difficulty, topic: q.topic }));

    return selection;
  } catch {
    // LLM call failed — fall back to keyword matching
    return selectQuestionsLocally(
      relevantMcq, relevantCoding, relevantBehavioral, relevantWritten, relevantReading, relevantSpeaking,
      request.skills, request.difficulty,
      request.mcqCount, request.codingCount, request.behavioralCount, writtenCount, readingCount, speakingCount,
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
    passingScorePercent?: number;
    negativeMarking?: number;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    maxViolations?: number;
    companyId?: string;
  }
): Promise<{ testId: string; testCode: string }> {
  // Calculate total marks — no adminId filter so we can tally marks for any selected question
  const communicationIds = [
    ...(selection.writtenQuestionIds || []),
    ...(selection.readingQuestionIds || []),
    ...(selection.speakingQuestionIds || [])
  ];
  const [mcqQuestions, codingQuestions, behavioralQuestions, communicationQuestions] = await Promise.all([
    prisma.mCQQuestion.findMany({
      where: { id: { in: selection.mcqQuestionIds } },
      select: { id: true, marks: true }
    }),
    prisma.codingQuestion.findMany({
      where: { id: { in: selection.codingQuestionIds } },
      select: { id: true, marks: true }
    }),
    prisma.behavioralQuestion.findMany({
      where: { id: { in: selection.behavioralQuestionIds || [] } },
      select: { id: true, marks: true }
    }),
    prisma.communicationQuestion.findMany({
      where: { id: { in: communicationIds } },
      select: { id: true, marks: true }
    })
  ]);

  const totalMarks =
    mcqQuestions.reduce((sum: number, q: { marks: number }) => sum + q.marks, 0) +
    codingQuestions.reduce((sum: number, q: { marks: number }) => sum + q.marks, 0) +
    behavioralQuestions.reduce((sum: number, q: { marks: number }) => sum + q.marks, 0) +
    communicationQuestions.reduce((sum: number, q: { marks: number }) => sum + q.marks, 0);
  const passingMarks =
    testSettings.passingScorePercent !== undefined
      ? Math.round((testSettings.passingScorePercent / 100) * totalMarks)
      : testSettings.passingMarks;

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
        passingMarks,
        negativeMarking: testSettings.negativeMarking || 0,
        shuffleQuestions: testSettings.shuffleQuestions ?? false,
        shuffleOptions: testSettings.shuffleOptions ?? false,
        maxViolations: normalizeMaxViolations(testSettings.maxViolations),
        customAIViolations: JSON.stringify(DEFAULT_CUSTOM_AI_VIOLATION_EVENTS),
        adminId,
        isAiGenerated: true,
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

    // Add behavioral questions
    for (const behavioralId of selection.behavioralQuestionIds || []) {
      await tx.testQuestion.create({
        data: {
          testId: newTest.id,
          questionType: 'behavioral',
          behavioralQuestionId: behavioralId,
          orderIndex: orderIndex++
        }
      });
    }

    // Add communication questions (written/reading/speaking all share questionType 'communication' —
    // CommunicationQuestion.subType is what actually distinguishes them, already set at creation time)
    for (const communicationId of communicationIds) {
      await tx.testQuestion.create({
        data: {
          testId: newTest.id,
          questionType: 'communication',
          communicationQuestionId: communicationId,
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

// Distinct skill/topic tags already used in the question library, so the LLM can
// ground its suggestions in names that will actually match real questions.
export async function getLibrarySkillTags(): Promise<string[]> {
  try {
    const [mcq, coding, behavioral, communication] = await Promise.all([
      prisma.mCQQuestion.findMany({ select: { tags: true, topic: true } }),
      prisma.codingQuestion.findMany({ select: { tags: true, topic: true } }),
      prisma.behavioralQuestion.findMany({ select: { tags: true, topic: true } }),
      prisma.communicationQuestion.findMany({ select: { tags: true, topic: true } })
    ]);
    const set = new Set<string>();
    for (const q of [...mcq, ...coding, ...behavioral, ...communication]) {
      if (q.topic?.trim()) set.add(q.topic.trim());
      if (q.tags) {
        try {
          const parsed = JSON.parse(q.tags);
          if (Array.isArray(parsed)) {
            for (const t of parsed) if (typeof t === 'string' && t.trim()) set.add(t.trim());
          }
        } catch {
          // malformed tags JSON — skip
        }
      }
    }
    return Array.from(set).sort().slice(0, 150);
  } catch {
    return [];
  }
}

export async function analyzeJobRequirements(
  jobTitle: string,
  jobDescription?: string,
  experience?: string
): Promise<{
  suggestedSkills: string[];
  suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  suggestedMcqCount: number;
  suggestedCodingCount: number;
  suggestedBehavioralCount: number;
  experienceLevel: string;
  roleClassification?: RoleClassification;
}> {
  if (!hasLLMKey()) {
    return analyzeJobLocal(jobTitle, jobDescription, experience);
  }

  try {
    const libraryTags = await getLibrarySkillTags();

    const systemPrompt = `You are an expert technical recruiter who has hired for thousands of roles and knows the typical technology overlap behind common job titles, even when the title alone doesn't spell it out (e.g. "Full Stack Developer" commonly implies JavaScript/TypeScript, a frontend framework like React, a backend like Node.js, SQL/NoSQL, REST APIs, Git — "DevOps Engineer" implies Docker, Kubernetes, CI/CD, Cloud, Linux).

This platform's question library only covers software/technical/IT topics. Your job is, in order:
1. Classify the job title into exactly one of three buckets (roleClassification):
   - "technical": a software/engineering/IT role, even if the title alone doesn't name a stack — use your knowledge of that role to infer the typical stack.
   - "semi-technical": not an engineering role, but genuinely uses technical/digital tools or systems day-to-day — either office-software roles (Technical Writer, Business/Systems Analyst, Product/Project Manager on a software team, IT/Help Desk Support, UX/UI Designer, Sales Engineer, Scrum Master) or operational roles built around a software system (e.g. Warehouse Operator/Inventory Coordinator using a Warehouse Management System and barcode/RFID scanning, Logistics Coordinator using routing/tracking software, Retail Associate using a POS system).
   - "non-technical": no genuine technical/digital-systems overlap at all — purely manual/physical/interpersonal work (e.g. tailor, chef, driver, cleaner, receptionist, accountant, electrician).
2. If "technical", suggest a full, well-rounded set of relevant assessment skills (typically 5-8). Do NOT just restate the literal word(s) already in the job title — think like a hiring manager building an interview panel: include the core named technology/language PLUS its realistic companion stack (common frameworks, data layer, APIs, tooling) and relevant CS fundamentals. Example: "Python Developer" should NOT just yield ["Python"] — it should yield something like Python, Django/Flask, SQL, REST APIs, Git, Data Structures.
3. If "semi-technical", suggest a smaller set of skills limited to the real technical overlap (e.g. SQL, Documentation, Networking, Agile) — don't invent core programming skills like Algorithms or Data Structures unless the role genuinely needs them.
4. If "non-technical", return an empty suggestedSkills array — never invent unrelated technical skills just to fill the list.
5. Always factor in the stated experience level and job description (when given), not just the title — adjust depth/seniority of the suggested skills and difficulty accordingly (e.g. junior: focus on fundamentals; senior: add System Design, Architecture, Performance Optimization, mentoring-adjacent technical depth).
6. If a list of skills/topics already in this platform's question library is provided, prefer reusing those exact names where they genuinely apply (improves real question matching) — but you are not limited to that list; still suggest additional relevant skills that aren't in it yet if the role calls for them.
7. This platform also has a bank of behavioral/soft-skill questions (tagged with things like communication, teamwork, ownership, leadership, conflict-resolution, adaptability, time-management, mentoring). For "technical" and "semi-technical" roles, append 2-3 relevant soft-skill competencies to suggestedSkills using that same vocabulary, calibrated to seniority (e.g. junior: collaboration/learning/adaptability; senior: leadership/ownership/mentoring). Also set suggestedBehavioralCount (typically 2 for technical/semi-technical roles, 0 for non-technical).

Examples:
- "Full Stack Developer" -> roleClassification: "technical", skills like JavaScript, React, Node.js, SQL, REST APIs, Git
- "Python Developer" (2-5 years) -> roleClassification: "technical", skills like Python, Django/Flask, SQL, REST APIs, Git, Data Structures, Object-Oriented Programming
- "DevOps Engineer" -> roleClassification: "technical", skills like Docker, Kubernetes, CI/CD, Cloud Computing, Linux
- "Technical Writer" -> roleClassification: "semi-technical", skills like Documentation, Git, REST APIs
- "IT Support Specialist" -> roleClassification: "semi-technical", skills like Networking, Linux
- "Product Manager" -> roleClassification: "semi-technical", skills like Agile, SQL, System Design
- "Warehouse Operator" -> roleClassification: "semi-technical", skills like SQL, Problem Solving (uses a Warehouse Management System and barcode/RFID scanning)
- "Tailor" -> roleClassification: "non-technical", suggestedSkills: []
- "Sales Executive" -> roleClassification: "non-technical", suggestedSkills: []

Always respond with a valid JSON object only.`;

    const userPrompt = `Analyze this job posting and suggest assessment parameters. All fields below are relevant context — use the experience level and description (when present) to shape your answer, not just the title.

**Job Title:** ${jobTitle}
**Candidate Experience Level:** ${experience || 'Not specified — infer a reasonable default from the title'}
${jobDescription ? `**Job Description:** ${jobDescription}` : '**Job Description:** Not provided'}
${libraryTags.length ? `\n**Skills/topics already present in our question library (prefer these exact names when relevant, but you are not limited to them):**\n${libraryTags.join(', ')}` : ''}

Respond with a JSON object containing (in this order):
{
  "roleClassification": "technical" | "semi-technical" | "non-technical",
  "suggestedSkills": ["skill1", "skill2", ...],
  "suggestedDifficulty": "easy|medium|hard|mixed",
  "suggestedMcqCount": <number>,
  "suggestedCodingCount": <number>,
  "suggestedBehavioralCount": <number>,
  "experienceLevel": "0-1 years|1-3 years|3-5 years|5+ years"
}`;

    const response = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { temperature: 0.3 });

    const result = parseJSONFromLLM(response.content) as {
      suggestedSkills: string[];
      suggestedDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
      suggestedMcqCount: number;
      suggestedCodingCount: number;
      suggestedBehavioralCount: number;
      experienceLevel: string;
      roleClassification?: RoleClassification;
    };

    if (typeof result.suggestedBehavioralCount !== 'number') {
      result.suggestedBehavioralCount = result.roleClassification === 'non-technical' ? 0 : 2;
    }

    // Belt-and-suspenders: if the LLM flagged the role as technical/semi-technical
    // but returned too few skills (e.g. just the literal word from the title), merge
    // in the local role/stack matcher's suggestions to broaden the set, deduped.
    if (result.roleClassification !== 'non-technical') {
      if (!result.suggestedSkills) result.suggestedSkills = [];
      if (result.suggestedSkills.length < 3) {
        const local = analyzeJobLocal(jobTitle, jobDescription, experience);
        for (const s of local.suggestedSkills) {
          if (!result.suggestedSkills.some(existing => existing.toLowerCase() === s.toLowerCase())) {
            result.suggestedSkills.push(s);
          }
        }
        result.suggestedSkills = result.suggestedSkills.slice(0, 10);
        result.roleClassification = result.roleClassification || local.roleClassification;
      }
    }

    return result;
  } catch {
    return analyzeJobLocal(jobTitle, jobDescription, experience);
  }
}

/* ── brand-new question authoring (separate from the library-selection flow above) ───── */

export interface SuggestedMCQQuestion {
  questionText: string;
  options: string[];
  correctAnswers: number[];
  marks: number;
  isMultipleChoice: boolean;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  suggestedTimeEstimateSec: number;
}

export interface SuggestedCodingQuestion {
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  sampleInput: string;
  sampleOutput: string;
  marks: number;
  timeLimit: number;
  memoryLimit: number;
  supportedLanguages: string[];
  testCases: Array<{ input: string; expectedOutput: string; isHidden: boolean; marks: number }>;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
}

export interface SuggestedBehavioralQuestion {
  title: string;
  description: string;
  expectedAnswer: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  suggestedTimeEstimateSec: number;
}

export interface SuggestedWrittenQuestion {
  title: string;
  description: string;
  evaluationNotes: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  suggestedTimeEstimateSec: number;
}

export interface SuggestedSpeakingQuestion {
  title: string;
  description: string;
  evaluationNotes: string;
  recordingTimeLimit: number;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  suggestedTimeEstimateSec: number;
}

export interface SuggestedReadingGroup {
  passage: { title: string; passageText: string };
  questions: Array<{
    title: string;
    options: string[];
    correctAnswers: number[];
    explanation: string;
    marks: number;
    difficulty: 'easy' | 'medium' | 'hard';
    topic: string;
    tags: string[];
  }>;
}

export interface QuestionSuggestions {
  mcq: SuggestedMCQQuestion[];
  coding: SuggestedCodingQuestion[];
  behavioral: SuggestedBehavioralQuestion[];
  written: SuggestedWrittenQuestion[];
  reading: SuggestedReadingGroup | null;
  speaking: SuggestedSpeakingQuestion[];
}

const SUPPORTED_CODING_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'c', 'csharp', 'go', 'typescript'];

function normalizeDifficulty(value: unknown): 'easy' | 'medium' | 'hard' {
  return value === 'easy' || value === 'hard' ? value : 'medium';
}

function normalizeStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, max);
}

function normalizeMarks(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeMCQSuggestion(raw: Record<string, unknown>): SuggestedMCQQuestion | null {
  const questionText = typeof raw.questionText === 'string' ? raw.questionText.trim() : '';
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
    : [];
  if (!questionText || options.length < 2) return null;

  const correctAnswers = Array.isArray(raw.correctAnswers)
    ? raw.correctAnswers
        .map(i => Math.floor(Number(i)))
        .filter(i => Number.isInteger(i) && i >= 0 && i < options.length)
    : [];
  if (correctAnswers.length === 0) return null;

  return {
    questionText,
    options,
    correctAnswers,
    marks: normalizeMarks(raw.marks, 5),
    isMultipleChoice: Boolean(raw.isMultipleChoice) || correctAnswers.length > 1,
    explanation: typeof raw.explanation === 'string' ? raw.explanation.trim() : '',
    difficulty: normalizeDifficulty(raw.difficulty),
    topic: typeof raw.topic === 'string' ? raw.topic.trim() : '',
    tags: normalizeStringArray(raw.tags, 8),
    suggestedTimeEstimateSec: Number.isFinite(Number(raw.suggestedTimeEstimateSec)) ? Math.floor(Number(raw.suggestedTimeEstimateSec)) : 45
  };
}

function normalizeCodingSuggestion(raw: Record<string, unknown>): SuggestedCodingQuestion | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const sampleInput = typeof raw.sampleInput === 'string' ? raw.sampleInput : '';
  const sampleOutput = typeof raw.sampleOutput === 'string' ? raw.sampleOutput : '';
  if (!title || !description) return null;

  const testCases = Array.isArray(raw.testCases)
    ? raw.testCases
        .filter((tc): tc is Record<string, unknown> => !!tc && typeof tc === 'object')
        .map(tc => ({
          input: typeof tc.input === 'string' ? tc.input : '',
          expectedOutput: typeof tc.expectedOutput === 'string' ? tc.expectedOutput : '',
          isHidden: Boolean(tc.isHidden),
          marks: normalizeMarks(tc.marks, 0)
        }))
        .filter(tc => tc.input && tc.expectedOutput)
        .slice(0, 10)
    : [];

  const supportedLanguages = normalizeStringArray(raw.supportedLanguages, 8)
    .map(l => l.toLowerCase())
    .filter(l => SUPPORTED_CODING_LANGUAGES.includes(l));

  return {
    title,
    description,
    inputFormat: typeof raw.inputFormat === 'string' ? raw.inputFormat.trim() : '',
    outputFormat: typeof raw.outputFormat === 'string' ? raw.outputFormat.trim() : '',
    constraints: typeof raw.constraints === 'string' ? raw.constraints.trim() : '',
    sampleInput,
    sampleOutput,
    marks: normalizeMarks(raw.marks, 20),
    timeLimit: Number.isFinite(Number(raw.timeLimit)) && Number(raw.timeLimit) > 0 ? Math.floor(Number(raw.timeLimit)) : 2000,
    memoryLimit: Number.isFinite(Number(raw.memoryLimit)) && Number(raw.memoryLimit) > 0 ? Math.floor(Number(raw.memoryLimit)) : 256,
    supportedLanguages: supportedLanguages.length ? supportedLanguages : ['python', 'javascript'],
    testCases,
    difficulty: normalizeDifficulty(raw.difficulty),
    topic: typeof raw.topic === 'string' ? raw.topic.trim() : '',
    tags: normalizeStringArray(raw.tags, 8)
  };
}

function normalizeBehavioralSuggestion(raw: Record<string, unknown>): SuggestedBehavioralQuestion | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!title || !description) return null;

  return {
    title,
    description,
    expectedAnswer: typeof raw.expectedAnswer === 'string' ? raw.expectedAnswer.trim() : '',
    marks: normalizeMarks(raw.marks, 5),
    difficulty: normalizeDifficulty(raw.difficulty),
    topic: typeof raw.topic === 'string' ? raw.topic.trim() : '',
    tags: normalizeStringArray(raw.tags, 8),
    suggestedTimeEstimateSec: Number.isFinite(Number(raw.suggestedTimeEstimateSec)) ? Math.floor(Number(raw.suggestedTimeEstimateSec)) : 120
  };
}

function normalizeWrittenSuggestion(raw: Record<string, unknown>): SuggestedWrittenQuestion | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!title || !description) return null;

  return {
    title,
    description,
    evaluationNotes: typeof raw.evaluationNotes === 'string' ? raw.evaluationNotes.trim() : '',
    marks: normalizeMarks(raw.marks, 10),
    difficulty: normalizeDifficulty(raw.difficulty),
    topic: typeof raw.topic === 'string' ? raw.topic.trim() : '',
    tags: normalizeStringArray(raw.tags, 8),
    suggestedTimeEstimateSec: Number.isFinite(Number(raw.suggestedTimeEstimateSec)) ? Math.floor(Number(raw.suggestedTimeEstimateSec)) : 300
  };
}

function normalizeSpeakingSuggestion(raw: Record<string, unknown>): SuggestedSpeakingQuestion | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!title || !description) return null;

  return {
    title,
    description,
    evaluationNotes: typeof raw.evaluationNotes === 'string' ? raw.evaluationNotes.trim() : '',
    recordingTimeLimit: Number.isFinite(Number(raw.recordingTimeLimit)) && Number(raw.recordingTimeLimit) >= 10 ? Math.floor(Number(raw.recordingTimeLimit)) : 120,
    marks: normalizeMarks(raw.marks, 10),
    difficulty: normalizeDifficulty(raw.difficulty),
    topic: typeof raw.topic === 'string' ? raw.topic.trim() : '',
    tags: normalizeStringArray(raw.tags, 8),
    suggestedTimeEstimateSec: Number.isFinite(Number(raw.suggestedTimeEstimateSec)) ? Math.floor(Number(raw.suggestedTimeEstimateSec)) : 180
  };
}

function normalizeReadingGroup(raw: Record<string, unknown> | undefined, maxQuestions: number): SuggestedReadingGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const passageRaw = raw.passage as Record<string, unknown> | undefined;
  const passageTitle = passageRaw && typeof passageRaw.title === 'string' ? passageRaw.title.trim() : '';
  const passageText = passageRaw && typeof passageRaw.passageText === 'string' ? passageRaw.passageText.trim() : '';
  if (!passageTitle || !passageText) return null;

  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
    .map(q => {
      const title = typeof q.title === 'string' ? q.title.trim() : '';
      const options = Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        : [];
      if (!title || options.length < 2) return null;
      const correctAnswers = Array.isArray(q.correctAnswers)
        ? q.correctAnswers.map(i => Math.floor(Number(i))).filter(i => Number.isInteger(i) && i >= 0 && i < options.length)
        : [];
      if (correctAnswers.length === 0) return null;
      return {
        title,
        options,
        correctAnswers,
        explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '',
        marks: normalizeMarks(q.marks, 5),
        difficulty: normalizeDifficulty(q.difficulty),
        topic: typeof q.topic === 'string' ? q.topic.trim() : '',
        tags: normalizeStringArray(q.tags, 8)
      };
    })
    .filter((q): q is SuggestedReadingGroup['questions'][number] => q !== null)
    .slice(0, maxQuestions);

  if (questions.length === 0) return null;

  return { passage: { title: passageTitle, passageText }, questions };
}

export async function suggestNewQuestions(
  jobProfile: JobProfile,
  skills: string[],
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed',
  counts: {
    mcqCount: number; codingCount: number; behavioralCount: number;
    writtenCount?: number; readingQuestionCount?: number; speakingCount?: number;
  }
): Promise<QuestionSuggestions> {
  if (!hasLLMKey()) {
    throw new Error('AI question authoring requires an LLM API key to be configured.');
  }

  const mcqCount = Math.max(0, Math.min(10, Math.floor(counts.mcqCount)));
  const codingCount = Math.max(0, Math.min(5, Math.floor(counts.codingCount)));
  const behavioralCount = Math.max(0, Math.min(5, Math.floor(counts.behavioralCount)));
  const writtenCount = Math.max(0, Math.min(5, Math.floor(counts.writtenCount || 0)));
  const readingQuestionCount = Math.max(0, Math.min(5, Math.floor(counts.readingQuestionCount || 0)));
  const speakingCount = Math.max(0, Math.min(5, Math.floor(counts.speakingCount || 0)));

  // Shared JSON-formatting rules for every per-category call below.
  const basePrompt = `You are an expert technical interviewer and question-bank author. Unlike a librarian picking from an existing catalog, your job here is to WRITE brand-new, original assessment questions from scratch, tailored precisely to the job profile given. Never write generic filler questions — every question must genuinely probe one of the required skills at the requested difficulty. Always respond with a valid JSON object only, no prose outside the JSON. Every string value must be valid JSON: escape all newlines as \\n, tabs as \\t, and double quotes as \\" — this matters most in multi-line fields like a coding question's description, sampleInput, sampleOutput, or a test case's input/expectedOutput. Never place a literal, unescaped line break inside a JSON string. Never use a bare double quote to emphasize or quote a word/phrase inside a string value (e.g. do NOT write "the "primitive" types") — use single quotes for that instead (e.g. "the 'primitive' types"), or escape it as \\". Keep every question concise enough that the full response comfortably fits the token budget — never truncate a question mid-way; if you are running low on space, write fewer questions rather than cutting one off.`;

  const jobBrief = `**Job Title:** ${jobProfile.title}
**Experience Level:** ${jobProfile.experience}
${jobProfile.description ? `**Job Description:** ${jobProfile.description}` : ''}
**Required Skills:** ${skills.join(', ')}
**Difficulty Level:** ${difficulty}`;

  // Each question category used to be authored in a single mega-call sharing one token
  // budget across all of them (up to 10 MCQ + 5 coding + 5 behavioral + 5 written + a
  // reading passage + 5 speaking questions at once). That made truncation likely (one
  // long-winded category could starve the rest, breaking the whole JSON response) and
  // made the whole request slow enough to trip the reverse proxy's read timeout. Splitting
  // into one call per category — run in parallel, each with its own generous budget —
  // fixes both: a single category running long can't sink the others, and the categories
  // that were previously serialized into one big call now happen concurrently instead.
  type CategoryJob<T> = { key: string; run: () => Promise<T> };

  async function runCategory<T>(key: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      console.error(`suggestNewQuestions: "${key}" category failed, returning empty for it:`, err);
      return fallback;
    }
  }

  const jobs: CategoryJob<unknown>[] = [];

  if (mcqCount > 0) {
    jobs.push({
      key: 'mcq',
      run: () => runCategory('mcq', [] as SuggestedMCQQuestion[], async () => {
        const response = await callLLM([
          { role: 'system', content: basePrompt },
          { role: 'user', content: `Author new assessment questions for this role:

${jobBrief}

Write exactly ${mcqCount} multiple-choice question(s).

Respond with a JSON object shaped exactly like this:
{
  "mcq": [
    {
      "questionText": "...",
      "options": ["...", "...", "...", "..."],
      "correctAnswers": [0],
      "marks": 5,
      "isMultipleChoice": false,
      "explanation": "why the correct answer is right",
      "difficulty": "easy|medium|hard",
      "topic": "short category name",
      "tags": ["skill1", "skill2"],
      "suggestedTimeEstimateSec": 45
    }
  ]
}` }
        ], { temperature: 0.6, maxTokens: 4096 });
        const parsed = parseJSONFromLLM(response.content) as Record<string, unknown>;
        return (Array.isArray(parsed.mcq) ? parsed.mcq : [])
          .map(raw => normalizeMCQSuggestion(raw as Record<string, unknown>))
          .filter((q): q is SuggestedMCQQuestion => q !== null)
          .slice(0, mcqCount);
      })
    });
  }

  if (codingCount > 0) {
    jobs.push({
      key: 'coding',
      run: () => runCategory('coding', [] as SuggestedCodingQuestion[], async () => {
        const response = await callLLM([
          { role: 'system', content: basePrompt },
          { role: 'user', content: `Author new assessment questions for this role:

${jobBrief}

Write exactly ${codingCount} coding question(s).

Respond with a JSON object shaped exactly like this:
{
  "coding": [
    {
      "title": "...",
      "description": "full problem statement",
      "inputFormat": "...",
      "outputFormat": "...",
      "constraints": "...",
      "sampleInput": "...",
      "sampleOutput": "...",
      "marks": 20,
      "timeLimit": 2000,
      "memoryLimit": 256,
      "supportedLanguages": ["python", "javascript"],
      "testCases": [{ "input": "...", "expectedOutput": "...", "isHidden": false, "marks": 10 }],
      "difficulty": "easy|medium|hard",
      "topic": "short category name",
      "tags": ["skill1", "skill2"]
    }
  ]
}` }
        ], { temperature: 0.6, maxTokens: 6144 });
        const parsed = parseJSONFromLLM(response.content) as Record<string, unknown>;
        return (Array.isArray(parsed.coding) ? parsed.coding : [])
          .map(raw => normalizeCodingSuggestion(raw as Record<string, unknown>))
          .filter((q): q is SuggestedCodingQuestion => q !== null)
          .slice(0, codingCount);
      })
    });
  }

  if (behavioralCount > 0) {
    jobs.push({
      key: 'behavioral',
      run: () => runCategory('behavioral', [] as SuggestedBehavioralQuestion[], async () => {
        const response = await callLLM([
          { role: 'system', content: basePrompt },
          { role: 'user', content: `Author new assessment questions for this role:

${jobBrief}

Write exactly ${behavioralCount} behavioral question(s).

Respond with a JSON object shaped exactly like this:
{
  "behavioral": [
    {
      "title": "short scenario title",
      "description": "the full behavioral question/prompt shown to the candidate",
      "expectedAnswer": "what a strong answer covers (grading benchmark, not shown to candidate)",
      "marks": 5,
      "difficulty": "easy|medium|hard",
      "topic": "short category name",
      "tags": ["communication", "teamwork"],
      "suggestedTimeEstimateSec": 120
    }
  ]
}` }
        ], { temperature: 0.6, maxTokens: 3072 });
        const parsed = parseJSONFromLLM(response.content) as Record<string, unknown>;
        return (Array.isArray(parsed.behavioral) ? parsed.behavioral : [])
          .map(raw => normalizeBehavioralSuggestion(raw as Record<string, unknown>))
          .filter((q): q is SuggestedBehavioralQuestion => q !== null)
          .slice(0, behavioralCount);
      })
    });
  }

  if (writtenCount > 0) {
    jobs.push({
      key: 'written',
      run: () => runCategory('written', [] as SuggestedWrittenQuestion[], async () => {
        const response = await callLLM([
          { role: 'system', content: basePrompt },
          { role: 'user', content: `Author new assessment questions for this role:

${jobBrief}

Write exactly ${writtenCount} written-response question(s) (a Communication sub-type: candidate types a free-text answer to a prompt, graded on grammar/wording/coherence).

Respond with a JSON object shaped exactly like this:
{
  "written": [
    {
      "title": "short label for this question (e.g. 'Describe your ideal work environment')",
      "description": "the full prompt shown to the candidate — what they must write about",
      "evaluationNotes": "extra grading rubric beyond the prompt itself (grammar/wording/coherence focus)",
      "marks": 10,
      "difficulty": "easy|medium|hard",
      "topic": "short category name",
      "tags": ["skill1", "skill2"],
      "suggestedTimeEstimateSec": 300
    }
  ]
}` }
        ], { temperature: 0.6, maxTokens: 4096 });
        const parsed = parseJSONFromLLM(response.content) as Record<string, unknown>;
        return (Array.isArray(parsed.written) ? parsed.written : [])
          .map(raw => normalizeWrittenSuggestion(raw as Record<string, unknown>))
          .filter((q): q is SuggestedWrittenQuestion => q !== null)
          .slice(0, writtenCount);
      })
    });
  }

  if (readingQuestionCount > 0) {
    jobs.push({
      key: 'reading',
      run: () => runCategory('reading', null as SuggestedReadingGroup | null, async () => {
        const response = await callLLM([
          { role: 'system', content: basePrompt },
          { role: 'user', content: `Author a new assessment question for this role:

${jobBrief}

Write exactly 1 reading passage with ${readingQuestionCount} linked multiple-choice question(s) about it (a Communication sub-type).

Respond with a JSON object shaped exactly like this:
{
  "reading": {
    "passage": { "title": "short passage title", "passageText": "the full passage text the candidate reads" },
    "questions": [
      {
        "title": "the full multiple-choice question text about the passage",
        "options": ["...", "...", "...", "..."],
        "correctAnswers": [0],
        "explanation": "why the correct answer is right",
        "marks": 5,
        "difficulty": "easy|medium|hard",
        "topic": "short category name",
        "tags": ["skill1", "skill2"]
      }
    ]
  }
}` }
        ], { temperature: 0.6, maxTokens: 4096 });
        const parsed = parseJSONFromLLM(response.content) as Record<string, unknown>;
        return normalizeReadingGroup(parsed.reading as Record<string, unknown> | undefined, readingQuestionCount);
      })
    });
  }

  if (speakingCount > 0) {
    jobs.push({
      key: 'speaking',
      run: () => runCategory('speaking', [] as SuggestedSpeakingQuestion[], async () => {
        const response = await callLLM([
          { role: 'system', content: basePrompt },
          { role: 'user', content: `Author new assessment questions for this role:

${jobBrief}

Write exactly ${speakingCount} speaking-topic question(s) (a Communication sub-type: candidate records a spoken answer to a topic, so only write the topic/prompt text, not the answer).

Respond with a JSON object shaped exactly like this:
{
  "speaking": [
    {
      "title": "short label for this question (e.g. 'Handling a scheduling conflict')",
      "description": "the topic/prompt the candidate speaks about — never an answer",
      "evaluationNotes": "what a strong spoken answer covers (grading benchmark)",
      "recordingTimeLimit": 120,
      "marks": 10,
      "difficulty": "easy|medium|hard",
      "topic": "short category name",
      "tags": ["skill1", "skill2"],
      "suggestedTimeEstimateSec": 180
    }
  ]
}` }
        ], { temperature: 0.6, maxTokens: 3072 });
        const parsed = parseJSONFromLLM(response.content) as Record<string, unknown>;
        return (Array.isArray(parsed.speaking) ? parsed.speaking : [])
          .map(raw => normalizeSpeakingSuggestion(raw as Record<string, unknown>))
          .filter((q): q is SuggestedSpeakingQuestion => q !== null)
          .slice(0, speakingCount);
      })
    });
  }

  const results = new Map<string, unknown>();
  await Promise.all(jobs.map(async job => { results.set(job.key, await job.run()); }));

  return {
    mcq: (results.get('mcq') as SuggestedMCQQuestion[] | undefined) || [],
    coding: (results.get('coding') as SuggestedCodingQuestion[] | undefined) || [],
    behavioral: (results.get('behavioral') as SuggestedBehavioralQuestion[] | undefined) || [],
    written: (results.get('written') as SuggestedWrittenQuestion[] | undefined) || [],
    reading: (results.get('reading') as SuggestedReadingGroup | null | undefined) ?? null,
    speaking: (results.get('speaking') as SuggestedSpeakingQuestion[] | undefined) || []
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

export interface ReviewMCQDetail {
  id: string;
  questionText: string;
  options: string[];
  correctAnswers: number[];
  marks: number;
  isMultipleChoice: boolean;
  explanation: string | null;
  difficulty: string;
  topic: string | null;
  tags: string[];
}
export interface ReviewCodingDetail {
  id: string;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string | null;
  sampleInput: string;
  sampleOutput: string;
  marks: number;
  timeLimit: number;
  memoryLimit: number;
  supportedLanguages: string[];
  difficulty: string;
  topic: string | null;
  tags: string[];
  testCases: Array<{ input: string; expectedOutput: string; isHidden: boolean; marks: number }>;
}
export interface ReviewBehavioralDetail {
  id: string;
  title: string;
  description: string;
  expectedAnswer: string | null;
  marks: number;
  difficulty: string;
  topic: string | null;
  tags: string[];
}

export interface ReviewCommunicationDetail {
  id: string;
  subType: 'WRITTEN' | 'LISTENING' | 'READING' | 'SPEAKING';
  title: string;
  description: string | null;
  marks: number;
  difficulty: string;
  topic: string | null;
  tags: string[];
  stimulusType: string | null;
  evaluationNotes: string | null;
  recordingTimeLimit: number | null;
  options: string[];
  correctAnswers: number[];
  explanation: string | null;
  passage: { title: string; passageText: string } | null;
}

// Pure read — fetches the full stored details (options, test cases, expected answers, etc.) for a
// final set of selected question IDs, regardless of whether they originated from a library match,
// a manual library pick, or an AI-authored suggestion (all three are real persisted questions by
// the time their ids reach here) — used to render a complete, read-only pre-creation review.
export async function getQuestionDetailsForReview(
  mcqIds: string[],
  codingIds: string[],
  behavioralIds: string[],
  communicationIds: string[] = []
): Promise<{
  mcq: ReviewMCQDetail[];
  coding: ReviewCodingDetail[];
  behavioral: ReviewBehavioralDetail[];
  communication: ReviewCommunicationDetail[];
}> {
  const [mcqQuestions, codingQuestions, behavioralQuestions, communicationQuestions] = await Promise.all([
    mcqIds.length ? prisma.mCQQuestion.findMany({ where: { id: { in: mcqIds } } }) : Promise.resolve([]),
    codingIds.length ? prisma.codingQuestion.findMany({ where: { id: { in: codingIds } }, include: { testCases: true } }) : Promise.resolve([]),
    behavioralIds.length ? prisma.behavioralQuestion.findMany({ where: { id: { in: behavioralIds } } }) : Promise.resolve([]),
    communicationIds.length ? prisma.communicationQuestion.findMany({ where: { id: { in: communicationIds } }, include: { passage: true } }) : Promise.resolve([])
  ]);

  const mcqById = new Map(mcqQuestions.map((q: typeof mcqQuestions[number]) => [q.id, q]));
  const codingById = new Map(codingQuestions.map((q: typeof codingQuestions[number]) => [q.id, q]));
  const behavioralById = new Map(behavioralQuestions.map((q: typeof behavioralQuestions[number]) => [q.id, q]));
  const communicationById = new Map(communicationQuestions.map((q: typeof communicationQuestions[number]) => [q.id, q]));

  return {
    // Preserve the order the caller asked for (the order questions were selected in), not DB order.
    mcq: mcqIds
      .map(id => mcqById.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map(q => ({
        id: q.id,
        questionText: q.questionText,
        options: JSON.parse(q.options),
        correctAnswers: JSON.parse(q.correctAnswers),
        marks: q.marks,
        isMultipleChoice: q.isMultipleChoice,
        explanation: q.explanation,
        difficulty: q.difficulty,
        topic: q.topic,
        tags: q.tags ? JSON.parse(q.tags) : []
      })),
    coding: codingIds
      .map(id => codingById.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map(q => ({
        id: q.id,
        title: q.title,
        description: q.description,
        inputFormat: q.inputFormat,
        outputFormat: q.outputFormat,
        constraints: q.constraints,
        sampleInput: q.sampleInput,
        sampleOutput: q.sampleOutput,
        marks: q.marks,
        timeLimit: q.timeLimit,
        memoryLimit: q.memoryLimit,
        supportedLanguages: JSON.parse(q.supportedLanguages),
        difficulty: q.difficulty,
        topic: q.topic,
        tags: q.tags ? JSON.parse(q.tags) : [],
        testCases: q.testCases.map((tc: { input: string; expectedOutput: string; isHidden: boolean; marks: number }) => ({
          input: tc.input, expectedOutput: tc.expectedOutput, isHidden: tc.isHidden, marks: tc.marks
        }))
      })),
    behavioral: behavioralIds
      .map(id => behavioralById.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map(q => ({
        id: q.id,
        title: q.title,
        description: q.description,
        expectedAnswer: q.expectedAnswer,
        marks: q.marks,
        difficulty: q.difficulty,
        topic: q.topic,
        tags: q.tags ? JSON.parse(q.tags) : []
      })),
    communication: communicationIds
      .map(id => communicationById.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map(q => ({
        id: q.id,
        subType: q.subType,
        title: q.title,
        description: q.description,
        marks: q.marks,
        difficulty: q.difficulty,
        topic: q.topic,
        tags: q.tags ? JSON.parse(q.tags) : [],
        stimulusType: q.stimulusType,
        evaluationNotes: q.evaluationNotes,
        recordingTimeLimit: q.recordingTimeLimit,
        options: q.options ? JSON.parse(q.options) : [],
        correctAnswers: q.correctAnswers ? JSON.parse(q.correctAnswers) : [],
        explanation: q.explanation,
        passage: q.passage ? { title: q.passage.title, passageText: q.passage.passageText } : null
      }))
  };
}
