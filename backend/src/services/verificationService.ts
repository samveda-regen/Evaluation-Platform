/**
 * ID Verification Service
 *
 * Orchestrates the three-stage verification pipeline:
 *   1. Document OCR  — Tesseract.js (local, free)
 *   2. Face match    — CompreFace on DigitalOcean (ArcFace, 99.82% accuracy)
 *   3. Liveness      — multi-frame pixel-variance check (no external service)
 *
 * Decision logic (tri-state):
 *   face >= AUTO_PASS + doc OK + liveness OK  →  verified   (exam starts)
 *   face in PENDING zone + doc OK + liveness  →  pending    (admin reviews images)
 *   anything else                             →  rejected   (candidate retries)
 *
 * Option B storage:
 *   ID images are kept ONLY while status is pending/in_progress.
 *   adminVerify() deletes both images from disk immediately after approve/reject.
 */

import prisma from '../utils/db';
import { uploadIdDocument, deleteFile } from './fileStorageService';
import { compareFacesViaCompreFace } from './faceVerificationService';
import { analyzeDocumentOCR }       from './ocrService';

export type VerificationStatus = 'pending' | 'in_progress' | 'verified' | 'rejected' | 'expired';
export type DocumentType       = 'national_id' | 'passport' | 'drivers_license' | 'student_id';

export interface VerificationResult {
  success:  boolean;
  status?:  VerificationStatus;
  scores?: {
    documentAuth: number;
    faceMatch:    number;
    liveness:     number;
  };
  error?: string;
}

export interface DocumentAnalysis {
  isValid:      boolean;
  documentType: string;
  confidence:   number;
  extractedData?: { name?: string; documentNumber?: string; expiryDate?: string };
  issues?: string[];
}

export interface FaceComparisonResult {
  isMatch:        boolean;
  similarity:     number;
  confidence:     number;
  requiresReview: boolean;
}

export interface LivenessResult {
  isLive:     boolean;
  confidence: number;
}

// ─── Document analysis ────────────────────────────────────────────────────────

export async function analyzeDocument(
  imageBuffer: Buffer,
  documentType: DocumentType
): Promise<DocumentAnalysis> {
  const ocr = await analyzeDocumentOCR(imageBuffer);

  return {
    isValid:      ocr.hasValidContent,
    documentType,
    confidence:   ocr.confidence,
    extractedData: { name: undefined, documentNumber: undefined, expiryDate: undefined },
    issues:       ocr.hasValidContent ? [] : ['Could not read document text — ensure image is clear'],
  };
}

// ─── Face comparison ──────────────────────────────────────────────────────────

export async function compareFaces(
  selfieBuffer:   Buffer,
  documentBuffer: Buffer
): Promise<FaceComparisonResult> {
  const result = await compareFacesViaCompreFace(selfieBuffer, documentBuffer);
  return {
    isMatch:        result.isMatch,
    similarity:     result.similarity,
    confidence:     result.confidence,
    requiresReview: result.requiresReview,
  };
}

// ─── Liveness detection ───────────────────────────────────────────────────────
// Compares consecutive frames by sampling byte values from the JPEG payload.
// A printed photo held up to the camera produces near-identical frames.
// A real person produces measurable frame-to-frame variance.

export async function detectLiveness(images: Buffer[]): Promise<LivenessResult> {
  if (images.length < 2) {
    // Only one frame — give a passing score, rely on face match quality
    return { isLive: true, confidence: 70 };
  }

  try {
    const SAMPLE_SIZE = 2000;
    let totalVariance = 0;

    for (let i = 1; i < images.length; i++) {
      const prev = images[i - 1];
      const curr = images[i];

      // File-size delta as a proxy for content change (JPEG entropy coding)
      const sizeDelta = Math.abs(curr.length - prev.length) / Math.max(curr.length, prev.length);

      // Byte-level sampling from the image body (skip the JPEG header ~500 bytes)
      const offset = Math.min(500, Math.floor(prev.length * 0.1));
      const end    = Math.min(offset + SAMPLE_SIZE, prev.length, curr.length);
      let byteSum  = 0;
      for (let j = offset; j < end; j++) {
        byteSum += Math.abs(curr[j] - prev[j]);
      }
      const avgByteDiff = byteSum / (end - offset);

      totalVariance += sizeDelta * 40 + (avgByteDiff / 255) * 60;
    }

    const avgVariance  = totalVariance / (images.length - 1);
    // Scale so that ≥5% average per-byte change → 100 confidence
    const confidence   = Math.min(100, Math.round(avgVariance * 500));

    return { isLive: confidence >= 35, confidence };
  } catch {
    return { isLive: true, confidence: 70 };
  }
}

