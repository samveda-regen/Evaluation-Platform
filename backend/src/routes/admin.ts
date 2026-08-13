import { Router, type Response } from 'express';
import multer from 'multer';
import { adminAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';
import {
  handleValidationErrors,
  adminLoginValidation,
  adminRegisterValidation,
  updateAdminCompanyValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  createTestValidation,
  updateTestValidation,
  createMCQValidation,
  createCodingValidation,
  paginationValidation
} from '../middleware/validation.js';
import {
  registerAdmin,
  loginAdmin,
  getAdminProfile,
  updateAdminProfile,
  updateAdminCompany,
  changeAdminPassword,
  forgotPassword,
  resetPassword
} from '../controllers/adminAuth.js';
import {
  createTest,
  createAdminPreviewAttempt,
  createTestSection,
  deleteTestSection,
  getTests,
  getTestById,
  updateTest,
  deleteTest,
  addQuestionToTest,
  addCustomQuestionToTest,
  removeQuestionFromTest,
  reorderTestQuestions,
  getEmailTemplates,
  updateEmailTemplates,
} from '../controllers/test.js';
import {
  createMCQQuestion,
  getMCQQuestions,
  deleteMCQQuestion
} from '../controllers/mcqQuestion.js';
import {
  createCodingQuestion,
  getCodingQuestions,
  getCodingQuestionById,
  deleteCodingQuestion
} from '../controllers/codingQuestion.js';
import { getBehavioralQuestions } from '../controllers/behavioralQuestion.js';
import {
  getTestResults,
  getAttemptDetails,
  flagAttempt,
  reviewAttempt,
  releaseAttemptResult,
  sendAttemptResultEmail,
  gradeBehavioralAnswer,
  autoGradeBehavioralAnswer,
  deleteAttempt,
  reEvaluateAttempt,
  exportResults,
  getDashboardStats,
  getRecentCompletedAttempts,
  getAllAttempts
} from '../controllers/results.js';
import { getTrustReports, reEvaluateTrustReport } from '../controllers/trustReports.js';
import {
  analyzeJob,
  generateTest,
  createTestFromAgent,
  suggestTags,
  suggestQuestions,
  getLibrarySkills
} from '../controllers/testAgent.js';
import {
  sendTestInvitations,
  getInvitationDashboard,
  getTestInvitationDashboard,
  deleteTestInvitationCandidate
} from '../controllers/invitation.js';

import {
  getRepositoryQuestions,
  toggleRepositoryQuestion,
  deleteRepositoryQuestion,
  createCustomMCQ,
  createCustomCoding,
  createCustomBehavioral,
  updateCustomMCQ,
  updateCustomCoding,
  updateCustomBehavioral,
  updateQuestionBankMCQ,
  updateQuestionBankCoding,
  updateQuestionBankBehavioral
} from '../controllers/repository.js';
import {
  getNotifications,
  markAllRead,
  clearAllNotifications,
  deleteOneNotification,
} from '../controllers/notifications.js';
const router = Router();
const invitationUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

// Auth routes
router.post('/register', adminRegisterValidation, handleValidationErrors, registerAdmin);
router.post('/login', adminLoginValidation, handleValidationErrors, loginAdmin);
router.post('/forgot-password', forgotPasswordValidation, handleValidationErrors, forgotPassword);
router.post('/reset-password', resetPasswordValidation, handleValidationErrors, resetPassword);
router.get('/profile', adminAuth, getAdminProfile);
router.put('/profile', adminAuth, updateAdminProfile);
router.put('/profile/company', adminAuth, updateAdminCompanyValidation, handleValidationErrors, updateAdminCompany);
router.put('/change-password', adminAuth, changeAdminPassword);

// Dashboard
router.get('/dashboard', adminAuth, getDashboardStats);
router.get('/attempts/completed/recent', adminAuth, getRecentCompletedAttempts);
router.get('/invitations/dashboard', adminAuth, getInvitationDashboard);

// Test routes
router.post('/tests', adminAuth, createTestValidation, handleValidationErrors, createTest);
router.get('/tests', adminAuth, paginationValidation, handleValidationErrors, getTests);
router.get('/tests/:testId', adminAuth, getTestById);
router.put('/tests/:testId', adminAuth, updateTestValidation, handleValidationErrors, updateTest);
router.delete('/tests/:testId', adminAuth, deleteTest);
router.post('/tests/:testId/try', adminAuth, createAdminPreviewAttempt);
router.post('/tests/:testId/send-invitations', adminAuth, invitationUpload.single('file'), sendTestInvitations);
router.get('/tests/:testId/invitations', adminAuth, getTestInvitationDashboard);
router.delete('/tests/:testId/invitations/:invitationId', adminAuth, deleteTestInvitationCandidate);
router.post('/tests/:testId/sections', adminAuth, createTestSection);
router.delete('/tests/:testId/sections/:sectionId', adminAuth, deleteTestSection);

// Email templates
router.get('/tests/:testId/email-templates', adminAuth, getEmailTemplates);
router.put('/tests/:testId/email-templates', adminAuth, updateEmailTemplates);

// Test questions management
router.post('/tests/:testId/questions', adminAuth, addQuestionToTest);
router.post('/tests/:testId/questions/custom', adminAuth, addCustomQuestionToTest);
router.delete('/tests/:testId/questions/:questionId', adminAuth, removeQuestionFromTest);
router.put('/tests/:testId/questions/reorder', adminAuth, reorderTestQuestions);

// MCQ routes
router.post('/mcq', adminAuth, createMCQValidation, handleValidationErrors, createMCQQuestion);
router.get('/mcq', adminAuth, paginationValidation, handleValidationErrors, getMCQQuestions);
router.delete('/mcq/:questionId', adminAuth, deleteMCQQuestion);

// Coding question routes
router.post('/coding', adminAuth, createCodingValidation, handleValidationErrors, createCodingQuestion);
router.get('/coding', adminAuth, paginationValidation, handleValidationErrors, getCodingQuestions);
router.get('/coding/:questionId', adminAuth, getCodingQuestionById);
router.delete('/coding/:questionId', adminAuth, deleteCodingQuestion);

// Behavioral question routes
router.get('/behavioral', adminAuth, paginationValidation, handleValidationErrors, getBehavioralQuestions);

// Results routes
router.get('/attempts', adminAuth, getAllAttempts);
router.get('/tests/:testId/results', adminAuth, paginationValidation, handleValidationErrors, getTestResults);
router.get('/attempts/:attemptId', adminAuth, getAttemptDetails);
router.post('/attempts/:attemptId/flag', adminAuth, flagAttempt);
router.post('/attempts/:attemptId/review', adminAuth, reviewAttempt);
router.post('/attempts/:attemptId/release', adminAuth, releaseAttemptResult);
router.post('/attempts/:attemptId/send-result-email', adminAuth, sendAttemptResultEmail);
router.post('/attempts/:attemptId/behavioral/:questionId/grade', adminAuth, gradeBehavioralAnswer);
router.post('/attempts/:attemptId/behavioral/:questionId/auto-grade', adminAuth, autoGradeBehavioralAnswer);
router.delete('/attempts/:attemptId', adminAuth, deleteAttempt);
router.post('/attempts/:attemptId/reevaluate', adminAuth, reEvaluateAttempt);
router.get('/tests/:testId/export', adminAuth, exportResults);
router.get('/trust-reports', adminAuth, getTrustReports);
router.post('/attempts/:attemptId/trust-report/reevaluate', adminAuth, reEvaluateTrustReport);

// Agent routes - AI-powered test generation
router.get('/agent/library-skills', adminAuth, getLibrarySkills);
router.post('/agent/analyze-job', adminAuth, analyzeJob);
router.post('/agent/generate-test', adminAuth, generateTest);
router.post('/agent/create-test', adminAuth, createTestFromAgent);
router.post('/agent/suggest-tags', adminAuth, suggestTags);
router.post('/agent/suggest-questions', adminAuth, suggestQuestions);

// ==============================
// Questions Repository Routes
// ==============================

// Library (READ ONLY except enable/disable)
router.get(
  '/repository/question-bank',
  adminAuth,
  paginationValidation,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    req.query.source = 'QUESTION_BANK';
    return getRepositoryQuestions(req, res);
  }
);

