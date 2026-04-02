import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';

const prisma = new PrismaClient();

// Allowed MIME types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'];
const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// File size limits (in bytes)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE = 50 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;
const MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024;

export interface UploadResult {
  success: boolean;
  url?: string;
  cdnUrl?: string;
  key?: string;
  fileId?: string;
  error?: string;
}

export interface FileMetadata {
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  mediaType: 'image' | 'video' | 'audio' | 'document';
}

export interface StoredFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  category: string;
  data: Buffer;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface AdminIdDocumentFilters {
  search?: string;
  candidateName?: string;
  testCode?: string;
  documentType?: 'id_front' | 'id_back' | 'selfie' | 'face_reference';
}

export interface AdminIdDocumentRecord {
  fileId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  candidateId: string;
  candidateName: string;
  testCode: string;
  documentType: string;
  relativePath?: string;
}

interface FileReferences {
  attemptId?: string;
  questionId?: string;
  candidateId?: string;
  sessionId?: string;
}

interface FsFileMeta {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  category: string;
  createdAt: string;
  references?: FileReferences;
  metadata?: Record<string, unknown>;
}

interface AttemptCandidateContext {
  candidateName: string;
  candidateId: string;
}

function getStorageMode(): string {
  return (process.env.FILE_STORAGE_MODE || 'database').toLowerCase();
}

function isFilesystemMode(): boolean {
  const mode = getStorageMode();
  return mode === 'filesystem' || mode === 'fs' || mode === 'local';
}

function getStorageRoot(): string {
  return path.resolve(process.env.FILE_STORAGE_PATH || path.join(process.cwd(), 'storage'));
}

function getObjectsDir(): string {
  return path.join(getStorageRoot(), 'objects');
}

function getMetaDir(): string {
  return path.join(getStorageRoot(), 'meta');
}

function getMimeExtension(mimeType: string, originalName: string): string {
  const originalExt = path.extname(originalName || '').trim();
  if (originalExt) return originalExt;

  if (mimeType.includes('jpeg')) return '.jpg';
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('gif')) return '.gif';
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('wav')) return '.wav';
  if (mimeType.includes('mpeg')) return '.mp3';
  if (mimeType.includes('pdf')) return '.pdf';
  return '.bin';
}

async function ensureFilesystemStorage(): Promise<void> {
  await fs.mkdir(getObjectsDir(), { recursive: true });
  await fs.mkdir(getMetaDir(), { recursive: true });
}

function getMetaPath(fileId: string): string {
  return path.join(getMetaDir(), `${fileId}.json`);
}

const attemptCandidateCache = new Map<string, AttemptCandidateContext>();

function sanitizePathSegment(raw: string): string {
  return (raw || 'unknown')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'unknown';
}

function getCandidateDataRootDirName(): string {
  return process.env.CANDIDATE_DATA_DIR_NAME || 'Candidate Data';
}

function getQuestionBankRootDirName(): string {
  return process.env.QUESTION_BANK_DIR_NAME || 'Question Bank';
}

async function getAttemptCandidateContext(attemptId: string): Promise<AttemptCandidateContext | null> {
  if (attemptCandidateCache.has(attemptId)) {
    return attemptCandidateCache.get(attemptId)!;
  }

  try {
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        candidate: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!attempt?.candidate) return null;

    const candidateName = sanitizePathSegment(
      attempt.candidate.name || attempt.candidate.email || attempt.candidate.id
    );
    const context: AttemptCandidateContext = {
      candidateName,
      candidateId: attempt.candidate.id,
    };
    attemptCandidateCache.set(attemptId, context);
    return context;
  } catch {
    return null;
  }
}

async function readFsMeta(fileId: string): Promise<FsFileMeta | null> {
  try {
    const content = await fs.readFile(getMetaPath(fileId), 'utf-8');
    return JSON.parse(content) as FsFileMeta;
  } catch {
    return null;
  }
}

async function listFsMetas(): Promise<FsFileMeta[]> {
  try {
    await ensureFilesystemStorage();
    const entries = await fs.readdir(getMetaDir());
    const metas: FsFileMeta[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const fullPath = path.join(getMetaDir(), entry);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        metas.push(JSON.parse(content) as FsFileMeta);
      } catch {
        // Skip invalid metadata file
      }
    }

    return metas;
  } catch {
    return [];
  }
}

