import { Router, type Response } from 'express';
import multer from 'multer';
import { adminAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';
import {
  handleValidationErrors,
  adminLoginValidation,
  adminRegisterValidation,
  createTestValidation,
  updateTestValidation,
  createMCQValidation,
  createCodingValidation,
  paginationValidation,
  invitationPreviewValidation
} from '../middleware/validation.js';
import { registerAdmin, loginAdmin, getAdminProfile } from '../controllers/adminAuth.js';
import {
  createTest,
  createTestSection,
  deleteTestSection,
  getTests,
  getTestById,
  updateTest,
  deleteTest,
  addQuestionToTest,
  addCustomQuestionToTest,
  removeQuestionFromTest,
  reorderTestQuestions
} from '../controllers/test.js';
import {
  createMCQQuestion,
  getMCQQuestions,
  deleteMCQQuestion
} from '../controllers/mcqQuestion.js';
import {
  createCodingQuestion,
  getCodingQuestions,
  deleteCodingQuestion
} from '../controllers/codingQuestion.js';
import { getBehavioralQuestions } from '../controllers/behavioralQuestion.js';
import {
  getTestResults,
  getAttemptDetails,
  flagAttempt,
  deleteAttempt,
  reEvaluateAttempt,
  exportResults,
  getDashboardStats
} from '../controllers/results.js';
import { getTrustReports, reEvaluateTrustReport } from '../controllers/trustReports.js';
import {
  analyzeJob,
  generateTest,
  createTestFromAgent,
  suggestTags
} from '../controllers/testAgent.js';
import { sendTestInvitations, getInvitationDashboard, getTestInvitationDashboard, sendInvitationPreview } from '../controllers/invitation.js';

import {
  getRepositoryQuestions,
  toggleRepositoryQuestion,
  deleteRepositoryQuestion,
  createCustomMCQ,
  createCustomCoding,
  createCustomBehavioral
} from '../controllers/repository.js';
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
router.get('/profile', adminAuth, getAdminProfile);

// Dashboard
router.get('/dashboard', adminAuth, getDashboardStats);
router.get('/invitations/dashboard', adminAuth, getInvitationDashboard);

// Test routes
router.post('/tests', adminAuth, createTestValidation, handleValidationErrors, createTest);
router.get('/tests', adminAuth, paginationValidation, handleValidationErrors, getTests);
router.get('/tests/:testId', adminAuth, getTestById);
router.put('/tests/:testId', adminAuth, updateTestValidation, handleValidationErrors, updateTest);
router.delete('/tests/:testId', adminAuth, deleteTest);
router.post('/tests/:testId/send-invitations', adminAuth, invitationUpload.single('file'), sendTestInvitations);
router.post(
  '/tests/:testId/send-test-email',
  adminAuth,
  invitationPreviewValidation,
  handleValidationErrors,
  sendInvitationPreview
);
router.get('/tests/:testId/invitations', adminAuth, getTestInvitationDashboard);
router.post('/tests/:testId/sections', adminAuth, createTestSection);
router.delete('/tests/:testId/sections/:sectionId', adminAuth, deleteTestSection);

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
router.delete('/coding/:questionId', adminAuth, deleteCodingQuestion);

// Behavioral question routes
router.get('/behavioral', adminAuth, paginationValidation, handleValidationErrors, getBehavioralQuestions);

// Results routes
router.get('/tests/:testId/results', adminAuth, paginationValidation, handleValidationErrors, getTestResults);
router.get('/attempts/:attemptId', adminAuth, getAttemptDetails);
router.post('/attempts/:attemptId/flag', adminAuth, flagAttempt);
router.delete('/attempts/:attemptId', adminAuth, deleteAttempt);
router.post('/attempts/:attemptId/reevaluate', adminAuth, reEvaluateAttempt);
router.get('/tests/:testId/export', adminAuth, exportResults);
router.get('/trust-reports', adminAuth, getTrustReports);
router.post('/attempts/:attemptId/trust-report/reevaluate', adminAuth, reEvaluateTrustReport);

// Agent routes - AI-powered test generation
router.post('/agent/analyze-job', adminAuth, analyzeJob);
router.post('/agent/generate-test', adminAuth, generateTest);
router.post('/agent/create-test', adminAuth, createTestFromAgent);
router.post('/agent/suggest-tags', adminAuth, suggestTags);

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
router.put('/repository/custom/:questionId/enable', adminAuth, async (req, res) => {
  return toggleRepositoryQuestion(req, res, true);
});
router.put('/repository/custom/:questionId/disable', adminAuth, async (req, res) => {
  return toggleRepositoryQuestion(req, res, false);
});

router.delete('/repository/custom/:questionId', adminAuth, deleteRepositoryQuestion);

export default router;
