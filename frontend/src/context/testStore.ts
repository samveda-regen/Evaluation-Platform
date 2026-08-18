import { create } from 'zustand';
import { TestQuestion, MCQAnswer, CodingAnswer, BehavioralAnswer, CommunicationAnswer, SubmissionResult } from '../types';
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
  communicationAnswers: Record<string, string>;
  communicationSelectedAnswers: Record<string, number[]>;
  communicationReplayCounts: Record<string, number>;
  communicationRetakeCounts: Record<string, number>;
  communicationAudioAnswers: Record<string, { audioAssetId: string; transcript?: string | null }>;
  violations: number;
  isSubmitted: boolean;
  submissionResult: SubmissionResult | null;
  showTimer: boolean;
  autoSubmitOnTimeout: boolean;

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
    showTimer?: boolean;
    autoSubmitOnTimeout?: boolean;
  }) => void;

  setCurrentQuestion: (index: number) => void;
  saveMCQAnswer: (questionId: string, selectedOptions: number[]) => void;
  saveCodingAnswer: (questionId: string, code: string, language: string) => void;
  saveBehavioralAnswer: (questionId: string, answerText: string) => void;
  saveCommunicationAnswer: (questionId: string, answerText: string) => void;
  saveCommunicationSelectedAnswer: (questionId: string, selectedOptions: number[]) => void;
  setCommunicationReplayCount: (questionId: string, count: number) => void;
  setCommunicationRetakeCount: (questionId: string, count: number) => void;
  saveCommunicationAudioAnswer: (questionId: string, audioAssetId: string, transcript?: string | null) => void;
  incrementViolations: () => number;
  setSubmitted: (result?: SubmissionResult) => void;
  resetTest: () => void;
  loadSavedAnswers: (mcq: MCQAnswer[], coding: CodingAnswer[], behavioral: BehavioralAnswer[], communication: CommunicationAnswer[]) => void;
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
  violationPopupSettings: { enabled: false, durationSeconds: 2 },
  startTime: null,
  questions: [],
  currentQuestionIndex: 0,
  mcqAnswers: {},
  codingAnswers: {},
  behavioralAnswers: {},
  communicationAnswers: {},
  communicationSelectedAnswers: {},
  communicationReplayCounts: {},
  communicationRetakeCounts: {},
  communicationAudioAnswers: {},
  violations: 0,
  isSubmitted: false,
  submissionResult: null,
  showTimer: true,
  autoSubmitOnTimeout: true,

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
    violationPopupSettings: data.violationPopupSettings ?? { enabled: false, durationSeconds: 2 },
    startTime: data.startTime,
    questions: data.questions,
    currentQuestionIndex: 0,
    mcqAnswers: {},
    codingAnswers: {},
    behavioralAnswers: {},
    communicationAnswers: {},
    communicationSelectedAnswers: {},
    communicationReplayCounts: {},
    communicationRetakeCounts: {},
    communicationAudioAnswers: {},
    violations: data.initialViolations ?? 0,
    isSubmitted: false,
    showTimer: data.showTimer ?? true,
    autoSubmitOnTimeout: data.autoSubmitOnTimeout ?? true,
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

  saveCommunicationAnswer: (questionId, answerText) => set((state) => ({
    communicationAnswers: {
      ...state.communicationAnswers,
      [questionId]: answerText
    }
  })),

  saveCommunicationSelectedAnswer: (questionId, selectedOptions) => set((state) => ({
    communicationSelectedAnswers: {
      ...state.communicationSelectedAnswers,
      [questionId]: selectedOptions
    }
  })),

  setCommunicationReplayCount: (questionId, count) => set((state) => ({
    communicationReplayCounts: {
      ...state.communicationReplayCounts,
      [questionId]: count
    }
  })),

  setCommunicationRetakeCount: (questionId, count) => set((state) => ({
    communicationRetakeCounts: {
      ...state.communicationRetakeCounts,
      [questionId]: count
    }
  })),

  saveCommunicationAudioAnswer: (questionId, audioAssetId, transcript) => set((state) => ({
    communicationAudioAnswers: {
      ...state.communicationAudioAnswers,
      [questionId]: { audioAssetId, transcript }
    }
  })),

  incrementViolations: () => {
    const newViolations = get().violations + 1;
    set({ violations: newViolations });
    return newViolations;
  },

  setSubmitted: (result) => set({ isSubmitted: true, submissionResult: result ?? null }),

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
    violationPopupSettings: { enabled: false, durationSeconds: 2 },
    startTime: null,
    questions: [],
    currentQuestionIndex: 0,
    mcqAnswers: {},
    codingAnswers: {},
    behavioralAnswers: {},
    communicationAnswers: {},
    communicationSelectedAnswers: {},
    communicationReplayCounts: {},
    communicationRetakeCounts: {},
    communicationAudioAnswers: {},
    violations: 0,
    isSubmitted: false,
    submissionResult: null,
    showTimer: true,
    autoSubmitOnTimeout: true
  }),

  loadSavedAnswers: (mcq, coding, behavioral, communication) => set((state) => {
    const mcqAnswers: Record<string, number[]> = { ...state.mcqAnswers };
    const codingAnswers: Record<string, { code: string; language: string }> = { ...state.codingAnswers };
    const behavioralAnswers: Record<string, string> = { ...state.behavioralAnswers };
    const communicationAnswers: Record<string, string> = { ...state.communicationAnswers };
    const communicationSelectedAnswers: Record<string, number[]> = { ...state.communicationSelectedAnswers };
    const communicationReplayCounts: Record<string, number> = { ...state.communicationReplayCounts };
    const communicationRetakeCounts: Record<string, number> = { ...state.communicationRetakeCounts };
    const communicationAudioAnswers: Record<string, { audioAssetId: string; transcript?: string | null }> = { ...state.communicationAudioAnswers };

    mcq.forEach((a) => {
      mcqAnswers[a.questionId] = a.selectedOptions;
    });

    coding.forEach((a) => {
      codingAnswers[a.questionId] = { code: a.code, language: a.language };
    });

    behavioral.forEach((a) => {
      behavioralAnswers[a.questionId] = a.answerText;
    });

    communication.forEach((a) => {
      communicationAnswers[a.questionId] = a.answerText ?? '';
      if (a.selectedOptions) communicationSelectedAnswers[a.questionId] = a.selectedOptions;
      if (typeof a.replayCount === 'number') communicationReplayCounts[a.questionId] = a.replayCount;
      if (typeof a.retakeCount === 'number') communicationRetakeCounts[a.questionId] = a.retakeCount;
      if (a.audioAssetId) communicationAudioAnswers[a.questionId] = { audioAssetId: a.audioAssetId };
    });

    return { mcqAnswers, codingAnswers, behavioralAnswers, communicationAnswers, communicationSelectedAnswers, communicationReplayCounts, communicationRetakeCounts, communicationAudioAnswers };
  })
}));
