import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';

// Real derived trends for the Overview screen — active admins/day (distinct
// adminId per day from the action log) and tests created/week — both
// counted from rows that already exist, nothing simulated.
export async function getOverviewTrends(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days ?? '30'), 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const actions = await prisma.adminActionLog.findMany({
      where: { createdAt: { gte: since }, adminId: { not: null } },
      select: { createdAt: true, adminId: true },
    });

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const activeAdminsByDay = new Map<string, Set<string>>();
    for (let i = 0; i < days; i++) {
      activeAdminsByDay.set(dayKey(new Date(since.getTime() + i * 24 * 60 * 60 * 1000)), new Set());
    }
    for (const action of actions) {
      if (!action.adminId) continue;
      const key = dayKey(action.createdAt);
      activeAdminsByDay.get(key)?.add(action.adminId);
    }

    const activeAdminsPerDay = Array.from(activeAdminsByDay.entries()).map(([date, admins]) => ({
      date,
      activeAdmins: admins.size,
    }));

    const weeks = Math.ceil(days / 7);
    const sinceWeeks = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
    const tests = await prisma.test.findMany({
      where: { createdAt: { gte: sinceWeeks } },
      select: { createdAt: true },
    });

    const weekKey = (d: Date) => {
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const weekIndex = Math.floor((d.getTime() - sinceWeeks.getTime()) / msPerWeek);
      return new Date(sinceWeeks.getTime() + weekIndex * msPerWeek).toISOString().slice(0, 10);
    };
    const testsByWeek = new Map<string, number>();
    for (let i = 0; i < weeks; i++) {
      testsByWeek.set(new Date(sinceWeeks.getTime() + i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), 0);
    }
    for (const test of tests) {
      const key = weekKey(test.createdAt);
      testsByWeek.set(key, (testsByWeek.get(key) ?? 0) + 1);
    }

    res.json({
      activeAdminsPerDay,
      testsCreatedPerWeek: Array.from(testsByWeek.entries()).map(([weekStart, count]) => ({ weekStart, count })),
    });
  } catch (error) {
    console.error('Get overview trends error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
