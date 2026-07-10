import prisma from '../utils/db.js';
import { sendAlert } from './alerting.js';
import { invalidateAdminSecurityCache } from './sessionSecurity.js';

// Compares each admin's last-hour action count against their own 7-day
// baseline hourly rate. Flags (and locks) only when BOTH the relative
// spike is large (5x baseline) AND the absolute count is high enough that
// it can't just be normal noise for a low-activity account.
const SPIKE_MULTIPLIER = 5;
const MIN_ABSOLUTE_ACTIONS = 20;
const MIN_BASELINE_HOURLY_RATE = 1; // an admin with ~zero history isn't "anomalous" for having a first busy hour

export async function runAnomalyDetection(): Promise<void> {
  try {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const hoursInBaselineWindow = 7 * 24 - 1;

    const [recentCounts, weeklyCounts] = await Promise.all([
      prisma.adminActionLog.groupBy({
        by: ['adminId'],
        where: { createdAt: { gte: hourAgo }, adminId: { not: null } },
        _count: { _all: true },
      }),
      prisma.adminActionLog.groupBy({
        by: ['adminId'],
        where: { createdAt: { gte: weekAgo, lt: hourAgo }, adminId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const weeklyMap = new Map(weeklyCounts.map((w) => [w.adminId, w._count._all]));

    for (const recent of recentCounts) {
      if (!recent.adminId || recent._count._all < MIN_ABSOLUTE_ACTIONS) continue;

      const baselineHourlyRate = (weeklyMap.get(recent.adminId) ?? 0) / hoursInBaselineWindow;
      if (baselineHourlyRate < MIN_BASELINE_HOURLY_RATE) continue;
      if (recent._count._all < baselineHourlyRate * SPIKE_MULTIPLIER) continue;

      const admin = await prisma.admin.findUnique({
        where: { id: recent.adminId },
        select: { id: true, email: true, securityLocked: true },
      });
      if (!admin || admin.securityLocked) continue;

      const reason = `Automatic anomaly lock: ${recent._count._all} actions in the last hour vs. a baseline of ~${baselineHourlyRate.toFixed(1)}/hour.`;

      await prisma.admin.update({
        where: { id: admin.id },
        data: { securityLocked: true, securityLockReason: reason, securityLockedAt: new Date() },
      });
      invalidateAdminSecurityCache(admin.id);

      await sendAlert({
        type: 'anomaly_auto_lock',
        severity: 'critical',
        message: `${admin.email} was automatically locked — ${reason}`,
        meta: { adminId: admin.id, recentCount: recent._count._all, baselineHourlyRate },
        cooldownKey: admin.id,
      });
    }
  } catch (error) {
    console.error('Anomaly detection run failed:', error);
  }
}
