import axios, { AxiosError } from 'axios';
import type {
  RepositoryCategory,
  RepositoryListResponse,
  RepositoryQueryParams
} from '../types';

const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env || {};

const isLocalBrowser =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const apiBaseUrlFromEnv =
  typeof viteEnv.VITE_API_BASE_URL === 'string' ? viteEnv.VITE_API_BASE_URL : '';
const isDevMode = Boolean(viteEnv.DEV);

const resolvedApiBaseUrl =
  apiBaseUrlFromEnv ||
  (isDevMode ? '/api' : isLocalBrowser ? 'http://localhost:3000/api' : '/api');

const api = axios.create({
  baseURL: resolvedApiBaseUrl
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData && config.headers) {
    const headers = config.headers as unknown as {
      set?: (name: string, value: string | undefined) => void;
      [key: string]: unknown;
    };

    if (typeof headers.set === 'function') {
      headers.set('Content-Type', undefined);
    } else {
      delete headers['Content-Type'];
      delete headers['content-type'];
    }
  }

  const adminToken = localStorage.getItem('adminToken');
  const candidateToken = localStorage.getItem('candidateToken');

  const url = config.url || '';
  const isAdminRoute =
    url.startsWith('/admin') ||
    url.startsWith('/analytics') ||
    url.startsWith('/media') ||
    url.startsWith('/files/admin') ||
    url.startsWith('/proctoring/admin') ||
    url.startsWith('/verification/admin');

  const token = isAdminRoute ? adminToken : candidateToken;

  if (token) {
    const headers = config.headers as unknown as {
      set?: (name: string, value: string) => void;
      Authorization?: string;
    };

    if (typeof headers?.set === 'function') {
      headers.set('Authorization', `Bearer ${token}`);
    } else if (headers) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error: string }>) => {
    if (error.response?.status === 401) {
      // Clear tokens and redirect to login
      localStorage.removeItem('adminToken');
      localStorage.removeItem('candidateToken');
    }
    return Promise.reject(error);
  }
);

const buildRepositoryQuery = (params: RepositoryQueryParams) => {
  const query = new URLSearchParams();
  query.set('category', params.category);
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));

  if (params.search?.trim()) {
    query.set('search', params.search.trim());
  }
  if (params.difficulty) {
    query.set('difficulty', params.difficulty);
  }
  if (params.topic?.trim()) {
    query.set('topic', params.topic.trim());
  }
  if (params.tag?.trim()) {
    query.set('tag', params.tag.trim());
  }
  if (params.enabled !== undefined) {
    query.set('enabled', String(params.enabled));
  }

  return query.toString();
};

