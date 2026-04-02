import { Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { AuthenticatedRequest, AdminPayload, CandidatePayload } from '../types/index.js';

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
      }
    }
  }

  next();
}