async function getCandidateDetailsMap(
  candidateIds: string[],
  adminId?: string
): Promise<Map<string, { name: string; testCodes: Set<string> }>> {
  const uniqueIds = Array.from(new Set(candidateIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const attempts = await prisma.testAttempt.findMany({
    where: {
      candidateId: { in: uniqueIds },
      ...(adminId ? { test: { adminId } } : {}),
    },
    select: {
      candidateId: true,
      test: {
        select: {
          testCode: true
        }
      },
      candidate: {
        select: {
          name: true
        }
      }
    },
    orderBy: { startTime: 'desc' },
  });

  const details = new Map<string, { name: string; testCodes: Set<string> }>();
  for (const attempt of attempts) {
    const candidateId = attempt.candidateId;
    const current = details.get(candidateId) || {
      name: attempt.candidate.name || candidateId,
      testCodes: new Set<string>(),
    };
    current.testCodes.add(attempt.test.testCode);
    details.set(candidateId, current);
  }

  return details;
}

function matchesReferences(meta: FsFileMeta, refs: FileReferences): boolean {
  const metaRefs = meta.references || {};
  if (refs.attemptId && metaRefs.attemptId !== refs.attemptId) return false;
  if (refs.questionId && metaRefs.questionId !== refs.questionId) return false;
  if (refs.candidateId && metaRefs.candidateId !== refs.candidateId) return false;
  if (refs.sessionId && metaRefs.sessionId !== refs.sessionId) return false;
  return true;
}

/**
 * Validate file type and size
 */
export function validateFile(
  mimeType: string,
  fileSize: number,
  allowedTypes: 'media' | 'document' | 'recording' | 'snapshot'
): { valid: boolean; error?: string } {
  let allowedMimeTypes: string[];
  let maxSize: number;

  switch (allowedTypes) {
    case 'media':
      allowedMimeTypes = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];
      if (ALLOWED_VIDEO_TYPES.includes(mimeType)) {
        maxSize = MAX_VIDEO_SIZE;
      } else if (ALLOWED_AUDIO_TYPES.includes(mimeType)) {
        maxSize = MAX_AUDIO_SIZE;
      } else {
        maxSize = MAX_IMAGE_SIZE;
      }
      break;
    case 'document':
      allowedMimeTypes = ALLOWED_DOCUMENT_TYPES;
      maxSize = MAX_DOCUMENT_SIZE;
      break;
    case 'recording':
      allowedMimeTypes = [...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];
      maxSize = MAX_VIDEO_SIZE;
      break;
    case 'snapshot':
      allowedMimeTypes = ALLOWED_IMAGE_TYPES;
      maxSize = MAX_SNAPSHOT_SIZE;
      break;
    default:
      return { valid: false, error: 'Invalid file type category' };
  }

  if (!allowedMimeTypes.includes(mimeType)) {
    return { valid: false, error: `File type ${mimeType} is not allowed` };
  }

  if (fileSize > maxSize) {
    return { valid: false, error: `File size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB` };
  }

  return { valid: true };
}

/**
 * Get media type from MIME type
 */
export function getMediaType(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return 'image';
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return 'video';
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return 'audio';
  return 'document';
}

/**
 * Generate a unique filename with original extension
 */
export function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const timestamp = Date.now();
  const uniqueId = uuidv4().substring(0, 8);
  return `${timestamp}-${uniqueId}${ext}`;
}

/**
 * Store file in configured storage backend
 */
