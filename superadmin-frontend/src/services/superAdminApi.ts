import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useSuperAdminStore } from '../context/superAdminStore';

// Deliberately a separate axios instance from services/api.ts rather than
// bolted onto its shared, URL-prefix-based token-switching interceptor —
// that interceptor is already juggling admin vs candidate tokens and is
// easy to regress. This one only ever carries the superAdmin token.
const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env || {};
const isLocalBrowser =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const apiBaseUrlFromEnv =
  typeof viteEnv.VITE_API_BASE_URL === 'string' ? viteEnv.VITE_API_BASE_URL : '';
const isDevMode = Boolean(viteEnv.DEV);
const resolvedApiBaseUrl =
  apiBaseUrlFromEnv || (isDevMode ? '/api' : isLocalBrowser ? 'http://localhost:3000/api' : '/api');

const superAdminHttp = axios.create({ baseURL: resolvedApiBaseUrl });

superAdminHttp.interceptors.request.use((config) => {
  const token = localStorage.getItem('superAdminToken');
  if (token) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

superAdminHttp.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && !error.config?.url?.includes('/superadmin/login')) {
      useSuperAdminStore.getState().logout();
      toast.error('Superadmin session expired. Please log in again.');
      if (!window.location.pathname.startsWith('/superadmin/login')) {
        window.location.href = '/superadmin/login';
      }
    }
    return Promise.reject(error);
  }
);

export interface SuperAdmin {
  id: string;
  email: string;
  name: string;
  role?: 'full_control' | 'read_only';
}

export interface AdminAccountSummary {
  id: string;
  email: string;
  name: string;
  companyName: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  status: 'online' | 'offline';
  actionsRecorded: number;
  ownedContent: {
    tests: number;
    mcqQuestions: number;
    codingQuestions: number;
    behavioralQuestions: number;
  };
  securityLocked: boolean;
  securityLockReason: string | null;
  pendingDeletionAt: string | null;
  deletionReason: string | null;
}

