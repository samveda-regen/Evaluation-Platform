import { Response } from 'express';
import { randomBytes } from 'crypto';

import type { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { encryptSecret } from '../utils/secretEncryption.js';

export async function createIntegrationPartner(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const name = typeof req.body.name === 'string' ? sanitizeInput(req.body.name).trim() : '';
    const slug = typeof req.body.slug === 'string' ? sanitizeInput(req.body.slug).trim().toLowerCase() : '';
    const jwtIssuer = typeof req.body.jwtIssuer === 'string' ? req.body.jwtIssuer.trim() : undefined;
    const jwtAudience = typeof req.body.jwtAudience === 'string' ? req.body.jwtAudience.trim() : undefined;

    if (!name || !slug) {
      res.status(400).json({ error: 'name and slug are required' });
      return;
    }

    const jwtSecret = randomBytes(32).toString('hex');

    const partner = await prisma.integrationPartner.create({
      data: { name, slug, jwtSecret: encryptSecret(jwtSecret), jwtIssuer, jwtAudience },
    });

    res.status(201).json({
      id: partner.id,
      name: partner.name,
      slug: partner.slug,
      jwtIssuer: partner.jwtIssuer,
      jwtAudience: partner.jwtAudience,
      // Returned once, at creation time only — only the encrypted form is stored,
      // so this plaintext value can't be retrieved again after this response.
      jwtSecret,
    });
  } catch (error) {
    console.error('Create integration partner error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function listIntegrationPartners(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const partners = await prisma.integrationPartner.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        jwtIssuer: true,
        jwtAudience: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json({ partners });
  } catch (error) {
    console.error('List integration partners error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setIntegrationPartnerActive(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { partnerId } = req.params;
    const isActive = req.body.isActive !== false;

    const partner = await prisma.integrationPartner.update({
      where: { id: partnerId },
      data: { isActive },
      select: { id: true, name: true, slug: true, isActive: true },
    });

    res.json({ partner });
  } catch (error) {
    console.error('Update integration partner error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
