import { Router } from 'express';

import { integrationAuth, integrationApiKeyAuth, requireIntegrationScopes } from '../middleware/auth.js';
import {
  exchangeRecruiterToken,
  refreshIntegrationToken,
  getCompanyTests,
  inviteCandidatesFromIntegration,
  getTestCandidateResultsForIntegration,
  createTestWithAIAndInvite,
} from '../controllers/integration.js';
import { registerAdminFromIntegration } from '../controllers/adminAuth.js';
import {
  handleValidationErrors,
  integrationAdminRegisterValidation,
} from '../middleware/validation.js';

const router = Router();

// Recruiter app account provisioning
router.post('/admin/register', integrationApiKeyAuth, integrationAdminRegisterValidation, handleValidationErrors, registerAdminFromIntegration);

router.post('/auth/exchange', exchangeRecruiterToken);
router.post('/auth/refresh', refreshIntegrationToken);

router.get('/tests', integrationAuth, requireIntegrationScopes(['tests:read']), getCompanyTests);
router.post('/tests/create-with-ai', integrationAuth, requireIntegrationScopes(['invites:write']), createTestWithAIAndInvite);
router.post('/tests/:testId/invitations', integrationAuth, requireIntegrationScopes(['invites:write']), inviteCandidatesFromIntegration);
router.get('/tests/:testId/results', integrationAuth, requireIntegrationScopes(['results:read']), getTestCandidateResultsForIntegration);

export default router;
