import { Router } from 'express';
import { candidateAuth } from '../middleware/auth.js';
import {
  handleValidationErrors,
  candidateLoginValidation,
  invitationLoginValidation,
  submitMCQAnswerValidation,
  submitCodingAnswerValidation,
  submitBehavioralAnswerValidation,
  activityLogValidation
} from '../middleware/validation.js';
import {
  candidateLogin,
  candidateInvitationLogin,
  getTestDetails,
  startTest,
  saveMCQAnswer,
  saveCodingAnswer,
  saveBehavioralAnswer,
  runCode,
  logActivity,
  submitTest,
  getSavedAnswers
} from '../controllers/candidate.js';

const router = Router();

// Auth
router.post('/login', candidateLoginValidation, handleValidationErrors, candidateLogin);
router.post('/login/invitation', invitationLoginValidation, handleValidationErrors, candidateInvitationLogin);

// Test routes (protected)
router.get('/test', candidateAuth, getTestDetails);
router.post('/test/start', candidateAuth, startTest);
router.get('/test/answers', candidateAuth, getSavedAnswers);

// Answer submission
router.post('/answer/mcq', candidateAuth, submitMCQAnswerValidation, handleValidationErrors, saveMCQAnswer);
router.post('/answer/coding', candidateAuth, submitCodingAnswerValidation, handleValidationErrors, saveCodingAnswer);
router.post('/answer/behavioral', candidateAuth, submitBehavioralAnswerValidation, handleValidationErrors, saveBehavioralAnswer);
router.post('/code/run', candidateAuth, runCode);

// Activity logging
router.post('/activity', candidateAuth, activityLogValidation, handleValidationErrors, logActivity);

// Submit test
router.post('/test/submit', candidateAuth, submitTest);

export default router;
