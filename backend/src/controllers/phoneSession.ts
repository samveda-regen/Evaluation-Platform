import { Request, Response } from 'express';
import {
  createSession,
  getSession,
  completeSession,
} from '../services/phoneSessionService';

// POST /api/verification/phone-session
// Creates a session and returns the sessionId. The frontend builds the QR URL.
// Requires candidateAuth.
export function createPhoneSession(req: Request, res: Response): void {
  const candidateId = (req as any).candidate?.id;
  if (!candidateId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const session = createSession(candidateId);
  res.json({ sessionId: session.id });
}

// GET /api/verification/phone-session/:id
// Public — both the desktop (polling) and phone page use this.
// Returns status + imageData when complete so desktop can auto-fill.
export function getPhoneSessionStatus(req: Request, res: Response): void {
  const session = getSession(req.params.id);

  if (!session) {
    res.status(404).json({ status: 'not_found' });
    return;
  }

  res.json({
    status:    session.status,
    imageData: session.status === 'complete' ? session.imageData : undefined,
  });
}

// POST /api/verification/phone-upload/:id
// Public — phone posts the captured image as base64.
// Body: { imageData: string } (base64 JPEG, without data: prefix)
export function uploadPhoneImage(req: Request, res: Response): void {
  const { imageData } = req.body as { imageData?: string };

  if (!imageData || typeof imageData !== 'string') {
    res.status(400).json({ error: 'imageData is required' });
    return;
  }

  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }
  if (session.status !== 'waiting') {
    res.status(409).json({ error: 'Session already completed' });
    return;
  }

  const ok = completeSession(req.params.id, imageData);
  if (!ok) {
    res.status(409).json({ error: 'Session already completed' });
    return;
  }

  res.json({ success: true });
}
