import { Router } from 'express';

import { integrationAuth, requireIntegrationScopes } from '../middleware/auth.js';
import {
  exchangeRecruiterToken,
  refreshIntegrationToken,
  getCompanyTests,
  inviteCandidatesFromIntegration,
  getTestCandidateResultsForIntegration,
  createTestWithAIAndInvite,
} from '../controllers/integration.js';

const router = Router();

router.post('/auth/exchange', exchangeRecruiterToken);
router.post('/auth/refresh', refreshIntegrationToken);

router.get('/tests', integrationAuth, requireIntegrationScopes(['tests:read']), getCompanyTests);
router.post('/tests/create-with-ai', integrationAuth, requireIntegrationScopes(['invites:write']), createTestWithAIAndInvite);
router.post('/tests/:testId/invitations', integrationAuth, requireIntegrationScopes(['invites:write']), inviteCandidatesFromIntegration);
router.get('/tests/:testId/results', integrationAuth, requireIntegrationScopes(['results:read']), getTestCandidateResultsForIntegration);

export default router;
