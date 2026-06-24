import { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateAdminToken } from '../utils/jwt.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { sendAdminWelcomeEmail } from '../services/emailService.js';
import prisma from '../utils/db.js';

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

    const frontendUrl = process.env.FRONTEND_URL || 'https://humint.talentsatq.ai';
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
