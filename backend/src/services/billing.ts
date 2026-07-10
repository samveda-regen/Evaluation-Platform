import { QuestionSource } from '@prisma/client';
import prisma from '../utils/db.js';

// Billing is a preview subsystem pending board approval (see BillingSettings
// below). Every quota number here is derived from a live COUNT/SUM query
// against real rows (tests, invitations, questions, sessions, media) rather
// than an incrementable counter column — this avoids an entire class of
// double-counting/drift bugs that a separate "usage counter" would risk
// introducing into the existing admin-facing write paths.

export const DEFAULT_BILLING_PLANS: {
  key: string;
  label: string;
  description: string;
  priceMonthly: number | null;
  maxTests: number | null;
  maxAiGenerations: number | null;
  maxInvitationsPerCycle: number | null;
  maxConcurrentProctoring: number | null;
  maxCustomQuestions: number | null;
  maxStorageMb: number | null;
}[] = [
  {
    key: 'free',
    label: 'Free',
    description: 'Evaluation tier for new admins.',
    priceMonthly: 0,
    maxTests: 3,
    maxAiGenerations: 5,
    maxInvitationsPerCycle: 25,
    maxConcurrentProctoring: 5,
    maxCustomQuestions: 20,
    maxStorageMb: 512,
  },
  {
    key: 'starter',
    label: 'Starter',
    description: 'Small teams running a steady stream of assessments.',
    priceMonthly: 49,
    maxTests: 20,
    maxAiGenerations: 30,
    maxInvitationsPerCycle: 250,
    maxConcurrentProctoring: 25,
    maxCustomQuestions: 150,
    maxStorageMb: 5120,
  },
  {
    key: 'pro',
    label: 'Pro',
    description: 'Growing hiring pipelines with heavier proctoring load.',
    priceMonthly: 149,
    maxTests: 100,
    maxAiGenerations: 150,
    maxInvitationsPerCycle: 2000,
    maxConcurrentProctoring: 150,
    maxCustomQuestions: 1000,
    maxStorageMb: 51200,
  },
  {
    key: 'enterprise',
    label: 'Enterprise',
    description: 'Unlimited usage, custom terms.',
    priceMonthly: null,
    maxTests: null,
    maxAiGenerations: null,
    maxInvitationsPerCycle: null,
    maxConcurrentProctoring: null,
    maxCustomQuestions: null,
    maxStorageMb: null,
  },
];

const CYCLE_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

export async function ensureDefaultBillingPlans(): Promise<void> {
  for (const plan of DEFAULT_BILLING_PLANS) {
    await prisma.billingPlan.upsert({
      where: { key: plan.key },
      update: {},
      create: plan,
    });
  }
  await prisma.billingSettings.upsert({
    where: { key: 'global' },
    update: {},
    create: { key: 'global', enabled: false },
  });
}

// ---- Global master toggle (short TTL cache, mirrors featureLock.ts) ----
let settingsCache: { enabled: boolean; expiresAt: number } | null = null;
const SETTINGS_CACHE_TTL_MS = 10 * 1000;

export function invalidateBillingSettingsCache(): void {
  settingsCache = null;
}

