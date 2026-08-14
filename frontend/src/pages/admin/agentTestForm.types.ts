/* Shared types for the AI Test Generator wizard (AgentTestForm.tsx) and its modals
   (AgentLibraryPickerModal.tsx, AgentNewQuestionModal.tsx) — split out so the modals can
   import them without a circular dependency on the main form file. */

export interface JobProfile {
  title: string;
  experience: string;
  description: string;
}

export interface QuestionSelection {
  mcqQuestionIds: string[];
  codingQuestionIds: string[];
  behavioralQuestionIds: string[];
  reasoning: string;
  suggestedDuration: number;
  suggestedTestName: string;
  suggestedDescription: string;
  mcqPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  codingPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  behavioralPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
}

/* -- AI-authored (brand-new, not library-matched) question suggestions -- */
export interface SuggestedMCQ {
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
export interface SuggestedCoding {
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
export interface SuggestedBehavioral {
  title: string;
  description: string;
  expectedAnswer: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  suggestedTimeEstimateSec: number;
}
// `savedId` is set once a suggestion has actually been persisted as a custom question — lets a
// second "Continue" (e.g. after Back-ing from Step 4) reuse that id instead of creating a duplicate.
export interface QuestionSuggestions {
  mcq: (SuggestedMCQ & { selected: boolean; savedId?: string })[];
  coding: (SuggestedCoding & { selected: boolean; savedId?: string })[];
  behavioral: (SuggestedBehavioral & { selected: boolean; savedId?: string })[];
}

export type PreviewEntry = { id: string; text: string; difficulty: string; topic: string | null };
export type LibraryPick = PreviewEntry & { selected: boolean };
export interface LibraryPicks {
  mcq: LibraryPick[];
  coding: LibraryPick[];
  behavioral: LibraryPick[];
}
export type SuggestionType = 'mcq' | 'coding' | 'behavioral';

export type QuestionSectionKey = SuggestionType;
export const QUESTION_SECTIONS: { key: QuestionSectionKey; label: string }[] = [
  { key: 'mcq', label: 'MCQ' },
  { key: 'coding', label: 'Coding' },
  { key: 'behavioral', label: 'Behavioral' },
];
