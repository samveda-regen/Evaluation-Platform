import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  WebhookConfig,
  WebhookReceiver,
} from 'livekit-server-sdk';
import prisma from '../utils/db.js';
import {
  b2Configured as s3Configured,
  b2BucketName as s3BucketName,
  getAssessmentCandidateContext,
  getB2Config,
  getB2SignedUrl,
} from '../utils/b2Storage.js';

export { s3Configured, s3BucketName };

const startLocks = new Map<string, Promise<void>>();

type EgressInfoLike = {
  egressId?: string;
  status?: number | string;
  error?: string;
  startedAt?: number | bigint | string;
  endedAt?: number | bigint | string;
  fileResults?: Array<{
    filename?: string;
    duration?: number | bigint | string;
    size?: number | bigint | string;
  }>;
};

function enabled(): boolean {
  return (process.env.LIVEKIT_EGRESS_ENABLED || 'false').toLowerCase() === 'true';
}

export function getRecordingRoot(): string {
  return path.resolve(process.env.RECORDING_DIR || '/var/lib/talentstaq/recordings');
}

// The Egress container does NOT see the host filesystem at the same path as this
// backend process. It only has RECORDING_DIR bind-mounted at a container-internal
// path (see docker-compose / egress.yaml `backup_storage`), typically `/recordings`.
// Egress must be told to write using ITS OWN view of that path, not this backend's
// host-side RECORDING_DIR — otherwise it tries to create host-style directories
// (e.g. /var/lib/talentstaq/...) that don't exist inside its own container and
// fails with a permission error while mkdir-ing a path it has no reason to touch.
// This backend still uses RECORDING_DIR (host path) for its own reads/writes,
// since it runs directly on the host, unlike Egress.
function getEgressRecordingRoot(): string {
  return process.env.EGRESS_RECORDING_DIR || '/recordings';
}

function egressFilepath(storageKey: string): string {
  // storageKey is always a relative, already-sanitized `testId/attemptId/file.mp4`
  // path (see relativeRecordingPath/resolveRecordingPath) — join with '/' rather
  // than path.join so this stays POSIX-correct regardless of the backend's host OS.
  return `${getEgressRecordingRoot().replace(/\/+$/, '')}/${storageKey}`;
}

// Optional S3-compatible bucket (e.g. Backblaze B2) for egress output — see
// backend/src/utils/b2Storage.ts. When configured, Egress uploads recordings
// directly to the bucket instead of the local RECORDING_DIR, and admin
// playback is served via short-lived signed URLs instead of local disk.
export async function getRecordingSignedUrl(
  storageKey: string,
  options: { filename: string; disposition: 'inline' | 'attachment' },
): Promise<string> {
  return getB2SignedUrl(storageKey, { ...options, contentType: 'video/mp4' });
}

function liveKitHttpUrl(): string {
  const raw = (process.env.LIVEKIT_URL || '').trim();
  if (raw.startsWith('wss://')) return `https://${raw.slice(6)}`;
  if (raw.startsWith('ws://')) return `http://${raw.slice(5)}`;
  return raw;
}

function configured(): boolean {
  return Boolean(
    enabled() &&
    liveKitHttpUrl() &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET &&
    (s3Configured() || process.env.RECORDING_DIR)
  );
}

function egressClient(): EgressClient {
  return new EgressClient(
    liveKitHttpUrl(),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
}

// "<testName>_<testId>/<candidateName>_<candidateId>/webcam-<timestamp>.mp4" so
// admin bucket browsing groups recordings by assessment then candidate. Falls
// back to raw IDs if the attempt's test/candidate can't be resolved (e.g. one
// was deleted mid-attempt) so recording still proceeds rather than failing.
async function relativeRecordingPath(testId: string, attemptId: string, timestamp: number): Promise<string> {
  const context = await getAssessmentCandidateContext(attemptId);
  const folder = context?.folder || `${testId}/attempt-${attemptId}`;
  return `${folder}/webcam-${timestamp}.mp4`;
}

export function resolveRecordingPath(storageKey: string): string {
  const root = getRecordingRoot();
  const resolved = path.resolve(root, storageKey);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Recording path is outside RECORDING_DIR');
  }
  return resolved;
}

