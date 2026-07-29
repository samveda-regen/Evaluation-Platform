import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { superAdminAuth, requireFullControl } from '../middleware/auth.js';
import { handleValidationErrors, adminLoginValidation } from '../middleware/validation.js';
import { loginSuperAdmin, getSuperAdminProfile, refreshSuperAdminToken } from '../controllers/superAdminAuth.js';
import {
  listAdminAccounts,
  deleteAdminAccount,
  scheduleDeleteAdminAccount,
  cancelDeleteAdminAccount,
  impersonateAdmin,
} from '../controllers/superAdminAccounts.js';
import {
  listFeatureFlags,
  toggleFeatureFlag,
  listAdminFeatureOverrides,
  setAdminFeatureOverride,
  clearAdminFeatureOverride,
} from '../controllers/superAdminFeatureFlags.js';
import {
  getActionLog,
  getAuditLog,
  getClickEvents,
  exportAuditLogCsv,
  getAuditChainStatus,
  listClickSessions,
  getClickSessionReplay,
} from '../controllers/superAdminAuditLog.js';
import { getLiveTelemetry, getTelemetryHistory } from '../controllers/superAdminTelemetry.js';
import { chatWithAssistant } from '../controllers/superAdminAssistant.js';
import { getOverviewTrends } from '../controllers/superAdminOverview.js';
import {
  getBillingSettings,
  toggleBillingEnabled,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  listAdminBillingOverview,
  getAdminBillingDetail,
  assignPlan,
  suspendAdmin,
  reactivateAdmin,
  addAddOnCredits,
  createManualInvoice,
  getRevenueOverview,
  getUsageTrend,
} from '../controllers/superAdminBilling.js';
import {
  forceLogoutAdmin,
  forceLogoutSuperAdmin,
  setupTotp,
  verifyTotpSetup,
  disableTotp,
  listIpAllowlist,
  addIpAllowlistEntry,
  deleteIpAllowlistEntry,
  toggleIpAllowlist,
  listSuperAdmins,
  createSuperAdmin,
  deleteSuperAdmin,
  unlockAdminSecurity,
} from '../controllers/superAdminSecurity.js';
import {
  getAlertConfigSettings,
  updateAlertConfigSettings,
  sendTestAlert,
  listAlerts,
} from '../controllers/superAdminAlerts.js';

const router = Router();

// A Claude API call is materially more expensive than a normal DB-backed
// route, so this gets its own tighter limiter rather than relying on the
// app-wide generalLimiter.
const assistantLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: 'Too many assistant requests, please slow down' },
});

// ---- Auth ----
router.post('/login', adminLoginValidation, handleValidationErrors, loginSuperAdmin);
router.post('/refresh-token', refreshSuperAdminToken);
router.get('/profile', superAdminAuth, getSuperAdminProfile);

// ---- Accounts ----
router.get('/accounts', superAdminAuth, listAdminAccounts);
router.delete('/accounts/:adminId', superAdminAuth, requireFullControl, deleteAdminAccount);
router.post('/accounts/:adminId/schedule-delete', superAdminAuth, requireFullControl, scheduleDeleteAdminAccount);
router.post('/accounts/:adminId/cancel-delete', superAdminAuth, requireFullControl, cancelDeleteAdminAccount);
router.post('/accounts/:adminId/impersonate', superAdminAuth, requireFullControl, impersonateAdmin);
router.post('/accounts/:adminId/force-logout', superAdminAuth, requireFullControl, forceLogoutAdmin);
router.post('/accounts/:adminId/unlock', superAdminAuth, requireFullControl, unlockAdminSecurity);

// ---- Feature locks ----
router.get('/features', superAdminAuth, listFeatureFlags);
router.patch('/features/:key', superAdminAuth, requireFullControl, toggleFeatureFlag);
router.get('/features/accounts/:adminId', superAdminAuth, listAdminFeatureOverrides);
router.patch('/features/accounts/:adminId/:key', superAdminAuth, requireFullControl, setAdminFeatureOverride);
router.delete('/features/accounts/:adminId/:key', superAdminAuth, requireFullControl, clearAdminFeatureOverride);

