import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { generateSuperAdminToken } from '../utils/jwt.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import prisma from '../utils/db.js';
import {
  checkLockout,
  recordFailedSuperAdminLogin,
  resetSuperAdminLoginLockout,
  checkNewDeviceLogin,
} from '../services/loginSecurity.js';
import { verifyTotpToken, decryptTotpSecret } from '../services/twoFactor.js';
import { isIpAllowed } from '../services/ipAllowlist.js';
import { sendAlert } from '../services/alerting.js';
import { issueSuperAdminRefreshToken, rotateSuperAdminRefreshToken } from '../services/refreshTokens.js';

async function isIpAllowlistEnabled(): Promise<boolean> {
  const settings = await prisma.securitySettings.findUnique({ where: { key: 'global' } });
  return settings?.ipAllowlistEnabled ?? false;
}

export async function loginSuperAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, password, totpCode } = req.body as { email?: string; password?: string; totpCode?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const requestIp = req.ip || 'unknown';

    if (await isIpAllowlistEnabled()) {
      const allowed = await isIpAllowed(requestIp);
      if (!allowed) {
        await sendAlert({
          type: 'superadmin_ip_blocked',
          severity: 'critical',
          message: `Superadmin login blocked — ${requestIp} is not on the IP allowlist.`,
          meta: { email: sanitizedEmail, ip: requestIp },
          cooldownKey: requestIp,
        });
        res.status(403).json({ error: 'Login is not permitted from this network.' });
        return;
      }
    }

    const superAdmin = await prisma.superAdmin.findUnique({ where: { email: sanitizedEmail } });

    if (!superAdmin) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const lockout = checkLockout(superAdmin.lockedUntil);
    if (lockout.locked) {
      res.status(423).json({ error: lockout.message });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, superAdmin.password);
    if (!isValidPassword) {
      await recordFailedSuperAdminLogin(superAdmin.id, superAdmin.failedLoginCount);
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (superAdmin.totpEnabled) {
      if (!totpCode) {
        res.json({ requiresTotp: true });
        return;
      }
      const secret = decryptTotpSecret(superAdmin.totpSecret!);
      if (!verifyTotpToken(secret, totpCode)) {
        await recordFailedSuperAdminLogin(superAdmin.id, superAdmin.failedLoginCount);
        res.status(401).json({ error: 'Invalid authentication code' });
        return;
      }
    }

    await resetSuperAdminLoginLockout(superAdmin.id);
    void checkNewDeviceLogin({
      ownerType: 'superadmin',
      ownerId: superAdmin.id,
      email: superAdmin.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const token = generateSuperAdminToken({
      id: superAdmin.id,
      email: superAdmin.email,
      role: 'superadmin',
      accessLevel: superAdmin.role === 'read_only' ? 'read_only' : 'full_control',
    });
    const refreshToken = await issueSuperAdminRefreshToken(superAdmin.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    await prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: { lastLoginAt: new Date() },
    });

    res.json({
      message: 'Login successful',
      superAdmin: {
        id: superAdmin.id,
        email: superAdmin.email,
        name: superAdmin.name,
        role: superAdmin.role,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error('Superadmin login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Not currently called by the superadmin frontend — available for future
// adoption. See adminAuth.ts's refreshAdminToken for the identical pattern.
export async function refreshSuperAdminToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      res.status(400).json({ error: '"refreshToken" is required' });
      return;
    }

    const result = await rotateSuperAdminRefreshToken(refreshToken, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }

    res.json({ token: result.accessToken, refreshToken: result.refreshToken });
  } catch (error) {
    console.error('Refresh superadmin token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSuperAdminProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const superAdmin = await prisma.superAdmin.findUnique({ where: { id: req.superAdmin!.id } });

    if (!superAdmin) {
      res.status(404).json({ error: 'Superadmin not found' });
      return;
    }

    res.json({
      superAdmin: {
        id: superAdmin.id,
        email: superAdmin.email,
        name: superAdmin.name,
        lastLoginAt: superAdmin.lastLoginAt,
        role: superAdmin.role,
        totpEnabled: superAdmin.totpEnabled,
      },
    });
  } catch (error) {
    console.error('Get superadmin profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