function toSafeNumber(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function durationSeconds(info: EgressInfoLike): number | null {
  const fileDuration = toSafeNumber(info.fileResults?.[0]?.duration);
  if (fileDuration && fileDuration > 0) {
    return Math.max(1, Math.round(fileDuration > 1_000_000 ? fileDuration / 1_000_000_000 : fileDuration));
  }
  const started = toSafeNumber(info.startedAt);
  const ended = toSafeNumber(info.endedAt);
  if (!started || !ended || ended <= started) return null;
  const divisor = ended > 100_000_000_000_000 ? 1_000_000_000 : 1_000;
  return Math.max(1, Math.round((ended - started) / divisor));
}

function statusName(status: EgressInfoLike['status']): string {
  if (typeof status === 'string') return status.toUpperCase();
  return ({
    0: 'EGRESS_STARTING',
    1: 'EGRESS_ACTIVE',
    2: 'EGRESS_ENDING',
    3: 'EGRESS_COMPLETE',
    4: 'EGRESS_FAILED',
    5: 'EGRESS_ABORTED',
    6: 'EGRESS_LIMIT_REACHED',
  } as Record<number, string>)[status ?? -1] || 'UNKNOWN';
}

export async function syncRecordingFromEgressInfo(info: EgressInfoLike): Promise<void> {
  if (!info.egressId) return;
  const recording = await prisma.proctorRecording.findUnique({ where: { egressId: info.egressId } });
  if (!recording) return;

  const state = statusName(info.status);
  if (state.includes('STARTING') || state.includes('ACTIVE')) {
    await prisma.proctorRecording.update({
      where: { id: recording.id },
      data: { status: state.includes('ACTIVE') ? 'recording' : 'starting', processingError: null },
    });
    return;
  }
  if (state.includes('ENDING')) {
    await prisma.proctorRecording.update({ where: { id: recording.id }, data: { status: 'processing' } });
    return;
  }
  if (state.includes('FAILED') || state.includes('ABORTED') || state.includes('LIMIT')) {
    await prisma.proctorRecording.update({
      where: { id: recording.id },
      data: {
        status: 'failed',
        endTime: new Date(),
        processingError: info.error || `LiveKit Egress ended with ${state}`,
      },
    });
    return;
  }
  if (!state.includes('COMPLETE')) return;

  try {
    if (!recording.storageKey) throw new Error('Recording has no storage key');
    let fileSize: number | null;
    if (s3Configured()) {
      fileSize = toSafeNumber(info.fileResults?.[0]?.size);
      if (fileSize == null) throw new Error('Egress result did not report a file size yet');
    } else {
      const absolutePath = resolveRecordingPath(recording.storageKey);
      const stats = await fs.stat(absolutePath);
      fileSize = stats.size;
    }
    await prisma.proctorRecording.update({
      where: { id: recording.id },
      data: {
        status: 'ready',
        endTime: new Date(),
        duration: durationSeconds(info),
        fileSize,
        mimeType: 'video/mp4',
        processingError: null,
      },
    });
  } catch (error) {
    await prisma.proctorRecording.update({
      where: { id: recording.id },
      data: {
        status: 'processing',
        processingError: error instanceof Error ? error.message : 'Recording file is not available yet',
      },
    });
  }
}
function isRoomNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /room does not exist/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The candidate publishes to the room before this is called (see
// useLiveProctoringPublisher on the frontend), so the room should already
// exist by the time we get here. In practice, on very fast exams the
// candidate can disconnect (room torn down client-side) right as this
// request is in flight, or there can be a brief propagation delay between
// the SFU accepting the connection and the room being visible to Egress.
// Retry a few times before giving up, rather than failing the recording
// outright on the first "room does not exist".
async function startParticipantEgressWithRetry(
  client: EgressClient,
  roomName: string,
  participantIdentity: string,
  output: EncodedFileOutput,
  webhooks: WebhookConfig[] | undefined,
  maxAttempts = 3,
): Promise<{ egressId: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.startParticipantEgress(
        roomName,
        participantIdentity,
        { file: output },
        { screenShare: false, webhooks },
      );
    } catch (error) {
      lastError = error;
      if (!isRoomNotFoundError(error) || attempt === maxAttempts) throw error;
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}


async function startCandidateRecording(input: {
  sessionId: string;
  testId: string;
  attemptId: string;
  roomName: string;
  participantIdentity: string;
}): Promise<void> {
  if (!configured()) return;

  const recordingKey = `livekit-webcam:${input.attemptId}`;
  let recording = await prisma.proctorRecording.findUnique({ where: { recordingKey } });
  if (recording && ['starting', 'recording', 'processing', 'ready'].includes(recording.status)) return;

  const now = Date.now();
  const storageKey = await relativeRecordingPath(input.testId, input.attemptId, now);
  const useS3 = s3Configured();

  if (!recording) {
    const id = uuidv4();
    try {
      recording = await prisma.proctorRecording.create({
        data: {
          id,
          sessionId: input.sessionId,
          recordingType: 'webcam',
          recordingKey,
          storageUrl: `/api/admin/recordings/${id}/stream`,
          storageBucket: useS3 ? s3BucketName()! : 'local-filesystem',
          storageKey,
          startTime: new Date(),
          mimeType: 'video/mp4',
          status: 'starting',
        },
      });
    } catch (error) {
      recording = await prisma.proctorRecording.findUnique({ where: { recordingKey } });
      if (!recording || ['starting', 'recording', 'processing', 'ready'].includes(recording.status)) return;
    }
  } else {
    recording = await prisma.proctorRecording.update({
      where: { id: recording.id },
      data: {
        egressId: null,
        storageKey,
        startTime: new Date(),
        endTime: null,
        duration: null,
        fileSize: null,
        status: 'starting',
        processingError: null,
      },
    });
  }
  if (!useS3) {
    try {
      const absolutePath = resolveRecordingPath(storageKey);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      // fs.mkdir's mode is masked by the process umask (typically 022), so a fresh
      // directory usually lands at 755 regardless of what mode is requested here —
      // group members get no write access. The Egress container writes into this
      // exact directory as a non-root user (gid 0 / group "root"), so it needs
      // real group-write permission, not just matching group ownership. chmod
      // explicitly afterward to sidestep the umask entirely, on every new attempt
      // folder, rather than relying on a one-time host-level chmod that only
      // covers directories that already existed at the time it was run.
      await fs.chmod(path.dirname(absolutePath), 0o775);
    } catch (error) {
      await prisma.proctorRecording.update({
        where: { id: recording.id },
        data: {
          status: 'failed',
          endTime: new Date(),
          processingError: `Local storage directory is not writable: ${
            error instanceof Error ? error.message : 'unknown filesystem error'
          }`,
        },
      });
      console.error(`[egress] failed to prepare recording directory for attempt ${input.attemptId}:`, error);
      return;
    }
  }
  try {
    const b2Config = useS3 ? getB2Config() : null;
    const output = b2Config
      ? new EncodedFileOutput({
          fileType: EncodedFileType.MP4,
          filepath: storageKey,
          disableManifest: true,
          output: {
            case: 's3',
            value: new S3Upload({
              accessKey: b2Config.accessKey,
              secret: b2Config.secretKey,
              region: b2Config.region,
              endpoint: b2Config.endpoint,
              bucket: b2Config.bucket,
              forcePathStyle: true,
            }),
          },
        })
      : new EncodedFileOutput({
          fileType: EncodedFileType.MP4,
          filepath: egressFilepath(storageKey),
          disableManifest: true,
        });
    const webhookUrl = (process.env.LIVEKIT_EGRESS_WEBHOOK_URL || '').trim();
    const webhooks = webhookUrl
      ? [new WebhookConfig({ url: webhookUrl, signingKey: process.env.LIVEKIT_API_KEY || '' })]
      : undefined;
        const client = egressClient();
    const info = await startParticipantEgressWithRetry(
      client,
      input.roomName,
      input.participantIdentity,
      output,
      webhooks,
    );
    await prisma.proctorRecording.update({
      where: { id: recording.id },
      data: { egressId: info.egressId, status: 'recording', processingError: null },
    });
    const currentAttempt = await prisma.testAttempt.findUnique({
      where: { id: input.attemptId },
      select: { status: true },
    });
    if (currentAttempt?.status !== 'in_progress') {
      const stopped = await client.stopEgress(info.egressId);
      await syncRecordingFromEgressInfo(stopped as EgressInfoLike);
    }
  } catch (error) {
    await prisma.proctorRecording.update({
      where: { id: recording.id },
      data: {
        status: 'failed',
        endTime: new Date(),
        processingError: error instanceof Error ? error.message : 'Unable to start LiveKit Egress',
      },
    });
    console.error(`[egress] failed to start recording for attempt ${input.attemptId}:`, error);
  }
}

export function ensureCandidateEgressRecording(input: {
  sessionId: string;
  testId: string;
  attemptId: string;
  roomName: string;
  participantIdentity: string;
}): Promise<void> {
  const existing = startLocks.get(input.attemptId);
  if (existing) return existing;
  const task = startCandidateRecording(input).finally(() => startLocks.delete(input.attemptId));
  startLocks.set(input.attemptId, task);
  return task;
}

export async function stopCandidateEgressRecording(attemptId: string): Promise<void> {
  if (!configured()) return;
  const recording = await prisma.proctorRecording.findUnique({
    where: { recordingKey: `livekit-webcam:${attemptId}` },
  });
  if (!recording?.egressId || ['ready', 'failed'].includes(recording.status)) return;

  await prisma.proctorRecording.update({ where: { id: recording.id }, data: { status: 'processing' } });
  try {
    const info = await egressClient().stopEgress(recording.egressId);
    await syncRecordingFromEgressInfo(info as EgressInfoLike);
  } catch (error) {
    console.error(`[egress] stop request failed for attempt ${attemptId}:`, error);
    await reconcileCandidateEgressRecording(attemptId).catch(() => undefined);
  }
}

export async function reconcileCandidateEgressRecording(attemptId: string): Promise<void> {
  if (!configured()) return;
  const recording = await prisma.proctorRecording.findUnique({
    where: { recordingKey: `livekit-webcam:${attemptId}` },
  });
  if (!recording?.egressId || recording.status === 'ready') return;
  const results = await egressClient().listEgress({ egressId: recording.egressId });
  const info = results.find(item => item.egressId === recording.egressId);
  if (info) await syncRecordingFromEgressInfo(info as EgressInfoLike);
}

export async function receiveLiveKitEgressWebhook(rawBody: string, authorization?: string): Promise<void> {
  const receiver = new WebhookReceiver(
    process.env.LIVEKIT_API_KEY || '',
    process.env.LIVEKIT_API_SECRET || '',
  );
  const event = await receiver.receive(rawBody, authorization);
  if (event.egressInfo) await syncRecordingFromEgressInfo(event.egressInfo as EgressInfoLike);
}

export function isLiveKitEgressEnabled(): boolean {
  return configured();
}
