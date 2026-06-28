import { randomUUID } from 'crypto';

export type PhoneSessionStatus = 'waiting' | 'complete' | 'expired';

export interface PhoneSession {
  id:          string;
  candidateId: string;
  status:      PhoneSessionStatus;
  imageData?:  string;   // base64 JPEG — only present when status === 'complete'
  createdAt:   number;
}

const WAITING_TTL_MS  = 5  * 60 * 1000;        // 5 min — waiting sessions expire quickly
const COMPLETE_TTL_MS = 24 * 60 * 60 * 1000;   // 24 h  — keep so phone can poll for admin result
const store = new Map<string, PhoneSession>();

// Prune expired sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of store) {
    const ttl = s.status === 'waiting' ? WAITING_TTL_MS : COMPLETE_TTL_MS;
    if (now - s.createdAt > ttl) store.delete(id);
  }
}, 60_000).unref();

export function createSession(candidateId: string): PhoneSession {
  const session: PhoneSession = {
    id:          randomUUID(),
    candidateId,
    status:      'waiting',
    createdAt:   Date.now(),
  };
  store.set(session.id, session);
  return session;
}

export function getSession(id: string): PhoneSession | null {
  const s = store.get(id);
  if (!s) return null;
  const ttl = s.status === 'waiting' ? WAITING_TTL_MS : COMPLETE_TTL_MS;
  if (Date.now() - s.createdAt > ttl) {
    store.delete(id);
    return { ...s, status: 'expired' };
  }
  return s;
}

export function completeSession(id: string, imageData: string): boolean {
  const s = store.get(id);
  if (!s || s.status !== 'waiting') return false;
  s.status    = 'complete';
  s.imageData = imageData;
  return true;
}

export function deleteSession(id: string): void {
  store.delete(id);
}
