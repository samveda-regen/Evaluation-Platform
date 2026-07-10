import prisma from '../utils/db.js';

// Per-request state used by adminAuth/superAdminAuth to reject an
// otherwise-valid (correctly signed, unexpired) JWT — force-logout and
// security locks. Cached briefly per subject since this runs on every
// authenticated admin/superadmin request, including high-frequency
// proctoring-adjacent admin screens.
const CACHE_TTL_MS = 5 * 1000;

interface AdminSecurityState {
  tokensValidAfter: number | null; // epoch ms
  securityLocked: boolean;
  securityLockReason: string | null;
}

interface SuperAdminSecurityState {
  tokensValidAfter: number | null;
}

const adminCache = new Map<string, { state: AdminSecurityState; expiresAt: number }>();
const superAdminCache = new Map<string, { state: SuperAdminSecurityState; expiresAt: number }>();

export function invalidateAdminSecurityCache(adminId?: string): void {
  if (adminId) adminCache.delete(adminId);
  else adminCache.clear();
}

export function invalidateSuperAdminSecurityCache(superAdminId?: string): void {
  if (superAdminId) superAdminCache.delete(superAdminId);
  else superAdminCache.clear();
}

export async function getAdminSecurityState(adminId: string): Promise<AdminSecurityState> {
  const cached = adminCache.get(adminId);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { tokensValidAfter: true, securityLocked: true, securityLockReason: true },
  });

  const state: AdminSecurityState = {
    tokensValidAfter: admin?.tokensValidAfter ? admin.tokensValidAfter.getTime() : null,
    securityLocked: admin?.securityLocked ?? false,
    securityLockReason: admin?.securityLockReason ?? null,
  };
  adminCache.set(adminId, { state, expiresAt: Date.now() + CACHE_TTL_MS });
  return state;
}

export async function getSuperAdminSecurityState(superAdminId: string): Promise<SuperAdminSecurityState> {
  const cached = superAdminCache.get(superAdminId);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const superAdmin = await prisma.superAdmin.findUnique({
    where: { id: superAdminId },
    select: { tokensValidAfter: true },
  });

  const state: SuperAdminSecurityState = {
    tokensValidAfter: superAdmin?.tokensValidAfter ? superAdmin.tokensValidAfter.getTime() : null,
  };
  superAdminCache.set(superAdminId, { state, expiresAt: Date.now() + CACHE_TTL_MS });
  return state;
}
