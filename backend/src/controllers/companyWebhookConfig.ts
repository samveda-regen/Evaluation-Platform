import { Response } from 'express';
import { randomBytes } from 'crypto';

import type { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { encryptSecret } from '../utils/secretEncryption.js';
import { resolveInternalCompanyId } from './integration.js';

export async function setCompanyWebhook(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const companyId = await resolveInternalCompanyId(req.integration!.companyId);
    if (!companyId) {
      res.status(403).json({ error: 'forbidden_company_scope', message: 'Unknown company scope' });
      return;
    }

    const webhookUrl = typeof req.body.webhookUrl === 'string' ? sanitizeInput(req.body.webhookUrl).trim() : '';
    if (!webhookUrl) {
      res.status(400).json({ error: 'webhookUrl is required' });
      return;
    }

    try {
      const parsed = new URL(webhookUrl);
      if (parsed.protocol !== 'https:') {
        res.status(400).json({ error: 'webhookUrl must use https://' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'webhookUrl is not a valid URL' });
      return;
    }

    const webhookSecret = randomBytes(32).toString('hex');

    await prisma.company.update({
      where: { id: companyId },
      data: { webhookUrl, webhookSecret: encryptSecret(webhookSecret) },
    });

    res.json({
      webhookUrl,
      // Returned once, at configuration time only — only the encrypted form is
      // stored, so this plaintext value can't be retrieved again after this response.
      webhookSecret,
    });
  } catch (error) {
    console.error('Set company webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCompanyWebhookStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const companyId = await resolveInternalCompanyId(req.integration!.companyId);
    if (!companyId) {
      res.status(403).json({ error: 'forbidden_company_scope', message: 'Unknown company scope' });
      return;
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { webhookUrl: true },
    });

    res.json({ configured: !!company?.webhookUrl, webhookUrl: company?.webhookUrl ?? null });
  } catch (error) {
    console.error('Get company webhook status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function clearCompanyWebhook(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const companyId = await resolveInternalCompanyId(req.integration!.companyId);
    if (!companyId) {
      res.status(403).json({ error: 'forbidden_company_scope', message: 'Unknown company scope' });
      return;
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { webhookUrl: null, webhookSecret: null },
    });

    res.json({ message: 'Webhook configuration removed' });
  } catch (error) {
    console.error('Clear company webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