export async function storeFile(
  buffer: Buffer,
  filename: string,
  originalName: string,
  mimeType: string,
  category: string,
  references: FileReferences = {},
  metadata?: Record<string, unknown>
): Promise<UploadResult> {
  try {
    if (isFilesystemMode()) {
      await ensureFilesystemStorage();
      const fileId = uuidv4();
      const ext = getMimeExtension(mimeType, originalName || filename);
      const relativePathFromMetadata = (metadata?.relativePath as string | undefined)?.trim();
      const objectFilename = relativePathFromMetadata || `${fileId}${ext}`;
      const objectPath = path.join(getObjectsDir(), objectFilename);
      const meta: FsFileMeta = {
        id: fileId,
        filename: objectFilename,
        originalName: originalName || filename,
        mimeType,
        fileSize: buffer.length,
        category,
        references,
        metadata,
        createdAt: new Date().toISOString(),
      };

      await fs.mkdir(path.dirname(objectPath), { recursive: true });
      await fs.writeFile(objectPath, buffer);
      await fs.writeFile(getMetaPath(fileId), JSON.stringify(meta));

      const url = `/api/files/${fileId}`;
      return {
        success: true,
        url,
        cdnUrl: url,
        key: objectFilename,
        fileId,
      };
    }

    const fileRecord = await prisma.fileStorage.create({
      data: {
        filename,
        originalName,
        mimeType,
        fileSize: buffer.length,
        data: buffer,
        category,
        attemptId: references.attemptId,
        questionId: references.questionId,
        candidateId: references.candidateId,
        sessionId: references.sessionId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    const url = `/api/files/${fileRecord.id}`;
    return {
      success: true,
      url,
      cdnUrl: url,
      key: fileRecord.id,
      fileId: fileRecord.id,
    };
  } catch (error) {
    console.error('Error storing file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to store file',
    };
  }
}

/**
 * Upload proctoring recording (webcam/screen/audio)
 */
export async function uploadRecording(
  buffer: Buffer,
  attemptId: string,
  recordingType: 'webcam' | 'screen' | 'audio' | 'combined',
  mimeType: string
): Promise<UploadResult> {
  const ext = mimeType.includes('video') ? '.webm' : '.wav';
  const timestamp = Date.now();
  const filename = `${attemptId}-${recordingType}-${timestamp}${ext}`;
  const candidateContext = await getAttemptCandidateContext(attemptId);
  const candidateFolder = candidateContext?.candidateName || `attempt-${attemptId.slice(0, 8)}`;
  const relativePath = path.join(
    getCandidateDataRootDirName(),
    candidateFolder,
    'recordings',
    filename
  );

  return storeFile(
    buffer,
    filename,
    filename,
    mimeType,
    'recording',
    { attemptId },
    {
      recordingType,
      timestamp,
      candidateName: candidateContext?.candidateName,
      candidateId: candidateContext?.candidateId,
      relativePath: isFilesystemMode() ? relativePath : undefined,
      storageMode: isFilesystemMode() ? 'filesystem' : 'database',
    }
  );
}

/**
 * Upload proctoring snapshot (face detection, violation evidence)
 */
export async function uploadSnapshot(
  buffer: Buffer,
  attemptId: string,
  snapshotType: 'face' | 'violation' | 'verification',
  mimeType: string = 'image/jpeg'
): Promise<UploadResult> {
  const timestamp = Date.now();
  const filename = `${attemptId}-${snapshotType}-${timestamp}.jpg`;
  const candidateContext = await getAttemptCandidateContext(attemptId);
  const candidateFolder = candidateContext?.candidateName || `attempt-${attemptId.slice(0, 8)}`;
  const relativePath = path.join(
    getCandidateDataRootDirName(),
    candidateFolder,
    'snapshots',
    filename
  );

  return storeFile(
    buffer,
    filename,
    filename,
    mimeType,
    'snapshot',
    { attemptId },
    {
      snapshotType,
      timestamp,
      candidateName: candidateContext?.candidateName,
      candidateId: candidateContext?.candidateId,
      relativePath: isFilesystemMode() ? relativePath : undefined,
      storageMode: isFilesystemMode() ? 'filesystem' : 'database',
    }
  );
}

/**
 * Upload MCQ media asset (image, video, audio)
 */
export async function uploadMCQMedia(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  questionId?: string
): Promise<UploadResult> {
  const filename = generateUniqueFilename(originalName);
  const questionFolder = sanitizePathSegment(questionId || 'unassigned');
  const relativePath = path.join(getQuestionBankRootDirName(), questionFolder, filename);

  return storeFile(
    buffer,
    filename,
    originalName,
    mimeType,
    'mcq_media',
    { questionId },
    {
      mediaType: getMediaType(mimeType),
      relativePath: isFilesystemMode() ? relativePath : undefined,
    }
  );
}

function inferMimeTypeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.ogg':
      return 'video/ogg';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export async function getFileByStorageKey(storageKey: string): Promise<StoredFile | null> {
  const key = (storageKey || '').trim();
  if (!key) return null;

  if (isFilesystemMode()) {
    await ensureFilesystemStorage();
    const objectsDir = getObjectsDir();
    const objectPath = path.resolve(objectsDir, key);

    // Prevent path traversal outside storage root.
    if (!objectPath.startsWith(path.resolve(objectsDir) + path.sep) && objectPath !== path.resolve(objectsDir)) {
      return null;
    }

    if (!fsSync.existsSync(objectPath) || !fsSync.statSync(objectPath).isFile()) {
      return null;
    }

    const metas = await listFsMetas();
    const meta = metas.find(m => m.filename === key || m.id === key);
    const data = await fs.readFile(objectPath);
    const mimeType = meta?.mimeType || inferMimeTypeFromName(key);
    const originalName = meta?.originalName || path.basename(key);

    return {
      id: meta?.id || key,
      filename: key,
      originalName,
      mimeType,
      fileSize: data.length,
      category: meta?.category || 'unknown',
      data,
      metadata: meta?.metadata,
      createdAt: meta ? new Date(meta.createdAt) : new Date(),
    };
  }

  // In database mode, storage key is usually the file id.
  return getFile(key);
}

/**
 * Upload ID verification document
 */
export async function uploadIdDocument(
  buffer: Buffer,
  candidateId: string,
  documentType: 'id_front' | 'id_back' | 'selfie' | 'face_reference',
  mimeType: string
): Promise<UploadResult> {
  const ext = mimeType.includes('pdf')
    ? '.pdf'
    : mimeType.includes('png')
      ? '.png'
      : mimeType.includes('webp')
        ? '.webp'
        : '.jpg';
  const timestamp = Date.now();
  const filename = `${candidateId}-${documentType}-${timestamp}${ext}`;

  return storeFile(
    buffer,
    filename,
    filename,
    mimeType,
    'id_document',
    { candidateId },
    { documentType, timestamp }
  );
}

/**
 * Get file by ID
 */
export async function getFile(fileId: string): Promise<StoredFile | null> {
  try {
    if (isFilesystemMode()) {
      const meta = await readFsMeta(fileId);
      if (!meta) return null;

      const objectPath = path.join(getObjectsDir(), meta.filename);
      if (!fsSync.existsSync(objectPath)) return null;

      const data = await fs.readFile(objectPath);
      return {
        id: meta.id,
        filename: meta.filename,
        originalName: meta.originalName,
        mimeType: meta.mimeType,
        fileSize: meta.fileSize,
        category: meta.category,
        data,
        metadata: meta.metadata,
        createdAt: new Date(meta.createdAt),
      };
    }

    const file = await prisma.fileStorage.findUnique({
      where: { id: fileId },
    });

    if (!file) return null;

    return {
      id: file.id,
      filename: file.filename,
      originalName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      category: file.category,
      data: file.data,
      metadata: file.metadata ? JSON.parse(file.metadata) : undefined,
      createdAt: file.createdAt,
    };
  } catch (error) {
    console.error('Error retrieving file:', error);
    return null;
  }
}

/**
 * Get files by category and reference
 */
export async function getFilesByReference(
  category: string,
  references: FileReferences
): Promise<Omit<StoredFile, 'data'>[]> {
  try {
    if (isFilesystemMode()) {
      const metas = await listFsMetas();
      return metas
        .filter(meta => meta.category === category && matchesReferences(meta, references))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(meta => ({
          id: meta.id,
          filename: meta.filename,
          originalName: meta.originalName,
          mimeType: meta.mimeType,
          fileSize: meta.fileSize,
          category: meta.category,
          data: Buffer.alloc(0),
          metadata: meta.metadata,
          createdAt: new Date(meta.createdAt),
        }));
    }

    const files = await prisma.fileStorage.findMany({
      where: {
        category,
        ...references,
      },
      select: {
        id: true,
        filename: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        category: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return files.map(file => ({
      id: file.id,
      filename: file.filename,
      originalName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      category: file.category,
      data: Buffer.alloc(0),
      metadata: file.metadata ? JSON.parse(file.metadata) : undefined,
      createdAt: file.createdAt,
    }));
  } catch (error) {
    console.error('Error retrieving files:', error);
    return [];
  }
}

/**
 * Delete file by ID
 */
export async function deleteFile(fileId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (isFilesystemMode()) {
      const meta = await readFsMeta(fileId);
      if (!meta) return { success: true };

      const objectPath = path.join(getObjectsDir(), meta.filename);
      await fs.rm(objectPath, { force: true });
      await fs.rm(getMetaPath(fileId), { force: true });
      return { success: true };
    }

    await prisma.fileStorage.delete({
      where: { id: fileId },
    });
    return { success: true };
  } catch (error) {
    console.error('Error deleting file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete file',
    };
  }
}

/**
 * Delete files by reference (cleanup)
 */
export async function deleteFilesByReference(
  category: string,
  references: FileReferences
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  try {
    if (isFilesystemMode()) {
      const metas = await listFsMetas();
      const targets = metas.filter(meta => meta.category === category && matchesReferences(meta, references));
      for (const target of targets) {
        await deleteFile(target.id);
      }
      return { success: true, deletedCount: targets.length };
    }

    const result = await prisma.fileStorage.deleteMany({
      where: {
        category,
        ...references,
      },
    });
    return { success: true, deletedCount: result.count };
  } catch (error) {
    console.error('Error deleting files:', error);
    return {
      success: false,
      deletedCount: 0,
      error: error instanceof Error ? error.message : 'Failed to delete files',
    };
  }
}

/**
 * Check if file exists
 */
export async function fileExists(fileId: string): Promise<boolean> {
  try {
    if (isFilesystemMode()) {
      const meta = await readFsMeta(fileId);
      if (!meta) return false;
      return fsSync.existsSync(path.join(getObjectsDir(), meta.filename));
    }

    const file = await prisma.fileStorage.findUnique({
      where: { id: fileId },
      select: { id: true },
    });
    return !!file;
  } catch {
    return false;
  }
}

/**
 * Get total storage used by category
 */
export async function getStorageStats(): Promise<{
  totalFiles: number;
  totalSize: number;
  byCategory: Record<string, { count: number; size: number }>;
}> {
  try {
    if (isFilesystemMode()) {
      const metas = await listFsMetas();
      const byCategory: Record<string, { count: number; size: number }> = {};
      let totalFiles = 0;
      let totalSize = 0;

      for (const meta of metas) {
        if (!byCategory[meta.category]) {
          byCategory[meta.category] = { count: 0, size: 0 };
        }
        byCategory[meta.category].count += 1;
        byCategory[meta.category].size += meta.fileSize;
        totalFiles += 1;
        totalSize += meta.fileSize;
      }

      return { totalFiles, totalSize, byCategory };
    }

    const stats = await prisma.fileStorage.groupBy({
      by: ['category'],
      _count: { id: true },
      _sum: { fileSize: true },
    });

    const byCategory: Record<string, { count: number; size: number }> = {};
    let totalFiles = 0;
    let totalSize = 0;

    for (const stat of stats) {
      byCategory[stat.category] = {
        count: stat._count.id,
        size: stat._sum.fileSize || 0,
      };
      totalFiles += stat._count.id;
      totalSize += stat._sum.fileSize || 0;
    }

    return { totalFiles, totalSize, byCategory };
  } catch (error) {
    console.error('Error getting storage stats:', error);
    return { totalFiles: 0, totalSize: 0, byCategory: {} };
  }
}

export async function listIdDocumentsAdmin(
  adminId: string,
  filters: AdminIdDocumentFilters = {}
): Promise<AdminIdDocumentRecord[]> {
  try {
    const searchLower = filters.search?.trim().toLowerCase();
    const candidateNameLower = filters.candidateName?.trim().toLowerCase();
    const testCodeLower = filters.testCode?.trim().toLowerCase();
    const documentTypeFilter = filters.documentType?.trim().toLowerCase();

    const mapToRecord = (
      fileId: string,
      filename: string,
      originalName: string,
      mimeType: string,
      fileSize: number,
      createdAt: string,
      category: string,
      references: FileReferences | undefined,
      metadata: Record<string, unknown> | undefined,
      candidateDetailsMap: Map<string, { name: string; testCodes: Set<string> }>
    ): AdminIdDocumentRecord | null => {
      if (category !== 'id_document') return null;

      const candidateId = String(references?.candidateId || metadata?.candidateId || '').trim();
      if (!candidateId) return null;

      const details = candidateDetailsMap.get(candidateId);
      if (!details) return null;
      const candidateName = String(metadata?.candidateName || details.name || candidateId);
      const testCode = String(metadata?.testCode || Array.from(details.testCodes)[0] || 'unknown_test');
      const documentType = String(metadata?.documentType || 'unknown').toLowerCase();
      const relativePath = typeof metadata?.relativePath === 'string' ? metadata.relativePath : undefined;

      // Strictly scope documents to test candidates under this admin.
      if (testCode !== 'unknown_test' && !details.testCodes.has(testCode)) return null;

      const searchable = `${filename} ${originalName} ${candidateName} ${testCode} ${documentType}`.toLowerCase();
      if (searchLower && !searchable.includes(searchLower)) return null;
      if (candidateNameLower && !candidateName.toLowerCase().includes(candidateNameLower)) return null;
      if (testCodeLower && !testCode.toLowerCase().includes(testCodeLower)) return null;
      if (documentTypeFilter && documentType !== documentTypeFilter) return null;

      return {
        fileId,
        filename,
        originalName,
        mimeType,
        fileSize,
        createdAt,
        candidateId,
        candidateName,
        testCode,
        documentType,
        relativePath,
      };
    };

    if (isFilesystemMode()) {
      const metas = await listFsMetas();
      const candidateIds = metas
        .filter(meta => meta.category === 'id_document')
        .map(meta => String(meta.references?.candidateId || meta.metadata?.candidateId || ''))
        .filter(Boolean);
      const candidateDetailsMap = await getCandidateDetailsMap(candidateIds, adminId);

      return metas
        .map(meta =>
          mapToRecord(
            meta.id,
            meta.filename,
            meta.originalName,
            meta.mimeType,
            meta.fileSize,
            meta.createdAt,
            meta.category,
            meta.references,
            meta.metadata,
            candidateDetailsMap
          )
        )
        .filter((item): item is AdminIdDocumentRecord => !!item)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const files = await prisma.fileStorage.findMany({
      where: { category: 'id_document' },
      select: {
        id: true,
        filename: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        category: true,
        candidateId: true,
        metadata: true,
        createdAt: true,
      },
    });

    const candidateIds = files.map(file => file.candidateId || '').filter(Boolean) as string[];
    const candidateDetailsMap = await getCandidateDetailsMap(candidateIds, adminId);

    return files
      .map(file => {
        const metadata = file.metadata
          ? (JSON.parse(file.metadata) as Record<string, unknown>)
          : undefined;
        return mapToRecord(
          file.id,
          file.filename,
          file.originalName,
          file.mimeType,
          file.fileSize,
          file.createdAt.toISOString(),
          file.category,
          { candidateId: file.candidateId || undefined },
          metadata,
          candidateDetailsMap
        );
      })
      .filter((item): item is AdminIdDocumentRecord => !!item)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    console.error('Error listing ID documents for admin:', error);
    return [];
  }
}

/**
 * Store base64 encoded file (for frontend snapshots)
 */
export async function storeBase64File(
  base64Data: string,
  filename: string,
  mimeType: string,
  category: string,
  references: FileReferences = {},
  metadata?: Record<string, unknown>
): Promise<UploadResult> {
  try {
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Content, 'base64');

    return storeFile(buffer, filename, filename, mimeType, category, references, metadata);
  } catch (error) {
    console.error('Error storing base64 file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to store base64 file',
    };
  }
}

export default {
  storeFile,
  uploadRecording,
  uploadSnapshot,
  uploadMCQMedia,
  uploadIdDocument,
  getFile,
  getFilesByReference,
  deleteFile,
  deleteFilesByReference,
  fileExists,
  validateFile,
  getMediaType,
  generateUniqueFilename,
  getStorageStats,
  listIdDocumentsAdmin,
  storeBase64File,
};
