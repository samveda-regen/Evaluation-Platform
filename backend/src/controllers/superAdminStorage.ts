import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { b2Configured, getB2BucketAnalytics, type B2BucketAnalytics } from '../utils/b2Storage.js';

interface CompanyBytesRow {
  companyId: string;
  bytes: bigint | null;
}

// No table has a companyId column directly, so each storage source is aggregated
// through its own join path to Test.companyId / Candidate.companyId (both indexed).
async function mediaAssetBytesByCompany(): Promise<CompanyBytesRow[]> {
  return prisma.$queryRaw<CompanyBytesRow[]>`
    SELECT "Admin"."companyId" AS "companyId", SUM("MediaAsset"."fileSize") AS "bytes"
    FROM "MediaAsset"
    JOIN "Admin" ON "Admin"."id" = "MediaAsset"."uploadedBy"
    WHERE "Admin"."companyId" IS NOT NULL
    GROUP BY "Admin"."companyId"
  `;
}

async function fileStorageBytesByCompany(): Promise<CompanyBytesRow[]> {
  return prisma.$queryRaw<CompanyBytesRow[]>`
    SELECT "companyId", SUM("bytes") AS "bytes" FROM (
      SELECT "Test"."companyId" AS "companyId", "FileStorage"."fileSize" AS "bytes"
      FROM "FileStorage"
      JOIN "TestAttempt" ON "TestAttempt"."id" = "FileStorage"."attemptId"
      JOIN "Test" ON "Test"."id" = "TestAttempt"."testId"
      WHERE "FileStorage"."attemptId" IS NOT NULL AND "Test"."companyId" IS NOT NULL

      UNION ALL

      SELECT "Candidate"."companyId" AS "companyId", "FileStorage"."fileSize" AS "bytes"
      FROM "FileStorage"
      JOIN "Candidate" ON "Candidate"."id" = "FileStorage"."candidateId"
      WHERE "FileStorage"."candidateId" IS NOT NULL AND "Candidate"."companyId" IS NOT NULL
    ) "combined"
    GROUP BY "companyId"
  `;
}

async function recordingBytesByCompany(): Promise<CompanyBytesRow[]> {
  return prisma.$queryRaw<CompanyBytesRow[]>`
    SELECT "Test"."companyId" AS "companyId", SUM("ProctorRecording"."fileSize") AS "bytes"
    FROM "ProctorRecording"
    JOIN "ProctorSession" ON "ProctorSession"."id" = "ProctorRecording"."sessionId"
    JOIN "TestAttempt" ON "TestAttempt"."id" = "ProctorSession"."attemptId"
    JOIN "Test" ON "Test"."id" = "TestAttempt"."testId"
    WHERE "Test"."companyId" IS NOT NULL
    GROUP BY "Test"."companyId"
  `;
}

export async function listCompanyStorage(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const [companies, mediaRows, fileRows, recordingRows] = await Promise.all([
      prisma.company.findMany({ select: { id: true, name: true } }),
      mediaAssetBytesByCompany(),
      fileStorageBytesByCompany(),
      recordingBytesByCompany(),
    ]);

    const mediaByCompany = new Map(mediaRows.map((r) => [r.companyId, Number(r.bytes ?? 0)]));
    const fileByCompany = new Map(fileRows.map((r) => [r.companyId, Number(r.bytes ?? 0)]));
    const recordingByCompany = new Map(recordingRows.map((r) => [r.companyId, Number(r.bytes ?? 0)]));

    const companiesStorage = companies
      .map((company) => {
        const mediaBytes = mediaByCompany.get(company.id) ?? 0;
        const fileStorageBytes = fileByCompany.get(company.id) ?? 0;
        const recordingBytes = recordingByCompany.get(company.id) ?? 0;
        return {
          companyId: company.id,
          companyName: company.name,
          mediaBytes,
          fileStorageBytes,
          recordingBytes,
          totalBytes: mediaBytes + fileStorageBytes + recordingBytes,
        };
      })
      .sort((a, b) => b.totalBytes - a.totalBytes);

    res.json({ companies: companiesStorage });
  } catch (error) {
    console.error('List company storage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// A full bucket walk is expensive, so the result is memoised for a few minutes.
// ?refresh=1 forces a fresh scan.
const B2_ANALYTICS_TTL_MS = 5 * 60 * 1000;
let b2AnalyticsCache: { at: number; data: B2BucketAnalytics } | null = null;

export async function getB2StorageAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!b2Configured()) {
      res.json({ configured: false });
      return;
    }

    const refreshParam = String(req.query.refresh ?? '');
    const forceRefresh = refreshParam === '1' || refreshParam === 'true';
    const now = Date.now();
    if (!forceRefresh && b2AnalyticsCache && now - b2AnalyticsCache.at < B2_ANALYTICS_TTL_MS) {
      res.json({ configured: true, cached: true, ageMs: now - b2AnalyticsCache.at, ...b2AnalyticsCache.data });
      return;
    }

    const data = await getB2BucketAnalytics();
    b2AnalyticsCache = { at: now, data };
    res.json({ configured: true, cached: false, ageMs: 0, ...data });
  } catch (error) {
    console.error('B2 storage analytics error:', error);
    res.status(502).json({ error: 'Failed to read bucket analytics from B2' });
  }
}