// ---- Logs ----
router.get('/logs/actions', superAdminAuth, getActionLog);
router.get('/logs/audit', superAdminAuth, getAuditLog);
router.get('/logs/audit/export', superAdminAuth, exportAuditLogCsv);
router.get('/logs/audit/chain-status', superAdminAuth, getAuditChainStatus);
router.get('/logs/clicks', superAdminAuth, getClickEvents);
router.get('/logs/clicks/sessions', superAdminAuth, listClickSessions);
router.get('/logs/clicks/sessions/:sessionId', superAdminAuth, getClickSessionReplay);

// ---- Telemetry ----
router.get('/telemetry/live', superAdminAuth, getLiveTelemetry);
router.get('/telemetry/history', superAdminAuth, getTelemetryHistory);

// ---- Overview ----
router.get('/overview/trends', superAdminAuth, getOverviewTrends);

// ---- AI assistant ----
router.post('/ai/chat', superAdminAuth, assistantLimiter, chatWithAssistant);

// ---- Billing (preview — gated end-to-end by the settings.enabled master switch) ----
router.get('/billing/settings', superAdminAuth, getBillingSettings);
router.patch('/billing/settings', superAdminAuth, requireFullControl, toggleBillingEnabled);

router.get('/billing/plans', superAdminAuth, listPlans);
router.post('/billing/plans', superAdminAuth, requireFullControl, createPlan);
router.put('/billing/plans/:planId', superAdminAuth, requireFullControl, updatePlan);
router.delete('/billing/plans/:planId', superAdminAuth, requireFullControl, deletePlan);

router.get('/billing/admins', superAdminAuth, listAdminBillingOverview);
router.get('/billing/admins/:adminId', superAdminAuth, getAdminBillingDetail);
router.put('/billing/admins/:adminId/plan', superAdminAuth, requireFullControl, assignPlan);
router.post('/billing/admins/:adminId/suspend', superAdminAuth, requireFullControl, suspendAdmin);
router.post('/billing/admins/:adminId/reactivate', superAdminAuth, requireFullControl, reactivateAdmin);
router.post('/billing/admins/:adminId/add-on-credits', superAdminAuth, requireFullControl, addAddOnCredits);
router.post('/billing/admins/:adminId/invoices', superAdminAuth, requireFullControl, createManualInvoice);

router.get('/billing/revenue', superAdminAuth, getRevenueOverview);
router.get('/billing/usage-trend', superAdminAuth, getUsageTrend);

// ---- Security: force-logout, 2FA, IP allowlist, team management ----
router.post('/security/superadmins/:superAdminId/force-logout', superAdminAuth, requireFullControl, forceLogoutSuperAdmin);

router.post('/security/2fa/setup', superAdminAuth, setupTotp);
router.post('/security/2fa/verify-setup', superAdminAuth, verifyTotpSetup);
router.post('/security/2fa/disable', superAdminAuth, disableTotp);

router.get('/security/ip-allowlist', superAdminAuth, listIpAllowlist);
router.post('/security/ip-allowlist', superAdminAuth, requireFullControl, addIpAllowlistEntry);
router.delete('/security/ip-allowlist/:entryId', superAdminAuth, requireFullControl, deleteIpAllowlistEntry);
router.patch('/security/ip-allowlist/toggle', superAdminAuth, requireFullControl, toggleIpAllowlist);

router.get('/security/team', superAdminAuth, listSuperAdmins);
router.post('/security/team', superAdminAuth, requireFullControl, createSuperAdmin);
router.delete('/security/team/:superAdminId', superAdminAuth, requireFullControl, deleteSuperAdmin);

// ---- Alerts ----
router.get('/alerts/config', superAdminAuth, getAlertConfigSettings);
router.patch('/alerts/config', superAdminAuth, requireFullControl, updateAlertConfigSettings);
router.post('/alerts/test', superAdminAuth, requireFullControl, sendTestAlert);
router.get('/alerts', superAdminAuth, listAlerts);

export default router;
