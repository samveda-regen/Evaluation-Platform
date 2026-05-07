import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken } from '../utils/jwt.js';
import { AuthenticatedRequest, AdminPayload, CandidatePayload, IntegrationPayload } from '../types/index.js';

type RecruiterJwtPayload = jwt.JwtPayload & {
  sub?: string;
  email?: string;
  role?: string;
  companyId?: string;
  company_id?: string;
  scopes?: string[];
};

const RECRUITER_JWT_SECRET = process.env.RECRUITER_JWT_SECRET || '';
const RECRUITER_JWT_ISSUER = process.env.RECRUITER_JWT_ISSUER || '';
const RECRUITER_JWT_AUDIENCE = process.env.RECRUITER_JWT_AUDIENCE || '';

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

function verifyRecruiterAccessToken(token: string): IntegrationPayload | null {
  if (!RECRUITER_JWT_SECRET) {
    return null;
  }

  try {
    const payload = jwt.verify(token, RECRUITER_JWT_SECRET, {
      issuer: RECRUITER_JWT_ISSUER || undefined,
      audience: RECRUITER_JWT_AUDIENCE || undefined,
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

export function adminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
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

  req.admin = payload as AdminPayload;
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

export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
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
      const recruiterPayload = verifyRecruiterAccessToken(token);
      if (recruiterPayload) {
        req.integration = recruiterPayload;
      }
    }
  }

  next();
}

export function integrationAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
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

  const recruiterPayload = verifyRecruiterAccessToken(token);
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
