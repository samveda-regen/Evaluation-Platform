import { Response, NextFunction } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendAlert } from '../services/alerting.js';

interface CachedFlag {
  enabled: boolean;
  label: string;
  expiresAt: number;
}

const flagCache = new Map<string, CachedFlag>();
// Keyed by `${key}:${adminId}`. A cached value of `null` means "no override
// row exists for this admin" (as distinct from an uncached miss), so a
// disabled-override doesn't get mistaken for cache-empty on every check.
const overrideCache = new Map<string, { enabled: boolean } | null>();
const overrideCacheExpiry = new Map<string, number>();
const CACHE_TTL_MS = 10 * 1000;

export function invalidateFeatureFlagCache(key?: string): void {
  if (key) {
    flagCache.delete(key);
    for (const cacheKey of overrideCache.keys()) {
      if (cacheKey.startsWith(`${key}:`)) {
        overrideCache.delete(cacheKey);
        overrideCacheExpiry.delete(cacheKey);
      }
    }
  } else {
    flagCache.clear();
    overrideCache.clear();
    overrideCacheExpiry.clear();
  }
}

async function getGlobalFlag(key: string): Promise<CachedFlag | null> {
  const cached = flagCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (!flag) return null;

  const entry: CachedFlag = {
    enabled: flag.enabled,
    label: flag.label,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  flagCache.set(key, entry);
  return entry;
}

async function getOverride(key: string, adminId: string): Promise<{ enabled: boolean } | null> {
  const cacheKey = `${key}:${adminId}`;
  const expiry = overrideCacheExpiry.get(cacheKey);
  if (expiry && expiry > Date.now()) {
    return overrideCache.get(cacheKey) ?? null;
  }

  const override = await prisma.featureFlagOverride.findUnique({
    where: { featureKey_adminId: { featureKey: key, adminId } },
  });
  const value = override ? { enabled: override.enabled } : null;
  overrideCache.set(cacheKey, value);
  overrideCacheExpiry.set(cacheKey, Date.now() + CACHE_TTL_MS);
  return value;
}

// Applied per-route to a curated set of mutating admin endpoints. If a
// FeatureFlag row for `key` doesn't exist yet, the feature is treated as
// enabled (fail-open) rather than silently blocking undefined features.
// A per-admin FeatureFlagOverride, if present, always wins over the global
// FeatureFlag.enabled value for that admin.
export function requireFeatureEnabled(key: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const flag = await getGlobalFlag(key);
      if (!flag) {
        next();
        return;
      }

      let effectiveEnabled = flag.enabled;
      if (req.admin?.id) {
        const override = await getOverride(key, req.admin.id);
        if (override) {
          effectiveEnabled = override.enabled;
        }
      }

      if (effectiveEnabled) {
        next();
        return;
      }

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
    } catch (error) {
      console.error('requireFeatureEnabled check failed, failing open:', error);
      next();
    }
  };
}
