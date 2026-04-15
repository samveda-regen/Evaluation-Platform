export interface Admin {
  id: string;
  email: string;
  name: string;
}

export interface Candidate {
  id: string;
  email: string;
  name: string;
}

export interface Test {
  id: string;
  testCode: string;
  name: string;
  description?: string;
  instructions?: string;
  duration: number;
  startTime: string;
  endTime?: string;
  totalMarks: number;
  passingMarks?: number;
  negativeMarking: number;
  isActive: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowMultipleAttempts: boolean;
  maxViolations: number;
  proctorEnabled?: boolean;
  requireCamera?: boolean;
  requireMicrophone?: boolean;
  requireScreenShare?: boolean;
  requireIdVerification?: boolean;
  createdAt: string;
  _count?: {
    questions: number;
    attempts: number;
  };
}

export interface MCQQuestion {
  id: string;
  questionText: string;
  options: string[];
  correctAnswers: number[];
  marks: number;
  isMultipleChoice: boolean;
  explanation?: string;
}

export interface CodingQuestion {
  id: string;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints?: string;
  sampleInput: string;
  sampleOutput: string;
  marks: number;
  timeLimit: number;
  memoryLimit: number;
  supportedLanguages: string[];
  partialScoring: boolean;
  testCases?: TestCase[];
}

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
  marks: number;
}

export interface RepositoryMediaAsset {
  id: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageUrl: string;
  mediaType: 'image' | 'video' | 'audio';
  filename?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
}

export interface TestQuestion {
  id: string;
  type: 'mcq' | 'coding' | 'behavioral';
  questionId: string;
  // MCQ fields
  questionText?: string;
  options?: Array<{ originalIndex: number; text: string }>;
  isMultipleChoice?: boolean;
  // Coding fields
  title?: string;
  description?: string;
  inputFormat?: string;
  outputFormat?: string;
  constraints?: string;
  sampleInput?: string;
  sampleOutput?: string;
  supportedLanguages?: string[];
  codeTemplates?: Record<string, string>;
  timeLimit?: number;
  testCases?: { input: string; expectedOutput: string }[];
  mediaAssets?: Array<{
    id: string;
    storageUrl: string;
    mediaType: 'image' | 'video' | 'audio';
    originalName: string;
    mimeType: string;
  }>;
  // Behavioral fields
  expectedAnswer?: string;
  // Common
  marks: number;
}

export interface TestAttempt {
  id: string;
  testId: string;
  candidateId: string;
  startTime: string;
  endTime?: string;
  submittedAt?: string;
  status: 'in_progress' | 'submitted' | 'auto_submitted' | 'flagged';
  score?: number;
  trustScore?: number;
  violations: number;
  isFlagged: boolean;
  flagReason?: string;
  candidate?: Candidate;
  _count?: {
    mcqAnswers: number;
    codingAnswers: number;
    behavioralAnswers?: number;
    activityLogs: number;
  };
}

export interface MCQAnswer {
  questionId: string;
  selectedOptions: number[];
}

export interface CodingAnswer {
  questionId: string;
  code: string;
  language: string;
}

export interface BehavioralAnswer {
  questionId: string;
  answerText: string;
}

export interface ActivityLog {
  id: string;
  eventType: string;
  eventData?: string;
  timestamp: string;
}

export interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type RepositoryCategory = 'MCQ' | 'CODING' | 'BEHAVIORAL';
export type RepositorySource = 'QUESTION_BANK' | 'CUSTOM';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

interface RepositoryQuestionBase {
  id: string;
  source: RepositorySource;
  repositoryCategory: RepositoryCategory;
  isEnabled: boolean;
  marks: number;
  difficulty: QuestionDifficulty;
  topic?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryMCQQuestion extends RepositoryQuestionBase {
  repositoryCategory: 'MCQ';
  questionText: string;
  options: string[];
  correctAnswers: number[];
  isMultipleChoice: boolean;
  explanation?: string | null;
  mediaAssets?: RepositoryMediaAsset[];
}

export interface RepositoryCodingQuestion extends RepositoryQuestionBase {
  repositoryCategory: 'CODING';
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints?: string | null;
  sampleInput: string;
  sampleOutput: string;
  timeLimit: number;
  memoryLimit: number;
  supportedLanguages: string[];
  codeTemplates: Record<string, string> | null;
  partialScoring: boolean;
  autoEvaluate: boolean;
  testCases?: TestCase[];
}

export interface RepositoryBehavioralQuestion extends RepositoryQuestionBase {
  repositoryCategory: 'BEHAVIORAL';
  title: string;
  description: string;
  expectedAnswer?: string | null;
}

export type RepositoryQuestion =
  | RepositoryMCQQuestion
  | RepositoryCodingQuestion
  | RepositoryBehavioralQuestion;

export interface RepositoryQueryParams {
  category: RepositoryCategory;
  page?: number;
  limit?: number;
  search?: string;
  difficulty?: QuestionDifficulty | '';
  topic?: string;
  tag?: string;
  enabled?: boolean;
}

export interface RepositoryListResponse {
  questions: RepositoryQuestion[];
  pagination: Pagination;
}
