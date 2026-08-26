import fs from 'fs';
import fsPromises from 'fs/promises';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  getRecordingSignedUrl,
  receiveLiveKitEgressWebhook,
  reconcileCandidateEgressRecording,
  resolveRecordingPath,
} from '../services/liveKitEgressService.js';

type RecordingAccessPayload = jwt.JwtPayload & {
  recordingId: string;
  adminId: string;
  scope: 'stream' | 'download';
};

function accessSecret(): string {
  return process.env.JWT_SECRET || '';
}

async function ownedRecording(recordingId: string, adminId: string) {
  return prisma.proctorRecording.findFirst({
    where: {
      id: recordingId,
      session: { attempt: { test: { adminId } } },
    },
    include: {
      session: {
        select: {
          attempt: {
            select: {
              id: true,
              candidate: { select: { name: true } },
              test: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120);
}

export async function getRecordingAccess(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { recordingId } = req.params;
    const adminId = req.admin!.id;
    let recording = await ownedRecording(recordingId, adminId);
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    if (recording.status !== 'ready') {
      await reconcileCandidateEgressRecording(recording.session.attempt.id).catch(() => undefined);
      recording = await ownedRecording(recordingId, adminId);
    }
    if (!recording || recording.status !== 'ready' || !recording.storageKey) {
      res.status(409).json({ error: 'Recording is not ready', status: recording?.status || 'unavailable' });
      return;
    }

    const common = { recordingId, adminId };
    const streamToken = jwt.sign({ ...common, scope: 'stream' }, accessSecret(), { expiresIn: '10m' });
    const downloadToken = jwt.sign({ ...common, scope: 'download' }, accessSecret(), { expiresIn: '10m' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
      streamUrl: `${baseUrl}/api/admin/recordings/${recordingId}/stream?token=${encodeURIComponent(streamToken)}`,
      downloadUrl: `${baseUrl}/api/admin/recordings/${recordingId}/download?token=${encodeURIComponent(downloadToken)}`,
      expiresInSeconds: 600,
    });
  } catch (error) {
    console.error('Get recording access error:', error);
    res.status(500).json({ error: 'Failed to create recording access link' });
  }
}

async function serveRecording(req: Request, res: Response, scope: 'stream' | 'download'): Promise<void> {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const payload = jwt.verify(token, accessSecret()) as RecordingAccessPayload;
    if (payload.recordingId !== req.params.recordingId || payload.scope !== scope || !payload.adminId) {
      res.status(403).json({ error: 'Invalid recording access token' });
      return;
    }

    const recording = await ownedRecording(req.params.recordingId, payload.adminId);
    if (!recording?.storageKey || recording.status !== 'ready') {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const attempt = recording.session.attempt;
    const filename = safeFilename(`${attempt.candidate.name}-${attempt.test.name}-webcam.mp4`);

    if (recording.storageBucket && recording.storageBucket !== 'local-filesystem') {
      const signedUrl = await getRecordingSignedUrl(recording.storageKey, {
        filename,
        disposition: scope === 'download' ? 'attachment' : 'inline',
      });
      res.redirect(302, signedUrl);
      return;
    }

    const absolutePath = resolveRecordingPath(recording.storageKey);
    const stats = await fsPromises.stat(absolutePath);

    res.setHeader('Content-Type', recording.mimeType || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${scope === 'download' ? 'attachment' : 'inline'}; filename="${filename}"`);

    if (scope === 'download' || !req.headers.range) {
      res.setHeader('Content-Length', stats.size);
      fs.createReadStream(absolutePath).pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${stats.size}`).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stats.size) {
      res.status(416).setHeader('Content-Range', `bytes */${stats.size}`).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(absolutePath, { start, end }).pipe(res);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Recording access link is invalid or expired' });
      return;
    }
    console.error(`Serve recording ${scope} error:`, error);
    res.status(404).json({ error: 'Recording file is unavailable' });
  }
}

export async function streamRecording(req: Request, res: Response): Promise<void> {
  await serveRecording(req, res, 'stream');
}

export async function downloadRecording(req: Request, res: Response): Promise<void> {
  await serveRecording(req, res, 'download');
}

export async function liveKitEgressWebhook(req: Request, res: Response): Promise<void> {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    await receiveLiveKitEgressWebhook(rawBody, req.get('Authorization') || undefined);
    res.status(204).end();
  } catch (error) {
    console.error('LiveKit Egress webhook rejected:', error);
    res.status(401).json({ error: 'Invalid LiveKit webhook' });
  }
}
