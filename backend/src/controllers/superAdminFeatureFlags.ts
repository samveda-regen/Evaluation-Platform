import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { invalidateFeatureFlagCache } from '../middleware/featureLock.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import { createAuditLogEntry } from '../services/auditChain.js';

// The curated, initial set of lockable features — matches what's actually
// wired into backend/src/routes/admin.ts via requireFeatureEnabled(), plus
// anomaly_auto_lock which gates services/anomalyLock.ts directly rather than
// a route. Not meant to be exhaustive; extending this list means adding both
// a row here and a requireFeatureEnabled(key) call (or equivalent check) on
// whatever it should gate.
export const DEFAULT_FEATURE_FLAGS: { key: string; label: string; description: string }[] = [
  { key: 'test_creation', label: 'Test creation', description: 'Admins can create new tests.' },
  {
    key: 'invitation_sending',
    label: 'Candidate invitations',
    description: 'Admins can send test invitations to candidates.',
  },
  { key: 'results_export', label: 'Results export', description: 'Admins can export candidate results.' },
  {
    key: 'ai_test_generator',
    label: 'AI test generator',
    description: 'Admins can use the AI agent to generate or create tests.',
  },
  {
    key: 'question_repository_writes',
    label: 'Question repository writes',
    description: 'Admins can create, edit, or delete MCQ/coding/behavioral questions.',
  },
  {
    key: 'anomaly_auto_lock',
    label: 'Automatic anomaly lock',
    description: 'Automatically locks an admin account when its hourly activity spikes far above its own baseline.',
  },
];

export async function ensureDefaultFeatureFlags(): Promise<void> {
  for (const flag of DEFAULT_FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: {},
      create: { key: flag.key, label: flag.label, description: flag.description, enabled: true },
    });
  }
}

export async function fetchFeatureFlags() {
  return prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
}

export async function listFeatureFlags(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const flags = await fetchFeatureFlags();
    res.json({ flags });
  } catch (error) {
    console.error('List feature flags error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function toggleFeatureFlag(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { key } = req.params;
    const { enabled } = req.body as { enabled: boolean };

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '"enabled" must be a boolean' });
      return;
    }

    const existing = await prisma.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      res.status(404).json({ error: 'Feature flag not found' });
      return;
    }

    const flag = await prisma.featureFlag.update({
      where: { key },
      data: { enabled, updatedByEmail: req.superAdmin!.email },
    });

    invalidateFeatureFlagCache(key);

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'FeatureFlag',
      resourceId: key,
      before: { enabled: existing.enabled },
      after: { enabled: flag.enabled },
    });

    emitToSuperAdminRoom('feature-toggled', flag);
    res.json({ flag });
  } catch (error) {
    console.error('Toggle feature flag error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Merged view of every feature flag for one specific admin: the global
// default, whether this admin has an override, and the effective value that
// actually applies to their requests (see requireFeatureEnabled()).
export async function listAdminFeatureOverrides(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const [flags, overrides] = await Promise.all([
      fetchFeatureFlags(),
      prisma.featureFlagOverride.findMany({ where: { adminId } }),
    ]);
    const overrideByKey = new Map(overrides.map((o) => [o.featureKey, o]));

    const merged = flags.map((flag) => {
      const override = overrideByKey.get(flag.key);
      return {
        key: flag.key,
        label: flag.label,
        description: flag.description,
        globalEnabled: flag.enabled,
        overrideEnabled: override ? override.enabled : null,
        effectiveEnabled: override ? override.enabled : flag.enabled,
      };
    });

    res.json({ flags: merged });
  } catch (error) {
    console.error('List admin feature overrides error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setAdminFeatureOverride(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId, key } = req.params;
    const { enabled } = req.body as { enabled: boolean };

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '"enabled" must be a boolean' });
      return;
    }

    const flag = await prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      res.status(404).json({ error: 'Feature flag not found' });
      return;
    }

    const existing = await prisma.featureFlagOverride.findUnique({
      where: { featureKey_adminId: { featureKey: key, adminId } },
    });

    const override = await prisma.featureFlagOverride.upsert({
      where: { featureKey_adminId: { featureKey: key, adminId } },
      update: { enabled, updatedByEmail: req.superAdmin!.email },
      create: { featureKey: key, adminId, enabled, updatedByEmail: req.superAdmin!.email },
    });

    invalidateFeatureFlagCache(key);

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'FeatureFlagOverride',
      resourceId: `${key}:${adminId}`,
      before: existing ? { enabled: existing.enabled } : null,
      after: { enabled: override.enabled },
    });

    emitToSuperAdminRoom('feature-override-changed', { featureKey: key, adminId, enabled: override.enabled });
    res.json({
      key,
      label: flag.label,
      description: flag.description,
      globalEnabled: flag.enabled,
      overrideEnabled: override.enabled,
      effectiveEnabled: override.enabled,
    });
  } catch (error) {
    console.error('Set admin feature override error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function clearAdminFeatureOverride(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId, key } = req.params;

    const flag = await prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      res.status(404).json({ error: 'Feature flag not found' });
      return;
    }

    const existing = await prisma.featureFlagOverride.findUnique({
      where: { featureKey_adminId: { featureKey: key, adminId } },
    });

    if (existing) {
      await prisma.featureFlagOverride.delete({
        where: { featureKey_adminId: { featureKey: key, adminId } },
      });
      invalidateFeatureFlagCache(key);

      await createAuditLogEntry({
        actorAdminId: null,
        actorEmail: req.superAdmin!.email,
        action: 'delete',
        resourceType: 'FeatureFlagOverride',
        resourceId: `${key}:${adminId}`,
        before: { enabled: existing.enabled },
        after: null,
      });

      emitToSuperAdminRoom('feature-override-changed', { featureKey: key, adminId, enabled: null });
    }

    res.json({
      key,
      label: flag.label,
      description: flag.description,
      globalEnabled: flag.enabled,
      overrideEnabled: null,
      effectiveEnabled: flag.enabled,
    });
  } catch (error) {
    console.error('Clear admin feature override error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
