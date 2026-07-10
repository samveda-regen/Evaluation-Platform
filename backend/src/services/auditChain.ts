import crypto from 'crypto';
import prisma from '../utils/db.js';
import { encryptJson, decryptJson } from '../utils/encryption.js';

// Single choke point for every AuditLog write in the app. Two properties
// this buys, both operating on the plaintext content (encryption is
// orthogonal to tamper-evidence — the hash must reflect the real content
// regardless of whether AUDIT_ENCRYPTION_KEY happens to be set):
//
// 1. Tamper evidence: each row's hash covers its own content + the
//    previous row's hash (a hash chain). Editing any historical row's
//    before/after/action directly in the database breaks the chain from
//    that point forward — detectable via verifyAuditChain().
// 2. At-rest encryption: before/after are stored as { enc: "..." } when a
//    key is configured, transparently decrypted on read.

interface AuditEntryInput {
  actorAdminId?: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

interface HashableFields {
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

function computeHash(prevHash: string | null, fields: HashableFields): string {
  return crypto.createHash('sha256').update(JSON.stringify({ prevHash, ...fields })).digest('hex');
}

function encryptForStorage(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  return { enc: encryptJson(value) };
}

function decryptFromStorage(value: unknown): unknown {
  if (value && typeof value === 'object' && 'enc' in (value as Record<string, unknown>)) {
    try {
      return decryptJson((value as { enc: string }).enc);
    } catch (error) {
      console.error('Failed to decrypt audit entry:', error);
      return value;
    }
  }
  return value;
}

export async function createAuditLogEntry(input: AuditEntryInput) {
  const createdAt = new Date();

  return prisma.$transaction(async (tx) => {
    const chainState = await tx.auditChainState.upsert({
      where: { key: 'global' },
      update: {},
      create: { key: 'global', lastHash: null },
    });

    const hashFields: HashableFields = {
      actorEmail: input.actorEmail,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      createdAt: createdAt.toISOString(),
    };
    const hash = computeHash(chainState.lastHash, hashFields);

    const row = await tx.auditLog.create({
      data: {
        actorAdminId: input.actorAdminId ?? null,
        actorEmail: input.actorEmail,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        before: encryptForStorage(input.before) as never,
        after: encryptForStorage(input.after) as never,
        createdAt,
        prevHash: chainState.lastHash,
        hash,
      },
    });

    await tx.auditChainState.update({ where: { key: 'global' }, data: { lastHash: hash } });

    return row;
  });
}

// Returns a decrypted, display-ready copy of an AuditLog row (or array of
// rows) — used by every read path so the superadmin console never has to
// know or care whether encryption is on.
export function decryptAuditEntries<T extends { before: unknown; after: unknown }>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row, before: decryptFromStorage(row.before), after: decryptFromStorage(row.after) }));
}

export interface ChainVerificationResult {
  intact: boolean;
  checkedCount: number;
  brokenAtId?: string;
  brokenAtIndex?: number;
}

// Walks every hashed row in creation order, recomputing each hash from its
// (decrypted) content and the previous row's hash. Rows predating this
// feature (hash === null) are skipped as "unchained legacy data" rather
// than treated as a break.
export async function verifyAuditChain(): Promise<ChainVerificationResult> {
  const rows = await prisma.auditLog.findMany({
    where: { hash: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  let prevHash: string | null = null;
  let checkedCount = 0;

  for (const row of rows) {
    const before = decryptFromStorage(row.before);
    const after = decryptFromStorage(row.after);
    const expectedHash = computeHash(prevHash, {
      actorEmail: row.actorEmail,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      before,
      after,
      createdAt: row.createdAt.toISOString(),
    });

    if (row.prevHash !== prevHash || row.hash !== expectedHash) {
      return { intact: false, checkedCount, brokenAtId: row.id, brokenAtIndex: checkedCount };
    }

    prevHash = row.hash;
    checkedCount += 1;
  }

  return { intact: true, checkedCount };
}
