import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import prisma from './db.js';

// Shared Backblaze B2 (S3-compatible) config for all proctoring artifacts —
// egress webcam recordings (liveKitEgressService.ts) and violation/face
// snapshots (fileStorageService.ts) live in the same bucket, under the same
// <test>/<candidate>/ folder layout, via getAssessmentCandidateContext below.
interface B2Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

function b2Env(): B2Config | null {
  const endpoint = (process.env.EGRESS_S3_ENDPOINT || '').trim();
  const region = (process.env.EGRESS_S3_REGION || '').trim();
  const bucket = (process.env.EGRESS_S3_BUCKET || '').trim();
  const accessKey = (process.env.EGRESS_S3_ACCESS_KEY || '').trim();
  const secretKey = (process.env.EGRESS_S3_SECRET_KEY || '').trim();
  if (!endpoint || !region || !bucket || !accessKey || !secretKey) return null;
  return { endpoint, region, bucket, accessKey, secretKey };
}

export function b2Configured(): boolean {
  return b2Env() !== null;
}

export function b2BucketName(): string | null {
  return b2Env()?.bucket ?? null;
}

export function getB2Config(): B2Config | null {
  return b2Env();
}

let cachedClient: S3Client | null = null;

function b2Client(): S3Client {
  const env = b2Env();
  if (!env) throw new Error('EGRESS_S3_* environment variables are not configured');
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: env.region,
      endpoint: env.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: env.accessKey, secretAccessKey: env.secretKey },
    });
  }
  return cachedClient;
}

export async function putB2Object(key: string, body: Buffer, contentType: string): Promise<void> {
  const env = b2Env();
  if (!env) throw new Error('EGRESS_S3_* environment variables are not configured');
  await b2Client().send(
    new PutObjectCommand({ Bucket: env.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getB2SignedUrl(
  key: string,
  options: { filename: string; disposition: 'inline' | 'attachment'; contentType?: string },
): Promise<string> {
  const env = b2Env();
  if (!env) throw new Error('EGRESS_S3_* environment variables are not configured');
  const command = new GetObjectCommand({
    Bucket: env.bucket,
    Key: key,
    ResponseContentType: options.contentType || 'application/octet-stream',
    ResponseContentDisposition: `${options.disposition}; filename="${options.filename}"`,
  });
  return getSignedUrl(b2Client(), command, { expiresIn: 600 });
}

export function sanitizeFolderSegment(raw: string): string {
  return (
    (raw || 'unknown')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'unknown'
  );
}

export interface AssessmentCandidateContext {
  testId: string;
  testName: string;
  candidateId: string;
  candidateName: string;
  // "<testName>_<testId>/<candidateName>_<candidateId>"
  folder: string;
}

const contextCache = new Map<string, AssessmentCandidateContext>();

export async function getAssessmentCandidateContext(
  attemptId: string,
): Promise<AssessmentCandidateContext | null> {
  const cached = contextCache.get(attemptId);
  if (cached) return cached;

  const attempt = await prisma.testAttempt.findUnique({
    where: { id: attemptId },
    select: {
      test: { select: { id: true, name: true } },
      candidate: { select: { id: true, name: true, email: true } },
    },
  });
  if (!attempt?.test || !attempt.candidate) return null;

  const testName = sanitizeFolderSegment(attempt.test.name);
  const candidateName = sanitizeFolderSegment(
    attempt.candidate.name || attempt.candidate.email || attempt.candidate.id,
  );
  const context: AssessmentCandidateContext = {
    testId: attempt.test.id,
    testName,
    candidateId: attempt.candidate.id,
    candidateName,
    folder: `${testName}_${attempt.test.id}/${candidateName}_${attempt.candidate.id}`,
  };
  contextCache.set(attemptId, context);
  return context;
}
