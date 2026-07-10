import crypto from 'crypto';
import prisma from '../utils/db.js';
import { sendAlert } from './alerting.js';
import { invalidateAdminSecurityCache, invalidateSuperAdminSecurityCache } from './sessionSecurity.js';

const MAX_FAILED_ATTEMPTS_ADMIN = 8;
const MAX_FAILED_ATTEMPTS_SUPERADMIN = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export function checkLockout(lockedUntil: Date | null): { locked: boolean; message?: string } {
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
    return { locked: true, message: `Too many failed login attempts. Try again in ${minutesLeft} minute(s).` };
  }
  return { locked: false };
}

export async function recordFailedAdminLogin(adminId: string, currentCount: number): Promise<void> {
  const newCount = currentCount + 1;
  const shouldLock = newCount >= MAX_FAILED_ATTEMPTS_ADMIN;
  await prisma.admin.update({
    where: { id: adminId },
    data: { failedLoginCount: newCount, ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } : {}) },
  });
  invalidateAdminSecurityCache(adminId);
  if (shouldLock) {
    await sendAlert({
      type: 'login_lockout',
      severity: 'warning',
      message: `Admin account locked for 15 minutes after ${newCount} failed login attempts.`,
      meta: { adminId },
      cooldownKey: adminId,
    });
  }
}

export async function resetAdminLoginLockout(adminId: string): Promise<void> {
  await prisma.admin.update({ where: { id: adminId }, data: { failedLoginCount: 0, lockedUntil: null } });
  invalidateAdminSecurityCache(adminId);
}

export async function recordFailedSuperAdminLogin(superAdminId: string, currentCount: number): Promise<void> {
  const newCount = currentCount + 1;
  const shouldLock = newCount >= MAX_FAILED_ATTEMPTS_SUPERADMIN;
  await prisma.superAdmin.update({
    where: { id: superAdminId },
    data: { failedLoginCount: newCount, ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } : {}) },
  });
  invalidateSuperAdminSecurityCache(superAdminId);
  if (shouldLock) {
    await sendAlert({
      type: 'login_lockout',
      severity: 'critical',
      message: `Superadmin account locked for 15 minutes after ${newCount} failed login attempts.`,
      meta: { superAdminId },
      cooldownKey: superAdminId,
    });
  }
}

export async function resetSuperAdminLoginLockout(superAdminId: string): Promise<void> {
  await prisma.superAdmin.update({ where: { id: superAdminId }, data: { failedLoginCount: 0, lockedUntil: null } });
  invalidateSuperAdminSecurityCache(superAdminId);
}

// Fires an alert the first time a login is seen from a UA+IP combination
// this account hasn't used before — but only for accounts with at least one
// prior recorded fingerprint, so a brand-new account's first-ever login
// doesn't trigger a "new device" alert for having no history to compare to.
export async function checkNewDeviceLogin(params: {
  ownerType: 'admin' | 'superadmin';
  ownerId: string;
  email: string;
  ip: string | undefined;
  userAgent: string | undefined;
}): Promise<void> {
  try {
    const fingerprintHash = crypto
      .createHash('sha256')
      .update(`${params.userAgent ?? 'unknown'}::${params.ip ?? 'unknown'}`)
      .digest('hex');

    const existing = await prisma.loginDeviceFingerprint.findUnique({
      where: {
        ownerType_ownerId_fingerprintHash: {
          ownerType: params.ownerType,
          ownerId: params.ownerId,
          fingerprintHash,
        },
      },
    });

    if (existing) {
      await prisma.loginDeviceFingerprint.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
      return;
    }

    const priorCount = await prisma.loginDeviceFingerprint.count({
      where: { ownerType: params.ownerType, ownerId: params.ownerId },
    });

    await prisma.loginDeviceFingerprint.create({
      data: { ownerType: params.ownerType, ownerId: params.ownerId, fingerprintHash },
    });

    if (priorCount > 0) {
      await sendAlert({
        type: 'new_device_login',
        severity: 'info',
        message: `${params.email} logged in from a new device/IP.`,
        meta: { ownerType: params.ownerType, ownerId: params.ownerId, ip: params.ip },
        cooldownKey: params.ownerId,
      });
    }
  } catch (error) {
    console.error('checkNewDeviceLogin failed (non-fatal):', error);
  }
}
