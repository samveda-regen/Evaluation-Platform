import jwt from 'jsonwebtoken';
import { AdminPayload, CandidatePayload } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-platform-secret-key-change-in-production';
const JWT_EXPIRY = '24h';

export function generateAdminToken(payload: AdminPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function generateCandidateToken(payload: CandidatePayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): AdminPayload | CandidatePayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AdminPayload | CandidatePayload;
  } catch {
    return null;
  }
}
