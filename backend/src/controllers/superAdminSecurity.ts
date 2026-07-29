import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import { invalidateAdminSecurityCache, invalidateSuperAdminSecurityCache } from '../services/sessionSecurity.js';
import {
  generateTotpSecret,
  getTotpOtpauthUrl,
  verifyTotpToken,
  encryptTotpSecret,
  decryptTotpSecret,
} from '../services/twoFactor.js';
import { invalidateIpAllowlistCache, isIpAllowed } from '../services/ipAllowlist.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import { createAuditLogEntry } from '../services/auditChain.js';

// ---- Force-logout ----

export async function forceLogoutAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    await prisma.admin.update({ where: { id: adminId }, data: { tokensValidAfter: new Date() } });
    invalidateAdminSecurityCache(adminId);

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'AdminSession',
      resourceId: adminId,
      after: { forcedLogoutAt: new Date().toISOString() },
    });

    emitToSuperAdminRoom('admin-force-logout', { adminId });
    res.json({ message: `${admin.email} has been logged out of every active session.` });
  } catch (error) {
    console.error('Force logout admin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function forceLogoutSuperAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { superAdminId } = req.params;
    const target = await prisma.superAdmin.findUnique({ where: { id: superAdminId } });
    if (!target) {
      res.status(404).json({ error: 'Superadmin not found' });
      return;
    }

    await prisma.superAdmin.update({ where: { id: superAdminId }, data: { tokensValidAfter: new Date() } });
    invalidateSuperAdminSecurityCache(superAdminId);

    res.json({ message: `${target.email} has been logged out of every active session.` });
  } catch (error) {
    console.error('Force logout superadmin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---- TOTP 2FA (acts on the caller's own superadmin account) ----

export async function setupTotp(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const superAdmin = await prisma.superAdmin.findUnique({ where: { id: req.superAdmin!.id } });
    if (!superAdmin) {
      res.status(404).json({ error: 'Superadmin not found' });
      return;
    }
    if (superAdmin.totpEnabled) {
      res.status(409).json({ error: '2FA is already enabled. Disable it first to re-enroll.' });
      return;
    }

    const secret = generateTotpSecret();
    await prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: { totpSecret: encryptTotpSecret(secret) },
    });

    res.json({ secret, otpauthUrl: getTotpOtpauthUrl(superAdmin.email, secret) });
  } catch (error) {
    console.error('Setup TOTP error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function verifyTotpSetup(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { token } = req.body as { token?: string };
    const superAdmin = await prisma.superAdmin.findUnique({ where: { id: req.superAdmin!.id } });
    if (!superAdmin?.totpSecret) {
      res.status(400).json({ error: 'Call setup before verifying.' });
      return;
    }

    const secret = decryptTotpSecret(superAdmin.totpSecret);
    if (!token || !verifyTotpToken(secret, token)) {
      res.status(401).json({ error: 'Invalid authentication code' });
      return;
    }

    await prisma.superAdmin.update({ where: { id: superAdmin.id }, data: { totpEnabled: true } });
    res.json({ message: 'Two-factor authentication enabled.' });
  } catch (error) {
    console.error('Verify TOTP setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function disableTotp(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { token } = req.body as { token?: string };
    const superAdmin = await prisma.superAdmin.findUnique({ where: { id: req.superAdmin!.id } });
    if (!superAdmin?.totpEnabled || !superAdmin.totpSecret) {
      res.status(400).json({ error: '2FA is not enabled.' });
      return;
    }

    const secret = decryptTotpSecret(superAdmin.totpSecret);
    if (!token || !verifyTotpToken(secret, token)) {
      res.status(401).json({ error: 'Invalid authentication code' });
      return;
    }

    await prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    res.json({ message: 'Two-factor authentication disabled.' });
  } catch (error) {
    console.error('Disable TOTP error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---- IP allowlist ----

export async function listIpAllowlist(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const [entries, settings] = await Promise.all([
      prisma.superAdminIpAllowlistEntry.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.securitySettings.upsert({ where: { key: 'global' }, update: {}, create: { key: 'global' } }),
    ]);
    res.json({ entries, ipAllowlistEnabled: settings.ipAllowlistEnabled });
  } catch (error) {
    console.error('List IP allowlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function addIpAllowlistEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { cidrOrIp, label } = req.body as { cidrOrIp?: string; label?: string };
    if (!cidrOrIp) {
      res.status(400).json({ error: '"cidrOrIp" is required' });
      return;
    }

    const entry = await prisma.superAdminIpAllowlistEntry.create({
      data: { cidrOrIp: cidrOrIp.trim(), label: label ?? null, createdByEmail: req.superAdmin!.email },
    });
    invalidateIpAllowlistCache();
    res.status(201).json({ entry });
  } catch (error) {
    console.error('Add IP allowlist entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteIpAllowlistEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { entryId } = req.params;
    await prisma.superAdminIpAllowlistEntry.delete({ where: { id: entryId } });
    invalidateIpAllowlistCache();
    res.json({ message: 'Entry removed' });
  } catch (error) {
    console.error('Delete IP allowlist entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function toggleIpAllowlist(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '"enabled" must be a boolean' });
      return;
    }

    if (enabled) {
      const callerIp = req.ip || '';
      const allowed = await isIpAllowed(callerIp);
      if (!allowed) {
        res.status(409).json({
          error: `Refusing to enable — your current IP (${callerIp}) is not on the allowlist yet. Add it first.`,
        });
        return;
      }
    }

    const settings = await prisma.securitySettings.upsert({
      where: { key: 'global' },
      update: { ipAllowlistEnabled: enabled, updatedByEmail: req.superAdmin!.email },
      create: { key: 'global', ipAllowlistEnabled: enabled, updatedByEmail: req.superAdmin!.email },
    });
    invalidateIpAllowlistCache();
    res.json({ ipAllowlistEnabled: settings.ipAllowlistEnabled });
  } catch (error) {
    console.error('Toggle IP allowlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---- Superadmin team management (sub-roles) ----

export async function listSuperAdmins(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const superAdmins = await prisma.superAdmin.findMany({
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true, totpEnabled: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ superAdmins });
  } catch (error) {
    console.error('List superadmins error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createSuperAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, password, name, role } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      role?: string;
    };

    if (!email || !password || !name) {
      res.status(400).json({ error: 'email, password, and name are required' });
      return;
    }
    if (password.length < 12) {
      res.status(400).json({ error: 'Password must be at least 12 characters' });
      return;
    }

    const existing = await prisma.superAdmin.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      res.status(409).json({ error: 'A superadmin with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const created = await prisma.superAdmin.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        role: role === 'read_only' ? 'read_only' : 'full_control',
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'create',
      resourceType: 'SuperAdmin',
      resourceId: created.id,
      after: created,
    });

    res.status(201).json({ superAdmin: created });
  } catch (error) {
    console.error('Create superadmin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteSuperAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { superAdminId } = req.params;
    if (superAdminId === req.superAdmin!.id) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    const remaining = await prisma.superAdmin.count();
    if (remaining <= 1) {
      res.status(409).json({ error: 'Cannot delete the last remaining superadmin account' });
      return;
    }

    const target = await prisma.superAdmin.delete({ where: { id: superAdminId } });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'delete',
      resourceType: 'SuperAdmin',
      resourceId: superAdminId,
      before: { email: target.email, name: target.name, role: target.role },
    });

    res.json({ message: `${target.email} removed` });
  } catch (error) {
    console.error('Delete superadmin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Reverses a securityLocked lock — either manually applied or set by the
// anomaly auto-lock job. Distinct from AdminBilling.status='suspended',
// which only blocks billed actions rather than the whole account.
export async function unlockAdminSecurity(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    await prisma.admin.update({
      where: { id: adminId },
      data: { securityLocked: false, securityLockReason: null, securityLockedAt: null },
    });
    invalidateAdminSecurityCache(adminId);

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'AdminSecurity',
      resourceId: adminId,
      before: { securityLocked: true, reason: admin.securityLockReason },
      after: { securityLocked: false },
    });

    res.json({ message: `${admin.email} has been unlocked.` });
  } catch (error) {
    console.error('Unlock admin security error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
