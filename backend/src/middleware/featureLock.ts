import { Response, NextFunction } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendAlert } from '../services/alerting.js';

interface CachedFlag {
  enabled: boolean;
  scope: string;
  scopedAdminId: string | null;
  label: string;
  expiresAt: number;
}

const flagCache = new Map<string, CachedFlag>();
const CACHE_TTL_MS = 10 * 1000;

export function invalidateFeatureFlagCache(key?: string): void {
  if (key) {
    flagCache.delete(key);
  } else {
    flagCache.clear();
  }
}

async function getFlag(key: string): Promise<CachedFlag | null> {
  const cached = flagCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (!flag) return null;

  const entry: CachedFlag = {
    enabled: flag.enabled,
    scope: flag.scope,
    scopedAdminId: flag.scopedAdminId,
    label: flag.label,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  flagCache.set(key, entry);
  return entry;
}

// Applied per-route to a curated set of mutating admin endpoints. If a
// FeatureFlag row for `key` doesn't exist yet, the feature is treated as
// enabled (fail-open) rather than silently blocking undefined features.
export function requireFeatureEnabled(key: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const flag = await getFlag(key);
      if (!flag || flag.enabled) {
        next();
        return;
      }

      const lockedGlobally = flag.scope === 'GLOBAL';
      const lockedForThisAdmin = flag.scope === 'ADMIN' && flag.scopedAdminId === req.admin?.id;

      if (lockedGlobally || lockedForThisAdmin) {
        void sendAlert({
          type: 'feature_lock_trip',
          severity: 'info',
          message: `${req.admin?.email ?? 'An admin'} was blocked by the "${flag.label}" feature lock.`,
          meta: { feature: key, adminId: req.admin?.id },
          cooldownKey: `${key}:${req.admin?.id ?? ''}`,
        });
        res.status(423).json({
          error: 'feature_locked',
          feature: key,
          message: `"${flag.label}" has been locked by the platform administrator.`,
        });
        return;
      }

      next();
    } catch (error) {
      console.error('requireFeatureEnabled check failed, failing open:', error);
      next();
    }
  };
}
