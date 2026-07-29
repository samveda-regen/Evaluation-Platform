import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { invalidateFeatureFlagCache } from '../middleware/featureLock.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import { createAuditLogEntry } from '../services/auditChain.js';

// The curated, initial set of lockable features — matches what's actually
// wired into backend/src/routes/admin.ts via requireFeatureEnabled(). Not
// meant to be exhaustive; extending this list means adding both a row here
// and a requireFeatureEnabled(key) call on the route(s) it should gate.
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
    const { enabled, scope, scopedAdminId } = req.body as {
      enabled: boolean;
      scope?: 'GLOBAL' | 'ADMIN';
      scopedAdminId?: string | null;
    };

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '"enabled" must be a boolean' });
      return;
    }

    const existing = await prisma.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      res.status(404).json({ error: 'Feature flag not found' });
      return;
    }

    const resolvedScope = scope === 'ADMIN' ? 'ADMIN' : 'GLOBAL';
    const flag = await prisma.featureFlag.update({
      where: { key },
      data: {
        enabled,
        scope: resolvedScope,
        scopedAdminId: resolvedScope === 'ADMIN' ? scopedAdminId ?? null : null,
        updatedByEmail: req.superAdmin!.email,
      },
    });

    invalidateFeatureFlagCache(key);

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'FeatureFlag',
      resourceId: key,
      before: { enabled: existing.enabled, scope: existing.scope, scopedAdminId: existing.scopedAdminId },
      after: { enabled: flag.enabled, scope: flag.scope, scopedAdminId: flag.scopedAdminId },
    });

    emitToSuperAdminRoom('feature-toggled', flag);
    res.json({ flag });
  } catch (error) {
    console.error('Toggle feature flag error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