export async function isBillingEnabled(): Promise<boolean> {
  if (settingsCache && settingsCache.expiresAt > Date.now()) {
    return settingsCache.enabled;
  }
  const settings = await prisma.billingSettings.findUnique({ where: { key: 'global' } });
  const enabled = settings?.enabled ?? false;
  settingsCache = { enabled, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return enabled;
}

// ---- Per-admin subscription row (lazily created on the Free plan) ----
export async function ensureAdminBilling(adminId: string) {
  const existing = await prisma.adminBilling.findUnique({ where: { adminId }, include: { plan: true } });
  if (existing) return existing;

  const freePlan = await prisma.billingPlan.findUnique({ where: { key: 'free' } });
  if (!freePlan) {
    throw new Error('Default billing plans have not been seeded yet');
  }

  return prisma.adminBilling.create({
    data: { adminId, planId: freePlan.id },
    include: { plan: true },
  });
}

type AdminBillingWithPlan = Awaited<ReturnType<typeof ensureAdminBilling>>;

// Lazily rolls the billing cycle forward once the current period has
// elapsed. Since usage is always derived from `createdAt >= currentPeriodStart`
// live queries (see getLiveUsage below), simply moving the window forward
// is the entire "reset" — there is no counter to zero out.
export async function resetCycleIfNeeded(billing: AdminBillingWithPlan): Promise<AdminBillingWithPlan> {
  const now = Date.now();
  const periodEnd = billing.currentPeriodEnd ? billing.currentPeriodEnd.getTime() : null;

  if (periodEnd !== null && now < periodEnd) {
    return billing;
  }

  const newStart = new Date(now);
  const newEnd = new Date(now + CYCLE_LENGTH_MS);
  return prisma.adminBilling.update({
    where: { id: billing.id },
    data: { currentPeriodStart: newStart, currentPeriodEnd: newEnd },
    include: { plan: true },
  });
}

export interface LiveUsage {
  testsThisCycle: number;
  aiGenerationsThisCycle: number;
  invitationsThisCycle: number;
  concurrentProctoring: number;
  customQuestions: number;
  storageMb: number;
}

export async function getLiveUsage(adminId: string, periodStart: Date): Promise<LiveUsage> {
  const [
    testsThisCycle,
    aiGenerationsThisCycle,
    invitationsThisCycle,
    concurrentProctoring,
    mcqCustom,
    codingCustom,
    behavioralCustom,
    storageAgg,
  ] = await Promise.all([
    prisma.test.count({ where: { adminId, createdAt: { gte: periodStart } } }),
    prisma.test.count({ where: { adminId, isAiGenerated: true, createdAt: { gte: periodStart } } }),
    prisma.testInvitation.count({
      where: { test: { adminId }, createdAt: { gte: periodStart } },
    }),
    prisma.proctorSession.count({
      where: { endedAt: null, attempt: { test: { adminId } } },
    }),
    prisma.mCQQuestion.count({ where: { adminId, source: QuestionSource.CUSTOM } }),
    prisma.codingQuestion.count({ where: { adminId, source: QuestionSource.CUSTOM } }),
    prisma.behavioralQuestion.count({ where: { adminId, source: QuestionSource.CUSTOM } }),
    prisma.mediaAsset.aggregate({ where: { uploadedBy: adminId }, _sum: { fileSize: true } }),
  ]);

  return {
    testsThisCycle,
    aiGenerationsThisCycle,
    invitationsThisCycle,
    concurrentProctoring,
    customQuestions: mcqCustom + codingCustom + behavioralCustom,
    storageMb: Math.round(((storageAgg._sum.fileSize ?? 0) / (1024 * 1024)) * 100) / 100,
  };
}

export type QuotaKey = 'tests' | 'aiGenerations' | 'invitations' | 'customQuestions';

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: 'billing_disabled' | 'account_suspended' | 'quota_exceeded';
  message?: string;
  current?: number;
  limit?: number | null;
}

const QUOTA_LABELS: Record<QuotaKey, string> = {
  tests: 'test creation',
  aiGenerations: 'AI test generation',
  invitations: 'candidate invitation sending',
  customQuestions: 'custom question creation',
};

// The single entry point the billingGate middleware calls. Deliberately
// conservative: any unexpected shape returns { allowed: true } and lets the
// caller's own try/catch fail the request open, matching requireFeatureEnabled.
export async function checkQuota(adminId: string, quotaKey: QuotaKey): Promise<QuotaCheckResult> {
  const enabled = await isBillingEnabled();
  if (!enabled) {
    return { allowed: true, reason: 'billing_disabled' };
  }

  let billing = await ensureAdminBilling(adminId);

  if (billing.status === 'suspended') {
    return {
      allowed: false,
      reason: 'account_suspended',
      message: `Your account is suspended${billing.suspendedReason ? `: ${billing.suspendedReason}` : ''}. Contact your platform administrator.`,
    };
  }

  billing = await resetCycleIfNeeded(billing);
  const usage = await getLiveUsage(adminId, billing.currentPeriodStart);

  let current: number;
  let limit: number | null;

  switch (quotaKey) {
    case 'tests':
      current = usage.testsThisCycle;
      limit = billing.plan.maxTests;
      break;
    case 'aiGenerations':
      current = usage.aiGenerationsThisCycle;
      limit = billing.plan.maxAiGenerations === null ? null : billing.plan.maxAiGenerations + billing.addOnAiGenerations;
      break;
    case 'invitations':
      current = usage.invitationsThisCycle;
      limit = billing.plan.maxInvitationsPerCycle;
      break;
    case 'customQuestions':
      current = usage.customQuestions;
      limit = billing.plan.maxCustomQuestions;
      break;
  }

  if (limit !== null && current >= limit) {
    return {
      allowed: false,
      reason: 'quota_exceeded',
      current,
      limit,
      message: `You've reached your plan's ${QUOTA_LABELS[quotaKey]} limit (${current}/${limit}). Upgrade your plan to continue.`,
    };
  }

  return { allowed: true, current, limit };
}
