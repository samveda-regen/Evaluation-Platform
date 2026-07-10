import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { checkQuota, type QuotaKey } from '../services/billing.js';

// Applied per-route, after the corresponding requireFeatureEnabled() check.
// Fails open on any unexpected error — a bug in the billing subsystem must
// never be able to block a real admin action, since billing is a preview
// feature and the rest of the application must keep working regardless.
export function requireWithinQuota(quotaKey: QuotaKey) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = req.admin?.id;
      if (!adminId) {
        next();
        return;
      }

      const result = await checkQuota(adminId, quotaKey);
      if (!result.allowed) {
        res.status(402).json({
          error: result.message || 'This action is not available on your current plan.',
          code: result.reason,
          current: result.current,
          limit: result.limit,
        });
        return;
      }

      next();
    } catch (error) {
      console.error('requireWithinQuota check failed, failing open:', error);
      next();
    }
  };
}