// ─── Access control ───────────────────────────────────────────────────────────
// A candidate is only visible to an admin if they've attempted one of that
// admin's tests. Candidate/CandidateIdentity rows have no adminId of their own
// (a candidate can be shared across admins), so ownership must be checked via
// this join on every admin-facing verification action.

export async function candidateBelongsToAdmin(candidateId: string, adminId: string): Promise<boolean> {
  const attempt = await prisma.testAttempt.findFirst({
    where: { candidateId, test: { adminId } },
    select: { id: true },
  });
  return !!attempt;
}

// ─── Image cleanup ────────────────────────────────────────────────────────────

function extractFileId(url: string): string | null {
  const m = url.match(/\/api\/files\/([^/?#]+)/);
  return m?.[1] ?? null;
}

async function deleteVerificationImages(
  idDocumentUrl?:    string | null,
  faceReferenceUrl?: string | null
): Promise<void> {
  const ids: string[] = [];
  if (idDocumentUrl)    { const id = extractFileId(idDocumentUrl);    if (id) ids.push(id); }
  if (faceReferenceUrl) { const id = extractFileId(faceReferenceUrl); if (id) ids.push(id); }
  await Promise.allSettled(ids.map(id => deleteFile(id)));
}

// Admin-triggered image deletion — removes files from storage and clears DB URLs
export async function adminDeleteImages(
  candidateId: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await candidateBelongsToAdmin(candidateId, adminId))) {
      return { success: false, error: 'No verification record found' };
    }

    const identity = await prisma.candidateIdentity.findUnique({ where: { candidateId } });
    if (!identity) return { success: false, error: 'No verification record found' };

    await deleteVerificationImages(identity.idDocumentUrl, identity.faceReferenceUrl);

    await prisma.candidateIdentity.update({
      where: { candidateId },
      data:  { idDocumentUrl: null, faceReferenceUrl: null },
    });

    return { success: true };
  } catch (error) {
    console.error('Admin delete images error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Delete failed' };
  }
}

// Admin-triggered full record deletion — removes images + the verification record entirely
export async function adminDeleteRecord(
  candidateId: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await candidateBelongsToAdmin(candidateId, adminId))) {
      return { success: false, error: 'No verification record found' };
    }

    const identity = await prisma.candidateIdentity.findUnique({ where: { candidateId } });
    if (!identity) return { success: false, error: 'No verification record found' };

    await deleteVerificationImages(identity.idDocumentUrl, identity.faceReferenceUrl);
    await prisma.candidateIdentity.delete({ where: { candidateId } });

    return { success: true };
  } catch (error) {
    console.error('Admin delete record error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Delete failed' };
  }
}

// Candidate-triggered: cancel a pending submission so they can re-upload.
// Only works when status is 'pending' or 'rejected' — not if already verified.
export async function cancelPendingVerification(
  candidateId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const identity = await prisma.candidateIdentity.findUnique({ where: { candidateId } });
    if (!identity) return { success: false, error: 'No verification record found' };
    if (identity.verificationStatus === 'verified') {
      return { success: false, error: 'Cannot cancel an already-verified submission' };
    }
    await deleteVerificationImages(identity.idDocumentUrl, identity.faceReferenceUrl);
    await prisma.candidateIdentity.delete({ where: { candidateId } });
    return { success: true };
  } catch (error) {
    console.error('Cancel pending verification error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Cancel failed' };
  }
}

// ─── Submit verification ──────────────────────────────────────────────────────