// Admin API
export const adminApi = {
  register: (data: { email: string; password: string; name: string }) =>
    api.post('/admin/register', data),

  login: (data: { email: string; password: string }) =>
    api.post('/admin/login', data),

  getProfile: () =>
    api.get('/admin/profile'),

  getDashboard: () =>
    api.get('/admin/dashboard'),

  getInvitationDashboard: () =>
    api.get('/admin/invitations/dashboard'),

  // Tests
  createTest: (data: Record<string, unknown>) =>
    api.post('/admin/tests', data),

  getTests: (page = 1, limit = 10) =>
    api.get(`/admin/tests?page=${page}&limit=${limit}`),

  getTest: (testId: string) =>
    api.get(`/admin/tests/${testId}`),

  updateTest: (testId: string, data: Record<string, unknown>) =>
    api.put(`/admin/tests/${testId}`, data),

  deleteTest: (testId: string) =>
    api.delete(`/admin/tests/${testId}`),

  sendInvitations: (testId: string, data: FormData) =>
    api.post(`/admin/tests/${testId}/send-invitations`, data),

  getTestInvitations: (testId: string) =>
    api.get(`/admin/tests/${testId}/invitations`),

  deleteTestInvitation: (testId: string, invitationId: string) =>
    api.delete(`/admin/tests/${testId}/invitations/${invitationId}`),

  addQuestionToTest: (testId: string, data: { questionId: string; questionType: string; orderIndex?: number; sectionId?: string | null }) =>
    api.post(`/admin/tests/${testId}/questions`, data),

  addCustomQuestionToTest: (testId: string, data: Record<string, unknown>) =>
    api.post(`/admin/tests/${testId}/questions/custom`, data),

  removeQuestionFromTest: (testId: string, questionId: string) =>
    api.delete(`/admin/tests/${testId}/questions/${questionId}`),

  createTestSection: (testId: string, data: { name: string; orderIndex?: number; questionsPerCandidate?: number }) =>
    api.post(`/admin/tests/${testId}/sections`, data),

  deleteTestSection: (testId: string, sectionId: string) =>
    api.delete(`/admin/tests/${testId}/sections/${sectionId}`),

  // MCQ Questions
  createMCQ: (data: Record<string, unknown>) =>
    api.post('/admin/mcq', data),

  getMCQs: (page = 1, limit = 20, search = '') =>
    api.get(`/admin/mcq?page=${page}&limit=${limit}${search ? `&search=${search}` : ''}`),

  // Coding Questions
  createCoding: (data: Record<string, unknown>) =>
    api.post('/admin/coding', data),

  getCodings: (page = 1, limit = 20, search = '') =>
    api.get(`/admin/coding?page=${page}&limit=${limit}${search ? `&search=${search}` : ''}`),

  // Behavioral Questions
  getBehaviorals: (page = 1, limit = 20, search = '') =>
    api.get(`/admin/behavioral?page=${page}&limit=${limit}${search ? `&search=${search}` : ''}`),

  // Question Repository
  getQuestionBankQuestions: (params: RepositoryQueryParams) =>
    api.get<RepositoryListResponse>(`/admin/repository/question-bank?${buildRepositoryQuery(params)}`),

  getCustomRepositoryQuestions: (params: RepositoryQueryParams) =>
    api.get<RepositoryListResponse>(`/admin/repository/custom?${buildRepositoryQuery(params)}`),

  enableQuestionBankQuestion: (questionId: string, category: RepositoryCategory) =>
    api.put(`/admin/repository/question-bank/${questionId}/enable?category=${category}`),

  disableQuestionBankQuestion: (questionId: string, category: RepositoryCategory) =>
    api.put(`/admin/repository/question-bank/${questionId}/disable?category=${category}`),

  createCustomBehavioral: (data: {
    title: string;
    description: string;
    expectedAnswer?: string;
    marks: number;
    difficulty: 'easy' | 'medium' | 'hard';
    topic?: string;
    tags?: string[];
  }) => api.post('/admin/repository/custom/behavioral', data),

  enableCustomRepositoryQuestion: (questionId: string, category: RepositoryCategory) =>
    api.put(`/admin/repository/custom/${questionId}/enable?category=${category}`),

  disableCustomRepositoryQuestion: (questionId: string, category: RepositoryCategory) =>
    api.put(`/admin/repository/custom/${questionId}/disable?category=${category}`),

  deleteRepositoryQuestion: (questionId: string, category: RepositoryCategory) =>
    api.delete(`/admin/repository/custom/${questionId}?category=${category}`),

  // Results
  getTestResults: (testId: string, page = 1, limit = 20, status = '', flagged = false) =>
    api.get(`/admin/tests/${testId}/results?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}${flagged ? '&flagged=true' : ''}`),

  getAttemptDetails: (attemptId: string) =>
    api.get(`/admin/attempts/${attemptId}`),

  flagAttempt: (attemptId: string, data: { isFlagged: boolean; reason?: string }) =>
    api.post(`/admin/attempts/${attemptId}/flag`, data),

  reEvaluateAttempt: (attemptId: string) =>
    api.post(`/admin/attempts/${attemptId}/reevaluate`),

  exportResults: (testId: string, format: 'csv' | 'json' = 'csv') =>
    api.get(`/admin/tests/${testId}/export?format=${format}`, { responseType: format === 'csv' ? 'blob' : 'json' }),

  // Trust reports - Admin
  getTrustReports: (params?: {
    testId?: string;
    search?: string;
    risk?: 'low' | 'medium' | 'high' | 'critical';
    flagged?: boolean;
    page?: number;
    limit?: number;
  }) => api.get('/admin/trust-reports', { params }),

  reEvaluateTrustReport: (attemptId: string) =>
    api.post(`/admin/attempts/${attemptId}/trust-report/reevaluate`),

  deleteAttempt: (attemptId: string) =>
    api.delete(`/admin/attempts/${attemptId}`),

  // Agent API - AI-powered test generation
  analyzeJob: (jobTitle: string, jobDescription?: string) =>
    api.post('/admin/agent/analyze-job', { jobTitle, jobDescription }),

  generateTest: (data: {
    jobProfile: { title: string; experience: string; description?: string };
    skills: string[];
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
    mcqCount: number;
    codingCount: number;
    duration?: number;
  }) => api.post('/admin/agent/generate-test', data),

  createTestFromAgent: (data: {
    selection: {
      mcqQuestionIds: string[];
      codingQuestionIds: string[];
      reasoning?: string;
      suggestedDuration?: number;
      suggestedTestName?: string;
      suggestedDescription?: string;
    };
    testSettings: Record<string, unknown>;
  }) => api.post('/admin/agent/create-test', data),

  suggestTags: (questionText: string, questionType: 'mcq' | 'coding') =>
    api.post('/admin/agent/suggest-tags', { questionText, questionType }),

  // Proctoring - Admin
  getProctoringSummary: (attemptId: string) =>
    api.get(`/proctoring/admin/attempt/${attemptId}/summary`),

  getLiveProctoringCandidates: (testId: string) =>
    api.get(`/proctoring/admin/test/${testId}/live`),

  getProctoringSession: (sessionId: string) =>
    api.get(`/proctoring/admin/session/${sessionId}`),

  getProctoringEvents: (sessionId: string, filters?: { severity?: string; reviewed?: boolean }) =>
    api.get(`/proctoring/admin/session/${sessionId}/events`, { params: filters }),

  getProctoringRecordings: (sessionId: string) =>
    api.get(`/proctoring/admin/session/${sessionId}/recordings`),

  reviewProctoringEvent: (eventId: string, data: { dismissed: boolean; reviewNotes?: string }) =>
    api.patch(`/proctoring/admin/event/${eventId}/review`, data),

  // Verification - Admin
  getVerificationList: (params?: { status?: string; page?: number; limit?: number }) =>
    api.get('/verification/admin/list', { params }),

  getVerificationDetails: (candidateId: string) =>
    api.get(`/verification/admin/${candidateId}`),

  approveVerification: (candidateId: string) =>
    api.post(`/verification/admin/${candidateId}/approve`),

  rejectVerification: (candidateId: string, reason: string) =>
    api.post(`/verification/admin/${candidateId}/reject`, { reason }),

  getVerificationStats: () =>
    api.get('/verification/admin/stats'),

  // ID Verification Data - Admin
  getIdVerificationDocuments: (params?: {
    search?: string;
    candidateName?: string;
    testCode?: string;
    documentType?: 'id_front' | 'id_back' | 'selfie' | 'face_reference';
  }) => api.get('/files/admin/id-documents', { params }),

  deleteIdVerificationDocument: (fileId: string) =>
    api.delete(`/files/admin/id-documents/${fileId}`),

  // Media - Admin
  getUploadUrl: (data: { filename: string; mimeType: string; fileSize: number; questionId?: string }) =>
    api.post('/media/upload-url', data),

  createMediaAsset: (data: Record<string, unknown>) =>
    api.post('/media/asset', data),

  uploadMedia: (data: { file: { data: string; mimeType: string; originalName: string }; questionId?: string }) =>
    api.post('/media/upload', data),

  deleteMedia: (assetId: string) =>
    api.delete(`/media/${assetId}`),

  assignMediaToQuestion: (questionId: string, assetIds: string[]) =>
    api.post(`/media/question/${questionId}/assign`, { assetIds }),

  // Analytics - Admin
  getDashboardStats: () =>
    api.get('/analytics/dashboard'),

  getAttemptAnalytics: (attemptId: string, regenerate = false) =>
    api.get(`/analytics/attempt/${attemptId}`, { params: { regenerate } }),

  getTestAnalytics: (testId: string, regenerate = false) =>
    api.get(`/analytics/test/${testId}`, { params: { regenerate } }),

  getPerformanceComparison: (testId: string, filters?: Record<string, unknown>) =>
    api.get(`/analytics/test/${testId}/comparison`, { params: filters }),

  getDifficultyAnalysis: (testId: string) =>
    api.get(`/analytics/test/${testId}/difficulty`),

  getTopicAnalysis: (testId: string) =>
    api.get(`/analytics/test/${testId}/topics`),

  getSkillAnalysis: (testId: string) =>
    api.get(`/analytics/test/${testId}/skills`),

  getLeaderboard: (testId: string, limit = 10) =>
    api.get(`/analytics/test/${testId}/leaderboard`, { params: { limit } }),

  regenerateAnalytics: (testId: string) =>
    api.post(`/analytics/test/${testId}/regenerate`)
};

