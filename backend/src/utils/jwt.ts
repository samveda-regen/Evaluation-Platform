import jwt from 'jsonwebtoken';
import { AdminPayload, CandidatePayload, IntegrationPayload } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-platform-secret-key-change-in-production';
// Admin sessions time out after 2h of inactivity-independent, fixed session length.
// Candidate tokens stay at 24h so an in-progress exam is never cut short mid-test.
const ADMIN_JWT_EXPIRY = (process.env.ADMIN_SESSION_TIMEOUT || '2h') as jwt.SignOptions['expiresIn'];
const CANDIDATE_JWT_EXPIRY = '24h';
const INTEGRATION_TOKEN_EXPIRY = (process.env.INTEGRATION_ACCESS_TOKEN_EXPIRY || '15m') as jwt.SignOptions['expiresIn'];

export function generateAdminToken(payload: AdminPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRY });
}

export function generateCandidateToken(payload: CandidatePayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: CANDIDATE_JWT_EXPIRY });
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
