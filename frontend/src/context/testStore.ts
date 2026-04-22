import { create } from 'zustand';
import { TestQuestion, MCQAnswer, CodingAnswer, BehavioralAnswer } from '../types';
import { DEFAULT_CUSTOM_AI_VIOLATIONS, normalizeCustomAIViolationSelection } from '../constants/customAIViolations';

interface TestState {
  testId: string | null;
  testCode: string | null;
  attemptId: string | null;
  testName: string;
  duration: number;
  totalMarks: number;
  negativeMarking: number;
  maxViolations: number;
  proctorEnabled: boolean;
  requireCamera: boolean;
  requireMicrophone: boolean;
  requireScreenShare: boolean;
  customAIViolations: string[];
  violationPopupSettings: { enabled: boolean; durationSeconds: number };
  startTime: Date | null;
  questions: TestQuestion[];
  currentQuestionIndex: number;
  mcqAnswers: Record<string, number[]>;
  codingAnswers: Record<string, { code: string; language: string }>;
  behavioralAnswers: Record<string, string>;
  violations: number;
  isSubmitted: boolean;

  setTestData: (data: {
    testId: string;
    testCode?: string;
    attemptId: string;
    testName: string;
    duration: number;
    totalMarks: number;
    negativeMarking: number;
    maxViolations: number;
    proctorEnabled: boolean;
    requireCamera: boolean;
    requireMicrophone: boolean;
    requireScreenShare: boolean;
    customAIViolations?: string[];
    violationPopupSettings?: { enabled: boolean; durationSeconds: number };
    startTime: Date;
    questions: TestQuestion[];
    initialViolations?: number;
  }) => void;

  setCurrentQuestion: (index: number) => void;
  saveMCQAnswer: (questionId: string, selectedOptions: number[]) => void;
  saveCodingAnswer: (questionId: string, code: string, language: string) => void;
  saveBehavioralAnswer: (questionId: string, answerText: string) => void;
  incrementViolations: () => number;
  setSubmitted: () => void;
  resetTest: () => void;
  loadSavedAnswers: (mcq: MCQAnswer[], coding: CodingAnswer[], behavioral: BehavioralAnswer[]) => void;
}

export const useTestStore = create<TestState>((set, get) => ({
  testId: null,
  testCode: null,
  attemptId: null,
  testName: '',
  duration: 0,
  totalMarks: 0,
  negativeMarking: 0,
  maxViolations: 3,
  proctorEnabled: false,
  requireCamera: false,
  requireMicrophone: false,
  requireScreenShare: false,
  customAIViolations: [...DEFAULT_CUSTOM_AI_VIOLATIONS],
  violationPopupSettings: { enabled: false, durationSeconds: 3 },
  startTime: null,
  questions: [],
  currentQuestionIndex: 0,
  mcqAnswers: {},
  codingAnswers: {},
  behavioralAnswers: {},
  violations: 0,
  isSubmitted: false,

  setTestData: (data) => set({
    testId: data.testId,
    testCode: data.testCode || null,
    attemptId: data.attemptId,
    testName: data.testName,
    duration: data.duration,
    totalMarks: data.totalMarks,
    negativeMarking: data.negativeMarking,
    maxViolations: data.maxViolations,
    proctorEnabled: data.proctorEnabled,
    requireCamera: data.requireCamera,
    requireMicrophone: data.requireMicrophone,
    requireScreenShare: data.requireScreenShare,
    customAIViolations: normalizeCustomAIViolationSelection(data.customAIViolations),
    violationPopupSettings: data.violationPopupSettings ?? { enabled: false, durationSeconds: 3 },
    startTime: data.startTime,
    questions: data.questions,
    currentQuestionIndex: 0,
    mcqAnswers: {},
    codingAnswers: {},
    behavioralAnswers: {},
    violations: data.initialViolations ?? 0,
    isSubmitted: false,
  }),

  setCurrentQuestion: (index) => set({ currentQuestionIndex: index }),

  saveMCQAnswer: (questionId, selectedOptions) => set((state) => ({
    mcqAnswers: {
      ...state.mcqAnswers,
      [questionId]: selectedOptions
    }
  })),

  saveCodingAnswer: (questionId, code, language) => set((state) => ({
    codingAnswers: {
      ...state.codingAnswers,
      [questionId]: { code, language }
    }
  })),

  saveBehavioralAnswer: (questionId, answerText) => set((state) => ({
    behavioralAnswers: {
      ...state.behavioralAnswers,
      [questionId]: answerText
    }
  })),

  incrementViolations: () => {
    const newViolations = get().violations + 1;
    set({ violations: newViolations });
    return newViolations;
  },

  setSubmitted: () => set({ isSubmitted: true }),

  resetTest: () => set({
    testId: null,
    testCode: null,
    attemptId: null,
    testName: '',
    duration: 0,
    totalMarks: 0,
    negativeMarking: 0,
    maxViolations: 3,
    proctorEnabled: false,
    requireCamera: false,
    requireMicrophone: false,
    requireScreenShare: false,
    customAIViolations: [...DEFAULT_CUSTOM_AI_VIOLATIONS],
    violationPopupSettings: { enabled: false, durationSeconds: 3 },
    startTime: null,
    questions: [],
    currentQuestionIndex: 0,
    mcqAnswers: {},
    codingAnswers: {},
    behavioralAnswers: {},
    violations: 0,
    isSubmitted: false
  }),

  loadSavedAnswers: (mcq, coding, behavioral) => set((state) => {
    const mcqAnswers: Record<string, number[]> = { ...state.mcqAnswers };
    const codingAnswers: Record<string, { code: string; language: string }> = { ...state.codingAnswers };
    const behavioralAnswers: Record<string, string> = { ...state.behavioralAnswers };

    mcq.forEach((a) => {
      mcqAnswers[a.questionId] = a.selectedOptions;
    });

    coding.forEach((a) => {
      codingAnswers[a.questionId] = { code: a.code, language: a.language };
    });

    behavioral.forEach((a) => {
      behavioralAnswers[a.questionId] = a.answerText;
    });

    return { mcqAnswers, codingAnswers, behavioralAnswers };
  })
}));
