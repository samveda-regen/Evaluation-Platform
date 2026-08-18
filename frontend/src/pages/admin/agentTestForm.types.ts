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
  writtenQuestionIds: string[];
  readingQuestionIds: string[];
  speakingQuestionIds: string[];
  reasoning: string;
  suggestedDuration: number;
  suggestedTestName: string;
  suggestedDescription: string;
  mcqPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  codingPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  behavioralPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  writtenPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  readingPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  speakingPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
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
export interface SuggestedWritten {
  title: string;
  description: string;
  evaluationNotes: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  suggestedTimeEstimateSec: number;
}
export interface SuggestedSpeaking {
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
// A Reading suggestion is one shared passage plus several linked MCQ-shaped questions — unlike
// every other type here, it can't be persisted question-by-question independently, since each
// question needs a real passageId. `selected` toggles the whole group at once.
export interface SuggestedReadingGroup {
  passage: { title: string; passageText: string };
  questions: Array<{
    title: string; options: string[]; correctAnswers: number[]; explanation: string;
    marks: number; difficulty: 'easy' | 'medium' | 'hard'; topic: string; tags: string[];
  }>;
  selected: boolean;
  savedPassageId?: string;
  savedQuestionIds?: string[];
}
// `savedId` is set once a suggestion has actually been persisted as a custom question — lets a
// second "Continue" (e.g. after Back-ing from Step 4) reuse that id instead of creating a duplicate.
export interface QuestionSuggestions {
  mcq: (SuggestedMCQ & { selected: boolean; savedId?: string })[];
  coding: (SuggestedCoding & { selected: boolean; savedId?: string })[];
  behavioral: (SuggestedBehavioral & { selected: boolean; savedId?: string })[];
  written: (SuggestedWritten & { selected: boolean; savedId?: string })[];
  reading: SuggestedReadingGroup | null;
  speaking: (SuggestedSpeaking & { selected: boolean; savedId?: string })[];
}

export type PreviewEntry = { id: string; text: string; difficulty: string; topic: string | null };
export type LibraryPick = PreviewEntry & { selected: boolean };
export interface LibraryPicks {
  mcq: LibraryPick[];
  coding: LibraryPick[];
  behavioral: LibraryPick[];
  written: LibraryPick[];
  reading: LibraryPick[];
  speaking: LibraryPick[];
}
export type SuggestionType = 'mcq' | 'coding' | 'behavioral' | 'written' | 'reading' | 'speaking';

/* -- Full, read-only detail for the final Review step (fetched by id from the backend, since
   library-matched/picked questions only carry a lightweight preview through the rest of the flow) -- */
export interface ReviewMCQDetail {
  id: string; questionText: string; options: string[]; correctAnswers: number[]; marks: number;
  isMultipleChoice: boolean; explanation: string | null; difficulty: string; topic: string | null; tags: string[];
}
export interface ReviewCodingDetail {
  id: string; title: string; description: string; inputFormat: string; outputFormat: string;
  constraints: string | null; sampleInput: string; sampleOutput: string; marks: number; timeLimit: number;
  memoryLimit: number; supportedLanguages: string[]; difficulty: string; topic: string | null; tags: string[];
  testCases: Array<{ input: string; expectedOutput: string; isHidden: boolean; marks: number }>;
}
export interface ReviewBehavioralDetail {
  id: string; title: string; description: string; expectedAnswer: string | null; marks: number;
  difficulty: string; topic: string | null; tags: string[];
}
export interface ReviewCommunicationDetail {
  id: string; subType: 'WRITTEN' | 'LISTENING' | 'READING' | 'SPEAKING'; title: string;
  description: string | null; marks: number; difficulty: string; topic: string | null; tags: string[];
  stimulusType: string | null; evaluationNotes: string | null; recordingTimeLimit: number | null;
  options: string[]; correctAnswers: number[]; explanation: string | null;
  passage: { title: string; passageText: string } | null;
}
export interface ReviewDetails {
  mcq: ReviewMCQDetail[];
  coding: ReviewCodingDetail[];
  behavioral: ReviewBehavioralDetail[];
  communication: ReviewCommunicationDetail[];
}

export type QuestionSectionKey = SuggestionType;
export const QUESTION_SECTIONS: { key: QuestionSectionKey; label: string }[] = [
  { key: 'mcq', label: 'MCQ' },
  { key: 'coding', label: 'Coding' },
  { key: 'behavioral', label: 'Behavioral' },
  { key: 'written', label: 'Written' },
  { key: 'reading', label: 'Reading' },
  { key: 'speaking', label: 'Speaking' },
];
