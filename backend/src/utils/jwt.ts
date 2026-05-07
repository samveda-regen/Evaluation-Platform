import jwt from 'jsonwebtoken';
import { AdminPayload, CandidatePayload, IntegrationPayload } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-platform-secret-key-change-in-production';
const JWT_EXPIRY = '24h';
const INTEGRATION_TOKEN_EXPIRY = (process.env.INTEGRATION_ACCESS_TOKEN_EXPIRY || '15m') as jwt.SignOptions['expiresIn'];

export function generateAdminToken(payload: AdminPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function generateCandidateToken(payload: CandidatePayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function generateIntegrationToken(payload: IntegrationPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: INTEGRATION_TOKEN_EXPIRY });
}

export function verifyToken(token: string): AdminPayload | CandidatePayload | IntegrationPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AdminPayload | CandidatePayload | IntegrationPayload;
  } catch {
    return null;
  }
}
