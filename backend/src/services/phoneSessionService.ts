import { randomUUID } from 'crypto';

export type PhoneSessionStatus = 'waiting' | 'complete' | 'expired';

export interface PhoneSession {
  id:          string;
  candidateId: string;
  status:      PhoneSessionStatus;
  imageData?:  string;   // base64 JPEG — only present when status === 'complete'
  createdAt:   number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const store  = new Map<string, PhoneSession>();

// Prune sessions older than TTL every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.createdAt > TTL_MS) store.delete(id);
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
  if (Date.now() - s.createdAt > TTL_MS) {
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
