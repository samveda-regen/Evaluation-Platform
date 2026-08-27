import { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateAdminToken } from '../utils/jwt.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { sendAdminWelcomeEmail, sendAdminPasswordResetEmail } from '../services/emailService.js';
import prisma from '../utils/db.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import {
  checkLockout,
  recordFailedAdminLogin,
  resetAdminLoginLockout,
  checkNewDeviceLogin,
} from '../services/loginSecurity.js';
import { issueAdminRefreshToken, rotateAdminRefreshToken } from '../services/refreshTokens.js';
import { isFeatureEnabledForAdmin } from '../middleware/featureLock.js';

// The global adminActionLogger middleware only sees `req.admin`, which is
// never set for a login request (there's no valid token yet) — so login
// attempts, successful or failed, are logged explicitly here instead.
async function logLoginAttempt(params: {
  outcome: 'success' | 'failure';
  attemptedEmail: string;
  adminId?: string;
  adminName?: string;
  statusCode: number;
}): Promise<void> {
  try {
    const row = await prisma.adminActionLog.create({
      data: {
        adminId: params.adminId ?? null,
        adminEmail: params.attemptedEmail,
        adminName: params.adminName ?? params.attemptedEmail,
        method: 'POST',
        path: `/api/admin/login (${params.outcome})`,
        statusCode: params.statusCode,
        durationMs: 0,
      },
    });
    emitToSuperAdminRoom('admin-action', row);
  } catch (error) {
    console.error('Failed to log admin login attempt:', error);
  }
}

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || 'https://humint.talentsatq.ai').replace(/\/+$/, '');
}