export interface AdminActionLogEntry {
  id: string;
  adminId: string | null;
  adminEmail: string;
  adminName: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorAdminId: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface AdminClickEventEntry {
  id: string;
  adminId: string | null;
  adminEmail: string;
  sessionId: string;
  eventType: string;
  targetLabel: string | null;
  targetSelector: string | null;
  route: string | null;
  metadata: unknown;
  clientTimestamp: string;
  receivedAt: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  scope: 'GLOBAL' | 'ADMIN';
  scopedAdminId: string | null;
  updatedByEmail: string | null;
  updatedAt: string;
}

export interface LiveTelemetry {
  capturedAt: string;
  activeSessions: number;
  medianPingMs: number | null;
  refreshFps: number | null;
  cvLatencyP50Ms: number | null;
  cvLatencyP95Ms: number | null;
  apiLatencyP50Ms: number | null;
  apiLatencyP95Ms: number | null;
  appFps: number | null;
  failedRequestRatePct: number | null;
  sampleCounts: Record<string, number>;
  disclaimer: string;
}

export interface TelemetrySnapshotEntry {
  id: string;
  capturedAt: string;
  activeSessions: number;
  medianPingMs: number | null;
  refreshFps: number | null;
  cvLatencyP50Ms: number | null;
  cvLatencyP95Ms: number | null;
  apiLatencyP50Ms: number | null;
  apiLatencyP95Ms: number | null;
  appFps: number | null;
  failedRequestRatePct: number | null;
}

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BillingSettings {
  id: string;
  key: string;
  enabled: boolean;
  updatedByEmail: string | null;
  updatedAt: string;
}

export interface BillingPlan {
  id: string;
  key: string;
  label: string;
  description: string | null;
  priceMonthly: number | null;
  maxTests: number | null;
  maxAiGenerations: number | null;
  maxInvitationsPerCycle: number | null;
  maxConcurrentProctoring: number | null;
  maxCustomQuestions: number | null;
  maxStorageMb: number | null;
  isCustom: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBillingRecord {
  id: string;
  status: 'active' | 'trialing' | 'suspended' | 'cancelled';
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  addOnAiGenerations: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

export interface BillingUsage {
  testsThisCycle: number;
  aiGenerationsThisCycle: number;
  invitationsThisCycle: number;
  concurrentProctoring: number;
  customQuestions: number;
  storageMb: number;
}

export interface AdminBillingOverviewRow {
  admin: { id: string; email: string; name: string; createdAt: string };
  billing: AdminBillingRecord;
  plan: BillingPlan;
  usage: BillingUsage;
}

export interface BillingInvoice {
  id: string;
  adminBillingId: string;
  amount: number;
  currency: string;
  status: string;
  note: string | null;
  issuedAt: string;
  createdByEmail: string | null;
}

export interface RevenueOverview {
  mrr: number;
  activePayingCount: number;
  totalSubscriptions: number;
  suspendedCount: number;
  trialingCount: number;
  planDistribution: { label: string; count: number }[];
}

export interface UsageTrendPoint {
  date: string;
  testsCreated: number;
  aiTestsCreated: number;
  invitationsSent: number;
}

export interface AuditLogSearchParams {
  page?: number;
  limit?: number;
  resourceType?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface ChainVerificationResult {
  intact: boolean;
  checkedCount: number;
  brokenAtId?: string;
  brokenAtIndex?: number;
}

export interface ClickSessionSummary {
  sessionId: string;
  adminId: string | null;
  adminEmail: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
}

export interface IpAllowlistEntry {
  id: string;
  cidrOrIp: string;
  label: string | null;
  createdAt: string;
  createdByEmail: string | null;
}

export interface SuperAdminTeamMember {
  id: string;
  email: string;
  name: string;
  role: 'full_control' | 'read_only';
  lastLoginAt: string | null;
  totpEnabled: boolean;
  createdAt: string;
}

export interface AlertConfigSettings {
  id: string;
  key: string;
  enabled: boolean;
  emailTo: string | null;
  slackWebhookUrl: string | null;
  genericWebhookUrl: string | null;
  apiLatencyP95ThresholdMs: number | null;
  sustainedMinutes: number;
  updatedByEmail: string | null;
  updatedAt: string;
}

export interface AlertLogEntry {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  meta: unknown;
  delivered: boolean;
  deliveryError: string | null;
  createdAt: string;
}

export interface OverviewTrends {
  activeAdminsPerDay: { date: string; activeAdmins: number }[];
  testsCreatedPerWeek: { weekStart: string; count: number }[];
}

export const superAdminApi = {
  login: (data: { email: string; password: string; totpCode?: string }) =>
    superAdminHttp.post<{
      requiresTotp?: boolean;
      message?: string;
      superAdmin?: SuperAdmin;
      token?: string;
      refreshToken?: string;
    }>('/superadmin/login', data),
  getProfile: () =>
    superAdminHttp.get<{ superAdmin: SuperAdmin & { lastLoginAt: string | null; totpEnabled: boolean } }>(
      '/superadmin/profile'
    ),

  listAccounts: () => superAdminHttp.get<{ admins: AdminAccountSummary[] }>('/superadmin/accounts'),
  deleteAccount: (adminId: string) => superAdminHttp.delete(`/superadmin/accounts/${adminId}`),
  scheduleDeleteAccount: (adminId: string, reason?: string) =>
    superAdminHttp.post<{ message: string; pendingDeletionAt: string }>(
      `/superadmin/accounts/${adminId}/schedule-delete`,
      { reason }
    ),
  cancelDeleteAccount: (adminId: string) =>
    superAdminHttp.post<{ message: string }>(`/superadmin/accounts/${adminId}/cancel-delete`),
  impersonateAccount: (adminId: string) =>
    superAdminHttp.post<{ token: string; adminEmail: string; expiresInMinutes: number }>(
      `/superadmin/accounts/${adminId}/impersonate`
    ),
  forceLogoutAdmin: (adminId: string) =>
    superAdminHttp.post<{ message: string }>(`/superadmin/accounts/${adminId}/force-logout`),
  unlockAdminSecurity: (adminId: string) =>
    superAdminHttp.post<{ message: string }>(`/superadmin/accounts/${adminId}/unlock`),

  listFeatureFlags: () => superAdminHttp.get<{ flags: FeatureFlag[] }>('/superadmin/features'),
  toggleFeatureFlag: (key: string, data: { enabled: boolean; scope?: 'GLOBAL' | 'ADMIN'; scopedAdminId?: string | null }) =>
    superAdminHttp.patch<{ flag: FeatureFlag }>(`/superadmin/features/${key}`, data),

  getActionLog: (params?: { page?: number; limit?: number; adminId?: string; search?: string; from?: string; to?: string }) =>
    superAdminHttp.get<{ entries: AdminActionLogEntry[]; total: number }>('/superadmin/logs/actions', { params }),
  getAuditLog: (params?: AuditLogSearchParams) =>
    superAdminHttp.get<{ entries: AuditLogEntry[]; total: number }>('/superadmin/logs/audit', { params }),
  exportAuditLogCsv: (params?: AuditLogSearchParams) =>
    superAdminHttp.get<string>('/superadmin/logs/audit/export', { params, responseType: 'text' }),
  getAuditChainStatus: () => superAdminHttp.get<ChainVerificationResult>('/superadmin/logs/audit/chain-status'),
  getClickEvents: (params?: { page?: number; limit?: number; adminId?: string }) =>
    superAdminHttp.get<{ entries: AdminClickEventEntry[]; total: number }>('/superadmin/logs/clicks', { params }),
  listClickSessions: (adminId?: string) =>
    superAdminHttp.get<{ sessions: ClickSessionSummary[] }>('/superadmin/logs/clicks/sessions', { params: { adminId } }),
  getClickSessionReplay: (sessionId: string) =>
    superAdminHttp.get<{ entries: AdminClickEventEntry[]; total: number }>(
      `/superadmin/logs/clicks/sessions/${sessionId}`
    ),

  getLiveTelemetry: () => superAdminHttp.get<LiveTelemetry>('/superadmin/telemetry/live'),
  getTelemetryHistory: (limit?: number) =>
    superAdminHttp.get<{ snapshots: TelemetrySnapshotEntry[] }>('/superadmin/telemetry/history', {
      params: { limit },
    }),

  chatWithAssistant: (message: string, history: AssistantChatMessage[]) =>
    superAdminHttp.post<{ reply: string; toolsUsed: string[] }>('/superadmin/ai/chat', { message, history }),

  getBillingSettings: () => superAdminHttp.get<{ settings: BillingSettings }>('/superadmin/billing/settings'),
  toggleBillingEnabled: (enabled: boolean) =>
    superAdminHttp.patch<{ settings: BillingSettings }>('/superadmin/billing/settings', { enabled }),

  listBillingPlans: () => superAdminHttp.get<{ plans: BillingPlan[] }>('/superadmin/billing/plans'),
  createBillingPlan: (data: Partial<BillingPlan> & { key: string; label: string }) =>
    superAdminHttp.post<{ plan: BillingPlan }>('/superadmin/billing/plans', data),
  updateBillingPlan: (planId: string, data: Partial<BillingPlan>) =>
    superAdminHttp.put<{ plan: BillingPlan }>(`/superadmin/billing/plans/${planId}`, data),
  deleteBillingPlan: (planId: string) => superAdminHttp.delete(`/superadmin/billing/plans/${planId}`),

  listAdminBillingOverview: () =>
    superAdminHttp.get<{ rows: AdminBillingOverviewRow[] }>('/superadmin/billing/admins'),
  getAdminBillingDetail: (adminId: string) =>
    superAdminHttp.get<{
      admin: { id: string; email: string; name: string };
      billing: AdminBillingRecord;
      plan: BillingPlan;
      usage: BillingUsage;
      invoices: BillingInvoice[];
    }>(`/superadmin/billing/admins/${adminId}`),
  assignBillingPlan: (adminId: string, planId: string, note?: string) =>
    superAdminHttp.put<{ billing: AdminBillingRecord }>(`/superadmin/billing/admins/${adminId}/plan`, { planId, note }),
  suspendAdminBilling: (adminId: string, reason?: string) =>
    superAdminHttp.post<{ billing: AdminBillingRecord }>(`/superadmin/billing/admins/${adminId}/suspend`, { reason }),
  reactivateAdminBilling: (adminId: string) =>
    superAdminHttp.post<{ billing: AdminBillingRecord }>(`/superadmin/billing/admins/${adminId}/reactivate`),
  addAddOnCredits: (adminId: string, amount: number) =>
    superAdminHttp.post<{ billing: AdminBillingRecord }>(`/superadmin/billing/admins/${adminId}/add-on-credits`, {
      amount,
    }),
  createManualInvoice: (
    adminId: string,
    data: { amount: number; currency?: string; status?: string; note?: string }
  ) => superAdminHttp.post<{ invoice: BillingInvoice }>(`/superadmin/billing/admins/${adminId}/invoices`, data),

  getRevenueOverview: () => superAdminHttp.get<RevenueOverview>('/superadmin/billing/revenue'),
  getUsageTrend: (days?: number) =>
    superAdminHttp.get<{ trend: UsageTrendPoint[] }>('/superadmin/billing/usage-trend', { params: { days } }),

  getOverviewTrends: (days?: number) =>
    superAdminHttp.get<OverviewTrends>('/superadmin/overview/trends', { params: { days } }),

  // ---- Security ----
  forceLogoutSuperAdmin: (superAdminId: string) =>
    superAdminHttp.post<{ message: string }>(`/superadmin/security/superadmins/${superAdminId}/force-logout`),

  setupTotp: () => superAdminHttp.post<{ secret: string; otpauthUrl: string }>('/superadmin/security/2fa/setup'),
  verifyTotpSetup: (token: string) =>
    superAdminHttp.post<{ message: string }>('/superadmin/security/2fa/verify-setup', { token }),
  disableTotp: (token: string) => superAdminHttp.post<{ message: string }>('/superadmin/security/2fa/disable', { token }),

  listIpAllowlist: () =>
    superAdminHttp.get<{ entries: IpAllowlistEntry[]; ipAllowlistEnabled: boolean }>('/superadmin/security/ip-allowlist'),
  addIpAllowlistEntry: (cidrOrIp: string, label?: string) =>
    superAdminHttp.post<{ entry: IpAllowlistEntry }>('/superadmin/security/ip-allowlist', { cidrOrIp, label }),
  deleteIpAllowlistEntry: (entryId: string) =>
    superAdminHttp.delete(`/superadmin/security/ip-allowlist/${entryId}`),
  toggleIpAllowlist: (enabled: boolean) =>
    superAdminHttp.patch<{ ipAllowlistEnabled: boolean }>('/superadmin/security/ip-allowlist/toggle', { enabled }),

  listSuperAdminTeam: () => superAdminHttp.get<{ superAdmins: SuperAdminTeamMember[] }>('/superadmin/security/team'),
  createSuperAdminTeamMember: (data: { email: string; password: string; name: string; role: 'full_control' | 'read_only' }) =>
    superAdminHttp.post<{ superAdmin: SuperAdminTeamMember }>('/superadmin/security/team', data),
  deleteSuperAdminTeamMember: (superAdminId: string) =>
    superAdminHttp.delete(`/superadmin/security/team/${superAdminId}`),

  // ---- Alerts ----
  getAlertConfig: () => superAdminHttp.get<{ config: AlertConfigSettings }>('/superadmin/alerts/config'),
  updateAlertConfig: (data: Partial<AlertConfigSettings>) =>
    superAdminHttp.patch<{ config: AlertConfigSettings }>('/superadmin/alerts/config', data),
  sendTestAlert: () => superAdminHttp.post<{ message: string }>('/superadmin/alerts/test'),
  listAlerts: (params?: { page?: number; limit?: number }) =>
    superAdminHttp.get<{ entries: AlertLogEntry[]; total: number }>('/superadmin/alerts', { params }),
};

export default superAdminHttp;
