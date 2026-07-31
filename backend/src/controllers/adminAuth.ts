import { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateAdminToken } from '../utils/jwt.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { sendAdminWelcomeEmail, sendAdminPasswordResetEmail } from '../services/emailService.js';
import prisma from '../utils/db.js';

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
      role: 'admin'
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

    const token = generateAdminToken({ id: admin.id, email: admin.email, role: 'admin' });

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

export async function loginAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    const sanitizedEmail = sanitizeInput(email).toLowerCase();

    // Find admin with company
    const admin = await prisma.admin.findUnique({
      where: { email: sanitizedEmail },
      include: { company: true }
    });

    if (!admin) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateAdminToken({
      id: admin.id,
      email: admin.email,
      role: 'admin'
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
      token
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
          company: { select: { name: true, externalCompanyId: true } },
        },
      });
    });

    res.json({
      admin: {
        ...admin,
        companyName: admin.company?.name ?? null,
        companyExternalId: admin.company?.externalCompanyId ?? null,
      }
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