export async function registerAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, password, name, companyName, companyId } = req.body;

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedName = sanitizeInput(name);

    // Check if admin already exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { email: sanitizedEmail }
    });

    if (existingAdmin) {
      res.status(400).json({ error: 'Admin with this email already exists' });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Upsert company if both fields provided
    let companyRecord: { id: string; name: string; externalCompanyId: string } | null = null;
    if (companyId && companyName) {
      companyRecord = await prisma.company.upsert({
        where: { externalCompanyId: sanitizeInput(companyId) },
        create: {
          externalCompanyId: sanitizeInput(companyId),
          name: sanitizeInput(companyName),
        },
        update: {
          name: sanitizeInput(companyName),
        },
      });
    }

    // Create admin
    const admin = await prisma.admin.create({
      data: {
        email: sanitizedEmail,
        password: hashedPassword,
        name: sanitizedName,
        ...(companyRecord ? { companyId: companyRecord.id } : {}),
      }
    });

    const token = generateAdminToken({
      id: admin.id,
      email: admin.email,
      role: 'admin',
      companyId: admin.companyId
    });

    res.status(201).json({
      message: 'Admin registered successfully',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        companyName: companyRecord?.name ?? null,
        companyExternalId: companyRecord?.externalCompanyId ?? null,
      },
      token
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function registerAdminFromIntegration(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, name, companyName, companyId } = req.body;
    const rawPassword: string = req.body.password || crypto.randomBytes(12).toString('base64url');

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedName = sanitizeInput(name);

    const existingAdmin = await prisma.admin.findUnique({ where: { email: sanitizedEmail } });
    if (existingAdmin) {
      res.status(400).json({ error: 'Admin with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    let companyRecord: { id: string; name: string; externalCompanyId: string } | null = null;
    if (companyId && companyName) {
      companyRecord = await prisma.company.upsert({
        where: { externalCompanyId: sanitizeInput(companyId) },
        create: { externalCompanyId: sanitizeInput(companyId), name: sanitizeInput(companyName) },
        update: { name: sanitizeInput(companyName) },
      });
    }

    const admin = await prisma.admin.create({
      data: {
        email: sanitizedEmail,
        password: hashedPassword,
        name: sanitizedName,
        ...(companyRecord ? { companyId: companyRecord.id } : {}),
      },
    });

    const frontendUrl = getFrontendUrl();
    try {
      await sendAdminWelcomeEmail({
        to: sanitizedEmail,
        name: sanitizedName,
        password: rawPassword,
        loginUrl: `${frontendUrl}/admin/login`,
        companyName: companyRecord?.name,
      });
    } catch (emailError) {
      console.error('Welcome email failed (account still created):', emailError);
    }

    const token = generateAdminToken({ id: admin.id, email: admin.email, role: 'admin', companyId: admin.companyId });

    res.status(201).json({
      message: 'Admin registered successfully. Welcome email sent.',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        companyName: companyRecord?.name ?? null,
        companyExternalId: companyRecord?.externalCompanyId ?? null,
      },
      token,
    });
  } catch (error) {
    console.error('Integration admin registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Public, unauthenticated status check so the admin frontend can show a full
// maintenance page (on the login screen and for already-logged-in admins)
// without waiting for an authenticated request to fail with 423 first.
export async function getMaintenanceStatus(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const maintenanceEnabled = await isFeatureEnabledForAdmin('maintenance_mode');
    res.json({
      active: !maintenanceEnabled,
      message: 'The platform is temporarily down for maintenance. Please try again shortly.',
    });
  } catch (error) {
    console.error('getMaintenanceStatus check failed, failing open:', error);
    res.json({ active: false, message: '' });
  }
}

export async function loginAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    // Checked before the credential lookup so a maintenance window doesn't leak
    // whether an email exists. Own try/catch to fail open, same as elsewhere
    // maintenance_mode is checked (middleware/auth.ts) — a transient DB hiccup
    // here must never lock every admin out of logging in.
    try {
      const maintenanceEnabled = await isFeatureEnabledForAdmin('maintenance_mode');
      if (!maintenanceEnabled) {
        res.status(423).json({
          error: 'feature_locked',
          feature: 'maintenance_mode',
          message: 'The platform is temporarily down for maintenance. Please try again shortly.',
        });
        return;
      }
    } catch (error) {
      console.error('loginAdmin maintenance-mode check failed, failing open:', error);
    }

    const { email, password } = req.body;

    const sanitizedEmail = sanitizeInput(email).toLowerCase();

    // Find admin with company
    const admin = await prisma.admin.findUnique({
      where: { email: sanitizedEmail },
      include: { company: true }
    });

    if (!admin) {
      await logLoginAttempt({ outcome: 'failure', attemptedEmail: sanitizedEmail, statusCode: 401 });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const lockout = checkLockout(admin.lockedUntil);
    if (lockout.locked) {
      await logLoginAttempt({
        outcome: 'failure',
        attemptedEmail: sanitizedEmail,
        adminId: admin.id,
        adminName: admin.name,
        statusCode: 423,
      });
      res.status(423).json({ error: lockout.message });
      return;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      await recordFailedAdminLogin(admin.id, admin.failedLoginCount);
      await logLoginAttempt({
        outcome: 'failure',
        attemptedEmail: sanitizedEmail,
        adminId: admin.id,
        adminName: admin.name,
        statusCode: 401,
      });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    await resetAdminLoginLockout(admin.id);
    void checkNewDeviceLogin({
      ownerType: 'admin',
      ownerId: admin.id,
      email: admin.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const token = generateAdminToken({
      id: admin.id,
      email: admin.email,
      role: 'admin',
      companyId: admin.companyId
    });
    const refreshToken = await issueAdminRefreshToken(admin.id, { ip: req.ip, userAgent: req.headers['user-agent'] });

    await logLoginAttempt({
      outcome: 'success',
      attemptedEmail: sanitizedEmail,
      adminId: admin.id,
      adminName: admin.name,
      statusCode: 200,
    });

    res.json({
      message: 'Login successful',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        companyName: admin.company?.name ?? null,
        companyExternalId: admin.company?.externalCompanyId ?? null,
      },
      token,
      refreshToken
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAdminProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin!.id },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        company: { select: { name: true, externalCompanyId: true } },
        _count: {
          select: { tests: true }
        }
      }
    });

    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    res.json({
      admin: {
        ...admin,
        companyName: admin.company?.name ?? null,
        companyExternalId: admin.company?.externalCompanyId ?? null,
      }
    });
  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateAdminProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const admin = await prisma.admin.update({
      where: { id: req.admin!.id },
      data: { name: sanitizeInput(name.trim()) },
      select: {
        id: true,
        email: true,
        name: true,
        company: { select: { name: true, externalCompanyId: true } },
      },
    });

    res.json({
      admin: {
        ...admin,
        companyName: admin.company?.name ?? null,
        companyExternalId: admin.company?.externalCompanyId ?? null,
      }
    });
  } catch (error) {
    console.error('Update admin profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateAdminCompany(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { companyName, companyId } = req.body;

    const sanitizedName = sanitizeInput(String(companyName ?? '').trim());
    const sanitizedExternalId = sanitizeInput(String(companyId ?? '').trim());

    if (!sanitizedName || !sanitizedExternalId) {
      res.status(400).json({ error: 'Company name and Company ID are required' });
      return;
    }

    // Only new companies get their name set here; if the Company ID already
    // belongs to an existing company we link to it as-is rather than letting
    // one admin's typo rename a company shared by other admins.
    const admin = await prisma.$transaction(async (tx) => {
      const companyRecord = await tx.company.upsert({
        where: { externalCompanyId: sanitizedExternalId },
        create: { externalCompanyId: sanitizedExternalId, name: sanitizedName },
        update: {},
      });

      return tx.admin.update({
        where: { id: req.admin!.id },
        data: { companyId: companyRecord.id },
        select: {
          id: true,
          email: true,
          name: true,
          companyId: true,
          company: { select: { name: true, externalCompanyId: true } },
        },
      });
    });

    // Re-sign the token with the new companyId so company-scoped test
    // visibility applies immediately, without requiring a re-login.
    const token = generateAdminToken({
      id: admin.id,
      email: admin.email,
      role: 'admin',
      companyId: admin.companyId
    });

    res.json({
      admin: {
        ...admin,
        companyName: admin.company?.name ?? null,
        companyExternalId: admin.company?.externalCompanyId ?? null,
      },
      token
    });
  } catch (error) {
    console.error('Update admin company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function changeAdminPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Both current and new password are required' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const admin = await prisma.admin.findUnique({ where: { id: req.admin!.id } });
    if (!admin) { res.status(404).json({ error: 'Admin not found' }); return; }

    const valid = await bcrypt.compare(currentPassword, admin.password);
    if (!valid) { res.status(401).json({ error: 'Current password is incorrect' }); return; }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.admin.update({ where: { id: admin.id }, data: { password: hashed } });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change admin password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

const RESET_TOKEN_TTL_MINUTES = 30;
const GENERIC_FORGOT_PASSWORD_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

export async function forgotPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email } = req.body;
    const sanitizedEmail = sanitizeInput(String(email ?? '')).toLowerCase();

    const admin = await prisma.admin.findUnique({ where: { email: sanitizedEmail } });

    // Always respond the same way whether or not the account exists, so this
    // endpoint can't be used to enumerate registered admin emails.
    if (admin) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

      await prisma.admin.update({
        where: { id: admin.id },
        data: { resetPasswordTokenHash: tokenHash, resetPasswordExpiresAt: expiresAt }
      });

      const frontendUrl = getFrontendUrl();
      const resetUrl = `${frontendUrl}/admin/reset-password?token=${rawToken}`;

      try {
        await sendAdminPasswordResetEmail({
          to: admin.email,
          name: admin.name,
          resetUrl,
          expiresInMinutes: RESET_TOKEN_TTL_MINUTES
        });
      } catch (emailError) {
        console.error('Password reset email failed to send:', emailError);
      }
    }

    res.json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function resetPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { token, newPassword } = req.body;

    if (typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ error: 'Reset token is required' });
      return;
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const admin = await prisma.admin.findFirst({
      where: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { gt: new Date() }
      }
    });

    if (!admin) {
      res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        password: hashedPassword,
        resetPasswordTokenHash: null,
        resetPasswordExpiresAt: null
      }
    });

    res.json({ message: 'Password reset successful. You can now log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Not currently called by either frontend — available for future adoption
// (see refreshTokens.ts). Exchanges a refresh token for a fresh access
// token, rotating it; reuse of an already-rotated token revokes every
// session this admin currently holds.
export async function refreshAdminToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      res.status(400).json({ error: '"refreshToken" is required' });
      return;
    }

    const result = await rotateAdminRefreshToken(refreshToken, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }

    res.json({ token: result.accessToken, refreshToken: result.refreshToken });
  } catch (error) {
    console.error('Refresh admin token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