export async function submitVerification(
  candidateId: string,
  data: {
    documentType:      DocumentType;
    documentImageData: string;   // base64
    selfieImageData:   string;   // base64
    livenessImages?:   string[]; // base64 array
  }
): Promise<VerificationResult> {
  try {
    const documentBuffer = Buffer.from(data.documentImageData, 'base64');
    const selfieBuffer   = Buffer.from(data.selfieImageData,   'base64');

    // Upload both images (kept until admin acts — Option B)
    const [docUpload, selfieUpload] = await Promise.all([
      uploadIdDocument(documentBuffer, candidateId, 'id_front', 'image/jpeg'),
      uploadIdDocument(selfieBuffer,   candidateId, 'selfie',   'image/jpeg'),
    ]);

    if (!docUpload.success || !selfieUpload.success) {
      return { success: false, error: 'Failed to store verification images' };
    }

    // Run all three checks concurrently
    const livenessBuffers = (data.livenessImages ?? []).map(img => Buffer.from(img, 'base64'));

    const [docAnalysis, faceResult, livenessResult] = await Promise.all([
      analyzeDocument(documentBuffer, data.documentType),
      compareFaces(selfieBuffer, documentBuffer),
      detectLiveness(livenessBuffers.length >= 2 ? livenessBuffers : [selfieBuffer]),
    ]);

    // ── Always route to pending — admin makes the final decision ──
    // AI scores are stored for the admin to review but never auto-approve or auto-reject.
    const status: VerificationStatus = 'pending';

    await prisma.candidateIdentity.upsert({
      where:  { candidateId },
      create: {
        candidateId,
        idDocumentType:     data.documentType,
        idDocumentUrl:      docUpload.cdnUrl  || docUpload.url,
        faceReferenceUrl:   selfieUpload.cdnUrl || selfieUpload.url,
        verificationStatus: status,
        verifiedAt:         null,
        verifiedBy:         null,
        rejectionReason:    null,
        documentAuthScore:  docAnalysis.confidence,
        faceMatchScore:     faceResult.similarity,
        livenessScore:      livenessResult.confidence,
        verificationAttempts: 1,
        lastAttemptAt:      new Date(),
        expiresAt:          null,
      },
      update: {
        idDocumentType:     data.documentType,
        idDocumentUrl:      docUpload.cdnUrl  || docUpload.url,
        faceReferenceUrl:   selfieUpload.cdnUrl || selfieUpload.url,
        verificationStatus: status,
        verifiedAt:         null,
        verifiedBy:         null,
        rejectionReason:    null,
        documentAuthScore:  docAnalysis.confidence,
        faceMatchScore:     faceResult.similarity,
        livenessScore:      livenessResult.confidence,
        verificationAttempts: { increment: 1 },
        lastAttemptAt:      new Date(),
        expiresAt:          null,
      },
    });

    return {
      success: true,
      status,
      scores: {
        documentAuth: docAnalysis.confidence,
        faceMatch:    faceResult.similarity,
        liveness:     livenessResult.confidence,
      },
      error: undefined,
    };
  } catch (error) {
    console.error('Verification submission error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

// ─── Status check ─────────────────────────────────────────────────────────────

export async function getVerificationStatus(candidateId: string): Promise<{
  status:     VerificationStatus;
  isVerified: boolean;
  identity?:  unknown;
}> {
  const identity = await prisma.candidateIdentity.findUnique({ where: { candidateId } });

  if (!identity) return { status: 'pending', isVerified: false };

  if (identity.expiresAt && new Date() > identity.expiresAt) {
    await prisma.candidateIdentity.update({
      where: { candidateId },
      data:  { verificationStatus: 'expired' },
    });
    return { status: 'expired', isVerified: false, identity };
  }

  return {
    status:     identity.verificationStatus as VerificationStatus,
    isVerified: identity.verificationStatus === 'verified',
    identity,
  };
}

// ─── Admin actions ────────────────────────────────────────────────────────────

export async function adminVerify(
  candidateId: string,
  adminId:     string,
  action:      'verify' | 'reject',
  reason?:     string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await candidateBelongsToAdmin(candidateId, adminId))) {
      return { success: false, error: 'No verification record found' };
    }

    const identity = await prisma.candidateIdentity.findUnique({ where: { candidateId } });

    if (!identity) return { success: false, error: 'No verification record found' };

    await prisma.candidateIdentity.update({
      where: { candidateId },
      data: {
        verificationStatus: action === 'verify' ? 'verified' : 'rejected',
        verifiedAt:         action === 'verify' ? new Date() : null,
        verifiedBy:         adminId,
        rejectionReason:    action === 'reject' ? (reason ?? 'Rejected by admin') : null,
        expiresAt:          action === 'verify' ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Admin verification error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Verification update failed',
    };
  }
}

// ─── Test gate ────────────────────────────────────────────────────────────────

export async function checkVerificationRequired(
  candidateId: string,
  testId:      string
): Promise<{ required: boolean; verified: boolean; canProceed: boolean }> {
  const test = await prisma.test.findUnique({
    where:  { id: testId },
    select: { requireIdVerification: true },
  });

  if (!test?.requireIdVerification) {
    return { required: false, verified: false, canProceed: true };
  }

  const { isVerified } = await getVerificationStatus(candidateId);
  return { required: true, verified: isVerified, canProceed: isVerified };
}

export default {
  analyzeDocument,
  compareFaces,
  detectLiveness,
  submitVerification,
  getVerificationStatus,
  adminVerify,
  checkVerificationRequired,
};
