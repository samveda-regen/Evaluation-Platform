import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import { createAuditLogEntry } from '../services/auditChain.js';
import {
  ensureAdminBilling,
  resetCycleIfNeeded,
  getLiveUsage,
  invalidateBillingSettingsCache,
} from '../services/billing.js';

// ---- Master toggle ----

export async function getBillingSettings(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const settings = await prisma.billingSettings.upsert({
      where: { key: 'global' },
      update: {},
      create: { key: 'global', enabled: false },
    });
    res.json({ settings });
  } catch (error) {
    console.error('Get billing settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function toggleBillingEnabled(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '"enabled" must be a boolean' });
      return;
    }

    const existing = await prisma.billingSettings.upsert({
      where: { key: 'global' },
      update: {},
      create: { key: 'global', enabled: false },
    });

    const settings = await prisma.billingSettings.update({
      where: { key: 'global' },
      data: { enabled, updatedByEmail: req.superAdmin!.email },
    });
    invalidateBillingSettingsCache();

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'BillingSettings',
      resourceId: 'global',
      before: { enabled: existing.enabled },
      after: { enabled: settings.enabled },
    });

    emitToSuperAdminRoom('billing-settings-updated', settings);
    res.json({ settings });
  } catch (error) {
    console.error('Toggle billing enabled error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---- Plans ----

export async function listPlans(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const plans = await prisma.billingPlan.findMany({ orderBy: { priceMonthly: 'asc' } });
    res.json({ plans });
  } catch (error) {
    console.error('List billing plans error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

interface PlanInput {
  key?: string;
  label?: string;
  description?: string | null;
  priceMonthly?: number | null;
  maxTests?: number | null;
  maxAiGenerations?: number | null;
  maxInvitationsPerCycle?: number | null;
  maxConcurrentProctoring?: number | null;
  maxCustomQuestions?: number | null;
  maxStorageMb?: number | null;
}

function sanitizePlanInput(body: PlanInput) {
  return {
    ...(body.label !== undefined ? { label: body.label } : {}),
    description: body.description ?? null,
    priceMonthly: body.priceMonthly ?? null,
    maxTests: body.maxTests ?? null,
    maxAiGenerations: body.maxAiGenerations ?? null,
    maxInvitationsPerCycle: body.maxInvitationsPerCycle ?? null,
    maxConcurrentProctoring: body.maxConcurrentProctoring ?? null,
    maxCustomQuestions: body.maxCustomQuestions ?? null,
    maxStorageMb: body.maxStorageMb ?? null,
  };
}

export async function createPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body as PlanInput;
    if (!body.key || !body.label) {
      res.status(400).json({ error: '"key" and "label" are required' });
      return;
    }

    const existing = await prisma.billingPlan.findUnique({ where: { key: body.key } });
    if (existing) {
      res.status(409).json({ error: `A plan with key "${body.key}" already exists` });
      return;
    }

    const plan = await prisma.billingPlan.create({
      data: { key: body.key, label: body.label, isCustom: true, ...sanitizePlanInput(body) },
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'create',
      resourceType: 'BillingPlan',
      resourceId: plan.id,
      after: plan,
    });

    emitToSuperAdminRoom('billing-plan-updated', plan);
    res.status(201).json({ plan });
  } catch (error) {
    console.error('Create billing plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updatePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { planId } = req.params;
    const existing = await prisma.billingPlan.findUnique({ where: { id: planId } });
    if (!existing) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    const plan = await prisma.billingPlan.update({
      where: { id: planId },
      data: sanitizePlanInput(req.body as PlanInput),
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'BillingPlan',
      resourceId: plan.id,
      before: existing,
      after: plan,
    });

    emitToSuperAdminRoom('billing-plan-updated', plan);
    res.json({ plan });
  } catch (error) {
    console.error('Update billing plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deletePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { planId } = req.params;
    const inUse = await prisma.adminBilling.count({ where: { planId } });
    if (inUse > 0) {
      res.status(409).json({ error: `${inUse} admin(s) are currently on this plan. Reassign them before deleting.` });
      return;
    }

    const plan = await prisma.billingPlan.delete({ where: { id: planId } });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'delete',
      resourceType: 'BillingPlan',
      resourceId: plan.id,
      before: plan,
    });

    emitToSuperAdminRoom('billing-plan-updated', { deleted: true, id: plan.id });
    res.json({ message: 'Plan deleted' });
  } catch (error) {
    console.error('Delete billing plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---- Per-admin billing overview ----

export async function listAdminBillingOverview(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const admins = await prisma.admin.findMany({
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const rows = await Promise.all(
      admins.map(async (admin) => {
        let billing = await ensureAdminBilling(admin.id);
        billing = await resetCycleIfNeeded(billing);
        const usage = await getLiveUsage(admin.id, billing.currentPeriodStart);

        return {
          admin: { id: admin.id, email: admin.email, name: admin.name, createdAt: admin.createdAt },
          billing: {
            id: billing.id,
            status: billing.status,
            currentPeriodStart: billing.currentPeriodStart,
            currentPeriodEnd: billing.currentPeriodEnd,
            addOnAiGenerations: billing.addOnAiGenerations,
            suspendedAt: billing.suspendedAt,
            suspendedReason: billing.suspendedReason,
          },
          plan: billing.plan,
          usage,
        };
      })
    );

    res.json({ rows });
  } catch (error) {
    console.error('List admin billing overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAdminBillingDetail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { id: true, email: true, name: true } });
    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    let billing = await ensureAdminBilling(adminId);
    billing = await resetCycleIfNeeded(billing);
    const usage = await getLiveUsage(adminId, billing.currentPeriodStart);
    const invoices = await prisma.billingInvoice.findMany({
      where: { adminBillingId: billing.id },
      orderBy: { issuedAt: 'desc' },
    });

    res.json({ admin, billing, plan: billing.plan, usage, invoices });
  } catch (error) {
    console.error('Get admin billing detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function assignPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const { planId, note } = req.body as { planId?: string; note?: string };
    if (!planId) {
      res.status(400).json({ error: '"planId" is required' });
      return;
    }

    const plan = await prisma.billingPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    const existing = await ensureAdminBilling(adminId);
    const billing = await prisma.adminBilling.update({
      where: { id: existing.id },
      data: { planId, overrideNote: note ?? null, updatedByEmail: req.superAdmin!.email },
      include: { plan: true },
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'AdminBilling',
      resourceId: adminId,
      before: { planId: existing.planId, planKey: existing.plan.key },
      after: { planId: billing.planId, planKey: billing.plan.key, note },
    });

    emitToSuperAdminRoom('billing-admin-updated', { adminId, billing });
    res.json({ billing });
  } catch (error) {
    console.error('Assign billing plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function suspendAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const { reason } = req.body as { reason?: string };

    const existing = await ensureAdminBilling(adminId);
    const billing = await prisma.adminBilling.update({
      where: { id: existing.id },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedReason: reason ?? null,
        updatedByEmail: req.superAdmin!.email,
      },
      include: { plan: true },
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'AdminBilling',
      resourceId: adminId,
      before: { status: existing.status },
      after: { status: 'suspended', reason },
    });

    emitToSuperAdminRoom('billing-admin-updated', { adminId, billing });
    res.json({ billing });
  } catch (error) {
    console.error('Suspend admin billing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function reactivateAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const existing = await ensureAdminBilling(adminId);
    const billing = await prisma.adminBilling.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        suspendedAt: null,
        suspendedReason: null,
        updatedByEmail: req.superAdmin!.email,
      },
      include: { plan: true },
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'AdminBilling',
      resourceId: adminId,
      before: { status: existing.status },
      after: { status: 'active' },
    });

    emitToSuperAdminRoom('billing-admin-updated', { adminId, billing });
    res.json({ billing });
  } catch (error) {
    console.error('Reactivate admin billing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function addAddOnCredits(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const { amount } = req.body as { amount?: number };
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
      res.status(400).json({ error: '"amount" must be a non-zero number' });
      return;
    }

    const existing = await ensureAdminBilling(adminId);
    const billing = await prisma.adminBilling.update({
      where: { id: existing.id },
      data: {
        addOnAiGenerations: Math.max(0, existing.addOnAiGenerations + amount),
        updatedByEmail: req.superAdmin!.email,
      },
      include: { plan: true },
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'AdminBilling',
      resourceId: adminId,
      before: { addOnAiGenerations: existing.addOnAiGenerations },
      after: { addOnAiGenerations: billing.addOnAiGenerations },
    });

    emitToSuperAdminRoom('billing-admin-updated', { adminId, billing });
    res.json({ billing });
  } catch (error) {
    console.error('Add add-on credits error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---- Invoices (manual — no live payment processor is wired up yet) ----

export async function createManualInvoice(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const { amount, currency, status, note } = req.body as {
      amount?: number;
      currency?: string;
      status?: string;
      note?: string;
    };

    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      res.status(400).json({ error: '"amount" is required' });
      return;
    }
    const allowedStatuses = ['paid', 'pending', 'failed', 'manual'];
    const resolvedStatus = allowedStatuses.includes(status ?? '') ? (status as string) : 'manual';

    const billing = await ensureAdminBilling(adminId);
    const invoice = await prisma.billingInvoice.create({
      data: {
        adminBillingId: billing.id,
        amount,
        currency: currency || 'USD',
        status: resolvedStatus,
        note: note ?? null,
        createdByEmail: req.superAdmin!.email,
      },
    });

    emitToSuperAdminRoom('billing-invoice-created', invoice);
    res.status(201).json({ invoice });
  } catch (error) {
    console.error('Create manual invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---- Reporting ----

export async function getRevenueOverview(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const subscriptions = await prisma.adminBilling.findMany({ include: { plan: true } });

    const activePaying = subscriptions.filter((s) => s.status === 'active' && (s.plan.priceMonthly ?? 0) > 0);
    const suspended = subscriptions.filter((s) => s.status === 'suspended');
    const trialing = subscriptions.filter((s) => s.status === 'trialing');
    const mrr = activePaying.reduce((sum, s) => sum + (s.plan.priceMonthly ?? 0), 0);

    const planDistribution = new Map<string, number>();
    for (const s of subscriptions) {
      planDistribution.set(s.plan.label, (planDistribution.get(s.plan.label) ?? 0) + 1);
    }

    res.json({
      mrr,
      activePayingCount: activePaying.length,
      totalSubscriptions: subscriptions.length,
      suspendedCount: suspended.length,
      trialingCount: trialing.length,
      planDistribution: Array.from(planDistribution.entries()).map(([label, count]) => ({ label, count })),
    });
  } catch (error) {
    console.error('Get revenue overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getUsageTrend(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days ?? '30'), 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [tests, invitations] = await Promise.all([
      prisma.test.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, isAiGenerated: true } }),
      prisma.testInvitation.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    ]);

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const buckets = new Map<string, { testsCreated: number; aiTestsCreated: number; invitationsSent: number }>();

    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      buckets.set(dayKey(d), { testsCreated: 0, aiTestsCreated: 0, invitationsSent: 0 });
    }

    for (const test of tests) {
      const key = dayKey(test.createdAt);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.testsCreated += 1;
        if (test.isAiGenerated) bucket.aiTestsCreated += 1;
      }
    }
    for (const invitation of invitations) {
      const key = dayKey(invitation.createdAt);
      const bucket = buckets.get(key);
      if (bucket) bucket.invitationsSent += 1;
    }

    const trend = Array.from(buckets.entries()).map(([date, values]) => ({ date, ...values }));
    res.json({ trend });
  } catch (error) {
    console.error('Get usage trend error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
