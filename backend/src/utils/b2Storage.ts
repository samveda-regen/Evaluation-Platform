import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

// ---- Bucket analytics (superadmin Storage page) ----
// Walks the whole bucket via ListObjectsV2 and rolls the objects up by artifact
// type and top-level assessment folder. This is the only place the platform
// reads *actual* stored bytes from B2 rather than summing FileStorage.fileSize
// metadata in Postgres, so the two figures can be cross-checked.

export type B2ArtifactType = 'recording' | 'snapshot' | 'metadata' | 'other';

export interface B2TypeBreakdown {
  type: B2ArtifactType;
  objects: number;
  bytes: number;
}

export interface B2FolderBreakdown {
  // Top-level key prefix — "<testName>_<testId>" in the standard layout.
  folder: string;
  objects: number;
  bytes: number;
}

export interface B2LargestObject {
  key: string;
  bytes: number;
  lastModified: string | null;
}

export interface B2BucketAnalytics {
  bucket: string;
  generatedAt: string;
  totalObjects: number;
  totalBytes: number;
  // True when the scan hit its page cap and the totals are a lower bound.
  truncated: boolean;
  byType: B2TypeBreakdown[];
  topFolders: B2FolderBreakdown[];
  largestObjects: B2LargestObject[];
}

function classifyKey(key: string): B2ArtifactType {
  const lower = key.toLowerCase();
  if (lower.endsWith('.json')) return 'metadata';
  if (lower.includes('/snapshots/')) return 'snapshot';
  if (
    lower.includes('/recordings/') ||
    /\/webcam-[^/]*$/.test(lower) ||
    /\.(webm|mp4|ogg|wav|mkv)$/.test(lower)
  ) {
    return 'recording';
  }
  return 'other';
}

// Safety cap: 1000 keys/page * 200 pages = up to 200k objects scanned.
const MAX_LIST_PAGES = 200;

export async function getB2BucketAnalytics(): Promise<B2BucketAnalytics> {
  const env = b2Env();
  if (!env) throw new Error('EGRESS_S3_* environment variables are not configured');

  const typeTotals = new Map<B2ArtifactType, { objects: number; bytes: number }>();
  const folderTotals = new Map<string, { objects: number; bytes: number }>();
  const largest: B2LargestObject[] = [];
  let totalObjects = 0;
  let totalBytes = 0;
  let truncated = false;

  let continuationToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const res = await b2Client().send(
      new ListObjectsV2Command({
        Bucket: env.bucket,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of res.Contents ?? []) {
      const key = obj.Key ?? '';
      const size = obj.Size ?? 0;
      if (!key) continue;

      totalObjects += 1;
      totalBytes += size;

      const type = classifyKey(key);
      const t = typeTotals.get(type) ?? { objects: 0, bytes: 0 };
      t.objects += 1;
      t.bytes += size;
      typeTotals.set(type, t);

      const folder = key.split('/')[0] || '(root)';
      const f = folderTotals.get(folder) ?? { objects: 0, bytes: 0 };
      f.objects += 1;
      f.bytes += size;
      folderTotals.set(folder, f);

      largest.push({
        key,
        bytes: size,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
      });
    }

    if (res.IsTruncated && res.NextContinuationToken) {
      continuationToken = res.NextContinuationToken;
      if (page === MAX_LIST_PAGES - 1) truncated = true;
    } else {
      continuationToken = undefined;
      break;
    }
  }

  const byType: B2TypeBreakdown[] = (['recording', 'snapshot', 'metadata', 'other'] as B2ArtifactType[])
    .map((type) => {
      const v = typeTotals.get(type) ?? { objects: 0, bytes: 0 };
      return { type, objects: v.objects, bytes: v.bytes };
    })
    .filter((row) => row.objects > 0);

  const topFolders: B2FolderBreakdown[] = Array.from(folderTotals.entries())
    .map(([folder, v]) => ({ folder, objects: v.objects, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 20);

  largest.sort((a, b) => b.bytes - a.bytes);

  return {
    bucket: env.bucket,
    generatedAt: new Date().toISOString(),
    totalObjects,
    totalBytes,
    truncated,
    byType,
    topFolders,
    largestObjects: largest.slice(0, 10),
  };
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

// Top-level folder for this deployment inside the shared B2 bucket, so
// multiple instances (e.g. a production and an experimental deployment) can
// point at the same bucket without their assessment/candidate folders
// colliding. Unset means no instance layer — objects land directly under
// "<testName>_<testId>/...", the previous behavior.
export function getInstanceFolderPrefix(): string {
  const instance = (process.env.INSTANCE_FILENAME || '').trim();
  return instance ? `${sanitizeFolderSegment(instance)}/` : '';
}

export interface AssessmentCandidateContext {
  testId: string;
  testName: string;
  candidateId: string;
  candidateName: string;
  attemptNumber: number;
  // "<testName>_<testId>/<candidateName>_<candidateId>/attempt <N>"
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
      attemptNumber: true,
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
    attemptNumber: attempt.attemptNumber,
    folder: `${getInstanceFolderPrefix()}${testName}_${attempt.test.id}/${candidateName}_${attempt.candidate.id}/attempt ${attempt.attemptNumber}`,
  };
  contextCache.set(attemptId, context);
  return context;
}
