import axios, { AxiosError } from 'axios';
import { toast } from 'react-hot-toast';
import { useAuthStore, getAdminToken } from '../context/authStore';
import type {
  RepositoryCategory,
  RepositoryListResponse,
  RepositoryQueryParams,
  SubmissionResult
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

  const adminToken = getAdminToken();
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

// Admin endpoints that are called without an existing session - a 401 here
// means bad credentials/an invalid link, not an expired session.
const ADMIN_PUBLIC_AUTH_PATHS = ['/admin/login', '/admin/register', '/admin/forgot-password', '/admin/reset-password'];

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error: string }>) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      const isAdminRoute =
        url.startsWith('/admin') ||
        url.startsWith('/analytics') ||
        url.startsWith('/media') ||
        url.startsWith('/files/admin') ||
        url.startsWith('/proctoring/admin') ||
        url.startsWith('/verification/admin');
      const isPublicAdminAuthRoute = ADMIN_PUBLIC_AUTH_PATHS.some((path) => url.startsWith(path));
      const hadAdminToken = !!getAdminToken();

      if (isAdminRoute && !isPublicAdminAuthRoute && hadAdminToken) {
        // The admin's token was rejected on a route that requires one - either
        // the 2h session timeout elapsed or the token is otherwise invalid.
        useAuthStore.getState().logoutAdmin();
        if (typeof window !== 'undefined' && window.location.pathname !== '/admin/login') {
          toast.error('Your session has expired. Please log in again.');
          window.location.href = '/admin/login';
        }
      } else {
        // Not an authenticated-session case (e.g. a failed login attempt) -
        // just clear any stale tokens and let the caller handle its own error.
        useAuthStore.getState().logoutAdmin();
        useAuthStore.getState().logoutCandidate();
      }
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
  register: (data: { email: string; password: string; name: string; companyName?: string; companyId?: string }) =>
    api.post('/admin/register', data),

  login: (data: { email: string; password: string }) =>
    api.post('/admin/login', data),

  forgotPassword: (data: { email: string }) =>
    api.post('/admin/forgot-password', data),

  resetPassword: (data: { token: string; newPassword: string }) =>
    api.post('/admin/reset-password', data),

  getProfile: () =>
    api.get('/admin/profile'),

  updateProfile: (data: { name: string }) =>
    api.put('/admin/profile', data),

  updateCompany: (data: { companyName: string; companyId: string }) =>
    api.put('/admin/profile/company', data),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put('/admin/change-password', data),

  getDashboard: () =>
    api.get('/admin/dashboard'),

  getRecentCompletedAttempts: (limit = 20) =>
    api.get(`/admin/attempts/completed/recent?limit=${limit}`),

  getAllAttempts: (params: { testId?: string; status?: string; reviewed?: string; search?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.testId)  q.set('testId',  params.testId);
    if (params.status)  q.set('status',  params.status);
    if (params.reviewed) q.set('reviewed', params.reviewed);
    if (params.search)  q.set('search',  params.search);
    if (params.page)    q.set('page',    String(params.page));
    if (params.limit)   q.set('limit',   String(params.limit));
    return api.get(`/admin/attempts?${q.toString()}`);
  },

  // Persistent notifications
  getNotifications: () => api.get('/admin/notifications'),
  markAllNotificationsRead: () => api.post('/admin/notifications/read-all', {}),
  clearAllNotifications: () => api.delete('/admin/notifications'),
  deleteNotification: (id: string) => api.delete(`/admin/notifications/${id}`),

  getInvitationDashboard: () =>
    api.get('/admin/invitations/dashboard'),

  // Tests
  createTest: (data: Record<string, unknown>) =>
    api.post('/admin/tests', data),

  getTests: (page = 1, limit = 10, search = '') => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });

    if (search.trim()) {
      params.set('search', search.trim());
    }

    return api.get(`/admin/tests?${params.toString()}`);
  },

  getTest: (testId: string) =>
    api.get(`/admin/tests/${testId}`),

  updateTest: (testId: string, data: Record<string, unknown>) =>
    api.put(`/admin/tests/${testId}`, data),

  deleteTest: (testId: string) =>
    api.delete(`/admin/tests/${testId}`),

  tryTest: (testId: string) =>
    api.post(`/admin/tests/${testId}/try`),

  sendInvitations: (testId: string, data: FormData) =>
    api.post(`/admin/tests/${testId}/send-invitations`, data),

  getTestInvitations: (testId: string) =>
    api.get(`/admin/tests/${testId}/invitations`),

  deleteTestInvitation: (testId: string, invitationId: string) =>
    api.delete(`/admin/tests/${testId}/invitations/${invitationId}`),

  resendTestInvitation: (testId: string, invitationId: string) =>
    api.post(`/admin/tests/${testId}/invitations/${invitationId}/resend`),

  addQuestionToTest: (testId: string, data: { questionId: string; questionType: string; orderIndex?: number }) =>
    api.post(`/admin/tests/${testId}/questions`, data),

  addCustomQuestionToTest: (testId: string, data: Record<string, unknown>) =>
    api.post(`/admin/tests/${testId}/questions/custom`, data),

  removeQuestionFromTest: (testId: string, questionId: string) =>
    api.delete(`/admin/tests/${testId}/questions/${questionId}`),

  getEmailTemplates: (testId: string) =>
    api.get(`/admin/tests/${testId}/email-templates`),

  updateEmailTemplates: (testId: string, data: {
    inviteEmailSubject?: string;
    inviteEmailBody?: string;
    confirmEmailSubject?: string;
    confirmEmailBody?: string;
    reminderEmailSubject?: string;
    reminderEmailBody?: string;
    reminderHoursBeforeClose?: number;
  }) => api.put(`/admin/tests/${testId}/email-templates`, data),

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

  getCodingById: (questionId: string) =>
    api.get(`/admin/coding/${questionId}`),

  // Behavioral Questions
  getBehaviorals: (page = 1, limit = 20, search = '') =>
    api.get(`/admin/behavioral?page=${page}&limit=${limit}${search ? `&search=${search}` : ''}`),

  // Communication Questions (Written / Listening / Reading / Speaking)
  createCommunication: (data: Record<string, unknown>) =>
    api.post('/admin/communication', data),

  getCommunications: (page = 1, limit = 20, search = '', subType = '') =>
    api.get(`/admin/communication?page=${page}&limit=${limit}${search ? `&search=${search}` : ''}${subType ? `&subType=${subType}` : ''}`),

  getCommunicationById: (questionId: string) =>
    api.get(`/admin/communication/${questionId}`),

  deleteCommunication: (questionId: string) =>
    api.delete(`/admin/communication/${questionId}`),

  createReadingPassage: (data: { title: string; passageText: string }) =>
    api.post('/admin/communication/reading-passages', data),

  getReadingPassages: (search = '') =>
    api.get(`/admin/communication/reading-passages${search ? `?search=${search}` : ''}`),

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

  createCustomCommunication: (data: Record<string, unknown>) =>
    api.post('/admin/repository/custom/communication', data),

  updateCustomCommunication: (questionId: string, data: Record<string, unknown>) =>
    api.put(`/admin/repository/custom/communication/${questionId}`, data),

  updateQuestionBankCommunication: (questionId: string, data: Record<string, unknown>) =>
    api.put(`/admin/repository/question-bank/communication/${questionId}`, data),

  updateCustomMCQ: (questionId: string, data: {
    questionText?: string;
    options?: string[];
    correctAnswers?: number[];
    isMultipleChoice?: boolean;
    marks?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    tags?: string[];
    explanation?: string;
  }) => api.put(`/admin/repository/custom/mcq/${questionId}`, data),

  updateCustomCoding: (questionId: string, data: {
    title?: string;
    description?: string;
    inputFormat?: string;
    outputFormat?: string;
    sampleInput?: string;
    sampleOutput?: string;
    constraints?: string;
    marks?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    tags?: string[];
    supportedLanguages?: string[];
    codeTemplates?: Record<string, string>;
    timeLimit?: number;
    memoryLimit?: number;
    partialScoring?: boolean;
  }) => api.put(`/admin/repository/custom/coding/${questionId}`, data),

  updateCustomBehavioral: (questionId: string, data: {
    title?: string;
    description?: string;
    expectedAnswer?: string;
    marks?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    tags?: string[];
  }) => api.put(`/admin/repository/custom/behavioral/${questionId}`, data),

  updateQuestionBankMCQ: (questionId: string, data: {
    questionText?: string;
    options?: string[];
    correctAnswers?: number[];
    isMultipleChoice?: boolean;
    marks?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    tags?: string[];
    explanation?: string;
  }) => api.put(`/admin/repository/question-bank/mcq/${questionId}`, data),

  updateQuestionBankCoding: (questionId: string, data: {
    title?: string;
    description?: string;
    inputFormat?: string;
    outputFormat?: string;
    sampleInput?: string;
    sampleOutput?: string;
    constraints?: string;
    marks?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    tags?: string[];
    supportedLanguages?: string[];
    codeTemplates?: Record<string, string>;
    timeLimit?: number;
    memoryLimit?: number;
    partialScoring?: boolean;
  }) => api.put(`/admin/repository/question-bank/coding/${questionId}`, data),

  updateQuestionBankBehavioral: (questionId: string, data: {
    title?: string;
    description?: string;
    expectedAnswer?: string;
    marks?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    tags?: string[];
  }) => api.put(`/admin/repository/question-bank/behavioral/${questionId}`, data),

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

  reviewAttempt: (attemptId: string, data: { reviewed: boolean; reviewNotes?: string }) =>
    api.post(`/admin/attempts/${attemptId}/review`, data),

  releaseAttemptResult: (attemptId: string) =>
    api.post(`/admin/attempts/${attemptId}/release`),

  sendAttemptResultEmail: (attemptId: string) =>
    api.post(`/admin/attempts/${attemptId}/send-result-email`),

  gradeBehavioralAnswer: (attemptId: string, questionId: string, marksObtained: number) =>
    api.post<{ message: string; questionId: string; marksObtained: number; score: number }>(
      `/admin/attempts/${attemptId}/behavioral/${questionId}/grade`,
      { marksObtained }
    ),

  autoGradeBehavioralAnswer: (attemptId: string, questionId: string) =>
    api.post<{ questionId: string; marksObtained: number; maxMarks: number; reasoning: string; score: number }>(
      `/admin/attempts/${attemptId}/behavioral/${questionId}/auto-grade`
    ),

  gradeCommunicationAnswer: (attemptId: string, questionId: string, marksObtained: number) =>
    api.post<{ message: string; questionId: string; marksObtained: number; score: number }>(
      `/admin/attempts/${attemptId}/communication/${questionId}/grade`,
      { marksObtained }
    ),

  autoGradeCommunicationAnswer: (attemptId: string, questionId: string) =>
    api.post<{ questionId: string; marksObtained: number; maxMarks: number; reasoning: string; score: number }>(
      `/admin/attempts/${attemptId}/communication/${questionId}/auto-grade`
    ),

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

  forceSubmitAttempt: (attemptId: string) =>
    api.post(`/admin/attempts/${attemptId}/force-submit`),

  // Agent API - AI-powered test generation
  analyzeJob: (jobTitle: string, jobDescription?: string, experience?: string) =>
    api.post('/admin/agent/analyze-job', { jobTitle, jobDescription, experience }),

  getLibrarySkills: () =>
    api.get('/admin/agent/library-skills'),

  generateTest: (data: {
    jobProfile: { title: string; experience: string; description?: string };
    skills: string[];
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
    mcqCount: number;
    codingCount: number;
    behavioralCount: number;
    writtenCount?: number;
    readingCount?: number;
    speakingCount?: number;
    duration?: number;
  }) => api.post('/admin/agent/generate-test', data),

  createTestFromAgent: (data: {
    selection: {
      mcqQuestionIds: string[];
      codingQuestionIds: string[];
      behavioralQuestionIds: string[];
      writtenQuestionIds?: string[];
      readingQuestionIds?: string[];
      speakingQuestionIds?: string[];
      reasoning?: string;
      suggestedDuration?: number;
      suggestedTestName?: string;
      suggestedDescription?: string;
    };
    testSettings: Record<string, unknown>;
  }) => api.post('/admin/agent/create-test', data),

  suggestTags: (questionText: string, questionType: 'mcq' | 'coding') =>
    api.post('/admin/agent/suggest-tags', { questionText, questionType }),

  suggestNewQuestions: (data: {
    jobProfile: { title: string; experience: string; description?: string };
    skills: string[];
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
    mcqCount: number;
    codingCount: number;
    behavioralCount: number;
    writtenCount?: number;
    readingCount?: number;
    speakingCount?: number;
  }) => api.post('/admin/agent/suggest-questions', data),

  getAgentReviewDetails: (data: {
    mcqQuestionIds: string[];
    codingQuestionIds: string[];
    behavioralQuestionIds: string[];
    writtenQuestionIds?: string[];
    readingQuestionIds?: string[];
    speakingQuestionIds?: string[];
  }) => api.post('/admin/agent/review-details', data),

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

  deleteVerificationImages: (candidateId: string) =>
    api.delete(`/verification/admin/${candidateId}/images`),

  deleteVerificationRecord: (candidateId: string) =>
    api.delete(`/verification/admin/${candidateId}`),

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

  assignMediaToQuestion: (questionId: string, assetIds: string[], questionType?: 'mcq' | 'communication') =>
    api.post(`/media/question/${questionId}/assign`, { assetIds, questionType }),

  getQuestionMedia: (questionId: string) =>
    api.get<{ success: boolean; assets: Array<{ id: string; filename: string; originalName: string; mimeType: string; fileSize: number; storageUrl: string; mediaType: string; width?: number; height?: number; duration?: number; thumbnailUrl?: string }> }>(`/media/question/${questionId}`),

  removeMediaFromQuestion: (assetId: string) =>
    api.delete(`/media/${assetId}/unassign`),

  // Analytics - Admin
  getDashboardStats: () =>
    api.get('/analytics/dashboard'),

  getAdminAnalyticsOverview: (period: '7d' | '30d' | '90d' = '30d') =>
    api.get(`/analytics/admin/overview?period=${period}`),

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

  loginWithInvitation: (data: { token: string } | { accessCode: string; email: string }) =>
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

  saveCommunicationAnswer: (data: { questionId: string; answerText?: string; selectedOptions?: number[]; replayCount?: number; retakeCount?: number; audio?: string; audioMimeType?: string }) =>
    api.post('/candidate/answer/communication', data),

  runCode: (data: { questionId: string; code: string; language: string; input?: string }) =>
    api.post('/candidate/code/run', data),

  logActivity: (data: { eventType: string; eventData?: Record<string, unknown> }) =>
    api.post('/candidate/activity', data),

  heartbeat: () =>
    api.post('/candidate/heartbeat'),

  submitTest: (data: { autoSubmit?: boolean }) =>
    api.post<SubmissionResult>('/candidate/test/submit', data),

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
    api.post('/verification/face-reference', { imageData }),

  cancelMyPendingVerification: () =>
    api.delete('/verification/my-submission'),
};

export default api;
