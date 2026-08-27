import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken } from '../utils/jwt.js';
import { resolvePartnerForToken } from '../services/integrationPartnerService.js';
import { getAdminSecurityState, getSuperAdminSecurityState } from '../services/sessionSecurity.js';
import { isFeatureEnabledForAdmin } from './featureLock.js';
import {
  AuthenticatedRequest,
  AdminPayload,
  CandidatePayload,
  IntegrationPayload,
  SuperAdminPayload,
} from '../types/index.js';

type RecruiterJwtPayload = jwt.JwtPayload & {
  sub?: string;
  email?: string;
  role?: string;
  companyId?: string;
  company_id?: string;
  scopes?: string[];
};

function getCompanyClaim(payload: RecruiterJwtPayload): string {
  const companyId = typeof payload.companyId === 'string' ? payload.companyId.trim() : '';
  const snakeCaseCompanyId = typeof payload.company_id === 'string' ? payload.company_id.trim() : '';
  return companyId || snakeCaseCompanyId;
}

function parseScopesFromRecruiterPayload(payload: RecruiterJwtPayload): string[] {
  if (Array.isArray(payload.scopes) && payload.scopes.every((scope) => typeof scope === 'string')) {
    return payload.scopes;
  }

  const role = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : '';
  if (role === 'recruiter_user') {
    return ['tests:read', 'results:read'];
  }

  if (role === 'admin' || role === 'recruiter_admin') {
    return ['tests:read', 'invites:write', 'results:read'];
  }

  return [];
}

async function verifyRecruiterAccessToken(token: string): Promise<IntegrationPayload | null> {
  const partner = await resolvePartnerForToken(token);
  if (!partner) {
    return null;
  }

  try {
    const payload = jwt.verify(token, partner.secret, {
      issuer: partner.issuer || undefined,
      audience: partner.audience || undefined,
    }) as RecruiterJwtPayload;

    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const companyId = getCompanyClaim(payload);
    const scopes = parseScopesFromRecruiterPayload(payload);

    if (!subject || !companyId || scopes.length === 0) {
      return null;
    }

    return {
      id: subject,
      email,
      role: 'integration_admin',
      companyId,
      scopes,
    };
  } catch {
    return null;
  }
}

export async function adminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload || payload.role !== 'admin') {
    res.status(401).json({ error: 'Invalid or expired admin token' });
    return;
  }

  const adminPayload = payload as AdminPayload;

  // Defense-in-depth on top of the signature/expiry check above, which
  // remains the primary and always-enforced boundary. A failure looking up
  // this extra state (e.g. a transient DB hiccup) fails OPEN — it must
  // never turn a DB blip into a platform-wide admin outage.
  try {
    const state = await getAdminSecurityState(adminPayload.id);
    if (state.tokensValidAfter && (adminPayload.iat ?? 0) * 1000 < state.tokensValidAfter) {
      res.status(401).json({ error: 'session_revoked', message: 'Your session was revoked. Please log in again.' });
      return;
    }
    if (state.securityLocked) {
      res.status(403).json({
        error: 'account_locked',
        message: `Your account has been locked${state.securityLockReason ? `: ${state.securityLockReason}` : ''}.`,
      });
      return;
    }
    // Platform-wide switch (no adminId — see superAdminFeatureFlags.ts DEFAULT_FEATURE_FLAGS),
    // admin-console only: candidate routes never check this. Same 423/feature_locked shape as
    // requireFeatureEnabled() so the existing frontend toast handling picks it up for free.
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
    console.error('adminAuth security-state check failed, failing open:', error);
  }

  req.admin = adminPayload;
  next();
}

export async function superAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload || payload.role !== 'superadmin') {
    res.status(401).json({ error: 'Invalid or expired superadmin token' });
    return;
  }

  const superAdminPayload = payload as SuperAdminPayload;

  try {
    const state = await getSuperAdminSecurityState(superAdminPayload.id);
    if (state.tokensValidAfter && (superAdminPayload.iat ?? 0) * 1000 < state.tokensValidAfter) {
      res.status(401).json({ error: 'session_revoked', message: 'Your session was revoked. Please log in again.' });
      return;
    }
  } catch (error) {
    console.error('superAdminAuth security-state check failed, failing open:', error);
  }

  req.superAdmin = superAdminPayload;
  next();
}

// Applied per-route after superAdminAuth, on mutating endpoints only.
// read_only superadmins can hit every GET route freely (nothing here gates
// reads) but are rejected from anything that changes state.
export function requireFullControl(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.superAdmin?.accessLevel === 'read_only') {
    res.status(403).json({
      error: 'read_only_superadmin',
      message: 'Your superadmin account is read-only and cannot perform this action.',
    });
    return;
  }
  next();
}

export function candidateAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload || payload.role !== 'candidate') {
    res.status(401).json({ error: 'Invalid or expired candidate token' });
    return;
  }

  req.candidate = payload as CandidatePayload;
  next();
}

export async function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);

    if (payload) {
      if (payload.role === 'admin') {
        req.admin = payload as AdminPayload;
      } else if (payload.role === 'candidate') {
        req.candidate = payload as CandidatePayload;
      } else if (payload.role === 'integration_admin') {
        req.integration = payload as IntegrationPayload;
      }
    } else {
      const recruiterPayload = await verifyRecruiterAccessToken(token);
      if (recruiterPayload) {
        req.integration = recruiterPayload;
      }
    }
  }

  next();
}

export async function integrationAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (payload && payload.role === 'integration_admin') {
    req.integration = payload as IntegrationPayload;
    next();
    return;
  }

  const recruiterPayload = await verifyRecruiterAccessToken(token);
  if (recruiterPayload) {
    req.integration = recruiterPayload;
    next();
    return;
  }

  res.status(401).json({
    error: 'Invalid or expired integration token'
  });
}

export function requireIntegrationScopes(scopes: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const grantedScopes = new Set(req.integration?.scopes ?? []);
    const missingScope = scopes.find((scope) => !grantedScopes.has(scope));

    if (missingScope) {
      res.status(403).json({
        error: 'insufficient_scope',
        message: `Missing required scope: ${missingScope}`
      });
      return;
    }

    next();
  };
}

export function integrationApiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const apiKey = process.env.INTEGRATION_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Integration not configured on this server' });
    return;
  }
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }
  next();
}

export function integrationAuthStrictExamToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload || payload.role !== 'integration_admin') {
    res.status(401).json({ error: 'Invalid or expired integration token' });
    return;
  }

  req.integration = payload as IntegrationPayload;
  next();
}
