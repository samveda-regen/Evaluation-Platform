import crypto from 'crypto';
import prisma from '../utils/db.js';
import { generateAdminToken, generateSuperAdminToken } from '../utils/jwt.js';
import { invalidateAdminSecurityCache, invalidateSuperAdminSecurityCache } from './sessionSecurity.js';

// Rotation + reuse-detection for admin/superadmin sessions, following the
// exact pattern already proven in controllers/integration.ts's recruiter
// token exchange (opaque token, SHA-256 hash column, rotate-on-refresh).
// Deliberately NOT wired into either frontend's silent-refresh flow yet —
// the existing flat-expiry login (2h admin / 30m superadmin) keeps working
// exactly as before. This gives a working, testable refresh endpoint ready
// for the frontend to adopt without touching how login/session currently
// behaves for real users today.

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export async function issueAdminRefreshToken(adminId: string, ctx: RequestContext): Promise<string> {
  const token = crypto.randomBytes(40).toString('hex');
  await prisma.authSession.create({
    data: {
      adminId,
      refreshTokenHash: hashToken(token),
      userAgent: ctx.userAgent,
      ipAddress: ctx.ip,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return token;
}

export async function issueSuperAdminRefreshToken(superAdminId: string, ctx: RequestContext): Promise<string> {
  const token = crypto.randomBytes(40).toString('hex');
  await prisma.superAdminSession.create({
    data: {
      superAdminId,
      refreshTokenHash: hashToken(token),
      userAgent: ctx.userAgent,
      ipAddress: ctx.ip,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return token;
}

type RotateResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; error: 'invalid_refresh_token' | 'refresh_token_reused' | 'account_not_found' };

export async function rotateAdminRefreshToken(oldToken: string, ctx: RequestContext): Promise<RotateResult> {
  const hash = hashToken(oldToken);
  const session = await prisma.authSession.findUnique({ where: { refreshTokenHash: hash } });
  if (!session) return { ok: false, error: 'invalid_refresh_token' };

  if (session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    // Reuse of an already-rotated token is a theft signal — kill every
    // session this admin currently holds, not just this one token.
    await prisma.admin.update({ where: { id: session.adminId }, data: { tokensValidAfter: new Date() } });
    await prisma.authSession.updateMany({
      where: { adminId: session.adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    invalidateAdminSecurityCache(session.adminId);
    return { ok: false, error: 'refresh_token_reused' };
  }

  const admin = await prisma.admin.findUnique({ where: { id: session.adminId } });
  if (!admin) return { ok: false, error: 'account_not_found' };

  const newRefreshToken = crypto.randomBytes(40).toString('hex');
  await prisma.$transaction([
    prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
    prisma.authSession.create({
      data: {
        adminId: admin.id,
        refreshTokenHash: hashToken(newRefreshToken),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    }),
  ]);

  return {
    ok: true,
    accessToken: generateAdminToken({ id: admin.id, email: admin.email, role: 'admin' }),
    refreshToken: newRefreshToken,
  };
}

export async function rotateSuperAdminRefreshToken(oldToken: string, ctx: RequestContext): Promise<RotateResult> {
  const hash = hashToken(oldToken);
  const session = await prisma.superAdminSession.findUnique({ where: { refreshTokenHash: hash } });
  if (!session) return { ok: false, error: 'invalid_refresh_token' };

  if (session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    await prisma.superAdmin.update({ where: { id: session.superAdminId }, data: { tokensValidAfter: new Date() } });
    await prisma.superAdminSession.updateMany({
      where: { superAdminId: session.superAdminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    invalidateSuperAdminSecurityCache(session.superAdminId);
    return { ok: false, error: 'refresh_token_reused' };
  }

  const superAdmin = await prisma.superAdmin.findUnique({ where: { id: session.superAdminId } });
  if (!superAdmin) return { ok: false, error: 'account_not_found' };

  const newRefreshToken = crypto.randomBytes(40).toString('hex');
  await prisma.$transaction([
    prisma.superAdminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
    prisma.superAdminSession.create({
      data: {
        superAdminId: superAdmin.id,
        refreshTokenHash: hashToken(newRefreshToken),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    }),
  ]);

  return {
    ok: true,
    accessToken: generateSuperAdminToken({
      id: superAdmin.id,
      email: superAdmin.email,
      role: 'superadmin',
      accessLevel: superAdmin.role === 'read_only' ? 'read_only' : 'full_control',
    }),
    refreshToken: newRefreshToken,
  };
}