// Candidate API
export const candidateApi = {
  login: (data: { email: string; password: string; invitationToken?: string; testCode?: string; name?: string; mode?: 'signup' | 'login' | 'auto' }) =>
    api.post('/candidate/login', data),

  loginWithInvitation: (data: { token: string }) =>
    api.post('/candidate/login/invitation', data),

  getInvitationDetails: (token: string) =>
    api.get(`/invitations/${token}`),

  getTestDetails: () =>
    api.get('/candidate/test'),

  startTest: () =>
    api.post('/candidate/test/start'),

  getSavedAnswers: () =>
    api.get('/candidate/test/answers'),

  saveMCQAnswer: (data: { questionId: string; selectedOptions: number[] }) =>
    api.post('/candidate/answer/mcq', data),

  saveCodingAnswer: (data: { questionId: string; code: string; language: string }) =>
    api.post('/candidate/answer/coding', data),

  saveBehavioralAnswer: (data: { questionId: string; answerText: string }) =>
    api.post('/candidate/answer/behavioral', data),

  runCode: (data: { questionId: string; code: string; language: string; input?: string }) =>
    api.post('/candidate/code/run', data),

  logActivity: (data: { eventType: string; eventData?: Record<string, unknown> }) =>
    api.post('/candidate/activity', data),

  submitTest: (data: { autoSubmit?: boolean }) =>
    api.post('/candidate/test/submit', data),

  // Verification - Candidate
  submitVerification: (data: {
    documentType: string;
    documentImageData: string;
    selfieImageData: string;
    livenessImages?: string[];
  }) => api.post('/verification/submit', data),

  getVerificationStatus: () =>
    api.get('/verification/status'),

  checkVerificationRequired: (testId: string) =>
    api.get(`/verification/required/${testId}`),

  uploadFaceReference: (imageData: string) =>
    api.post('/verification/face-reference', { imageData })
};

export default api;
