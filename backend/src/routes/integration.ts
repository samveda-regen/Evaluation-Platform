import { Router, Response, NextFunction } from 'express';

import { integrationAuth, integrationApiKeyAuth, requireIntegrationScopes } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { recordIntegrationAudit } from '../services/integrationAuditService.js';
import {
  exchangeRecruiterToken,
  refreshIntegrationToken,
  revokeIntegrationSessions,
  getCompanyTests,
  inviteCandidatesFromIntegration,
  createCandidateSessionFromIntegration,
  getTestCandidateResultsForIntegration,
  createTestWithAIAndInvite,
} from '../controllers/integration.js';
import { registerAdminFromIntegration } from '../controllers/adminAuth.js';
import {
  createIntegrationPartner,
  listIntegrationPartners,
  setIntegrationPartnerActive,
} from '../controllers/integrationPartners.js';
import {
  setCompanyWebhook,
  getCompanyWebhookStatus,
  clearCompanyWebhook,
} from '../controllers/companyWebhookConfig.js';
import {
  handleValidationErrors,
  integrationAdminRegisterValidation,
} from '../middleware/validation.js';

const router = Router();

// Fire-and-forget access log for every /api/integration call (who, what, from which
// company, and the resulting status code) — independent of any specific controller.
function auditIntegrationAccess(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    void recordIntegrationAudit({
      companyId: req.integration?.companyId,
      actorId: req.integration?.id ?? 'unauthenticated',
      actorEmail: req.integration?.email,
      action: `${req.method} ${req.route?.path ?? req.path}`,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
    });
  });
  next();
}

router.use(auditIntegrationAccess);

// Recruiter app account provisioning
router.post('/admin/register', integrationApiKeyAuth, integrationAdminRegisterValidation, handleValidationErrors, registerAdminFromIntegration);

// Partner management (internal use — one row per recruitment-platform partner)
router.post('/partners', integrationApiKeyAuth, createIntegrationPartner);
router.get('/partners', integrationApiKeyAuth, listIntegrationPartners);
router.patch('/partners/:partnerId', integrationApiKeyAuth, setIntegrationPartnerActive);

router.post('/auth/exchange', exchangeRecruiterToken);
router.post('/auth/refresh', refreshIntegrationToken);
router.post('/auth/revoke', integrationAuth, revokeIntegrationSessions);

router.get('/tests', integrationAuth, requireIntegrationScopes(['tests:read']), getCompanyTests);
router.post('/tests/create-with-ai', integrationAuth, requireIntegrationScopes(['invites:write']), createTestWithAIAndInvite);
router.post('/tests/:testId/invitations', integrationAuth, requireIntegrationScopes(['invites:write']), inviteCandidatesFromIntegration);
router.post('/tests/:testId/candidate-session', integrationAuth, requireIntegrationScopes(['invites:write']), createCandidateSessionFromIntegration);
router.get('/tests/:testId/results', integrationAuth, requireIntegrationScopes(['results:read']), getTestCandidateResultsForIntegration);

router.get('/company/webhook', integrationAuth, requireIntegrationScopes(['invites:write']), getCompanyWebhookStatus);
router.post('/company/webhook', integrationAuth, requireIntegrationScopes(['invites:write']), setCompanyWebhook);
router.delete('/company/webhook', integrationAuth, requireIntegrationScopes(['invites:write']), clearCompanyWebhook);

export default router;