router.put('/repository/question-bank/:questionId/enable', adminAuth, async (req, res) => {
  return toggleRepositoryQuestion(req, res, true);
});

router.put('/repository/question-bank/:questionId/disable', adminAuth, async (req, res) => {
  return toggleRepositoryQuestion(req, res, false);
});

router.put('/repository/question-bank/mcq/:questionId', adminAuth, updateQuestionBankMCQ);
router.put('/repository/question-bank/coding/:questionId', adminAuth, updateQuestionBankCoding);
router.put('/repository/question-bank/behavioral/:questionId', adminAuth, updateQuestionBankBehavioral);

// Custom Questions (create/enable/disable/delete)
router.get(
  '/repository/custom',
  adminAuth,
  paginationValidation,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    req.query.source = 'CUSTOM';
    return getRepositoryQuestions(req, res);
  }
);

router.post('/repository/custom/mcq', adminAuth, createMCQValidation, handleValidationErrors, createCustomMCQ);
router.post('/repository/custom/coding', adminAuth, createCodingValidation, handleValidationErrors, createCustomCoding);
router.post('/repository/custom/behavioral', adminAuth, createCustomBehavioral);
router.put('/repository/custom/mcq/:questionId', adminAuth, updateCustomMCQ);
router.put('/repository/custom/coding/:questionId', adminAuth, updateCustomCoding);
router.put('/repository/custom/behavioral/:questionId', adminAuth, updateCustomBehavioral);
router.put('/repository/custom/:questionId/enable', adminAuth, async (req, res) => {
  return toggleRepositoryQuestion(req, res, true);
});
router.put('/repository/custom/:questionId/disable', adminAuth, async (req, res) => {
  return toggleRepositoryQuestion(req, res, false);
});

router.delete('/repository/custom/:questionId', adminAuth, deleteRepositoryQuestion);

// Notifications
router.get('/notifications', adminAuth, getNotifications);
router.post('/notifications/read-all', adminAuth, markAllRead);
router.delete('/notifications', adminAuth, clearAllNotifications);
router.delete('/notifications/:id', adminAuth, deleteOneNotification);

export default router;
