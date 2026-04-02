/**
 * ID Verification Service
 *
 * Handles candidate identity verification including:
 * - Document upload and validation
 * - Face reference capture
 * - Liveness detection
 * - Face matching between ID photo and selfie
 *
 * Note: For production, integrate with:
 * - AWS Rekognition (face comparison, liveness)
 * - Azure Face API
 * - Jumio/Onfido (document verification)
 */

import prisma from '../utils/db';
import { uploadIdDocument } from './fileStorageService';

// Verification status types
export type VerificationStatus = 'pending' | 'in_progress' | 'verified' | 'rejected' | 'expired';

// Document types
export type DocumentType = 'national_id' | 'passport' | 'drivers_license' | 'student_id';

export interface VerificationResult {
  success: boolean;
  status?: VerificationStatus;
  scores?: {
    documentAuth: number;
    faceMatch: number;
    liveness: number;
  };
  error?: string;
}

export interface DocumentAnalysis {
  isValid: boolean;
  documentType: string;
  confidence: number;
  extractedData?: {
    name?: string;
    documentNumber?: string;
    expiryDate?: string;
  };
  issues?: string[];
}

export interface FaceComparisonResult {
  isMatch: boolean;
  similarity: number;
  confidence: number;
}

export interface LivenessResult {
  isLive: boolean;
  confidence: number;
  challenges?: {
    blink?: boolean;
    smile?: boolean;
    turnHead?: boolean;
  };
}

/**
 * Analyze uploaded ID document
 * In production, this would call an OCR/document verification API
 */
export async function analyzeDocument(
  imageBuffer: Buffer,
  documentType: DocumentType
): Promise<DocumentAnalysis> {
  // Placeholder implementation
  // In production, integrate with:
  // - AWS Textract for OCR
  // - Document verification APIs (Jumio, Onfido, Veriff)

  try {
    // Simulate document analysis
    // The actual implementation would:
    // 1. Extract text using OCR
    // 2. Verify document authenticity
    // 3. Extract relevant fields (name, ID number, expiry)
    // 4. Check for tampering

    return {
      isValid: true,
      documentType,
      confidence: 85,
      extractedData: {
        name: undefined, // Would be extracted via OCR
        documentNumber: undefined,
        expiryDate: undefined,
      },
      issues: [],
    };
  } catch (error) {
    console.error('Document analysis error:', error);
    return {
      isValid: false,
      documentType,
      confidence: 0,
      issues: ['Failed to analyze document'],
    };
  }
}

/**
 * Compare face in selfie with face in ID document
 * In production, use AWS Rekognition or Azure Face API
 */
export async function compareFaces(
  selfieBuffer: Buffer,
  documentBuffer: Buffer
): Promise<FaceComparisonResult> {
  // Placeholder implementation
  // In production, integrate with:
  // - AWS Rekognition CompareFaces
  // - Azure Face API
  // - Face++ API

  try {
    // Simulate face comparison
    // The actual implementation would:
    // 1. Detect faces in both images
    // 2. Extract face embeddings
    // 3. Calculate similarity score
    // 4. Return match result

    return {
      isMatch: true,
      similarity: 87,
      confidence: 92,
    };
  } catch (error) {
    console.error('Face comparison error:', error);
    return {
      isMatch: false,
      similarity: 0,
      confidence: 0,
    };
  }
}

/**
 * Perform liveness detection
 * Ensures the person is physically present (not a photo/video)
 */
export async function detectLiveness(
  images: Buffer[],
  challenges?: { blink?: boolean; smile?: boolean; turnHead?: boolean }
): Promise<LivenessResult> {
  // Placeholder implementation
  // In production, integrate with:
  // - AWS Rekognition Liveness
  // - Azure Face API Liveness
  // - BioID

  try {
    // Simulate liveness detection
    // The actual implementation would:
    // 1. Analyze multiple frames for motion
    // 2. Detect 3D depth (if available)
    // 3. Check for challenge responses (blink, smile, head turn)
    // 4. Look for signs of spoofing (photo, video playback)

    return {
      isLive: true,
      confidence: 90,
      challenges: {
        blink: challenges?.blink ?? true,
        smile: challenges?.smile,
        turnHead: challenges?.turnHead,
      },
    };
  } catch (error) {
    console.error('Liveness detection error:', error);
    return {
      isLive: false,
      confidence: 0,
    };
  }
}

/**
 * Submit verification attempt for a candidate
 */
export async function submitVerification(
  candidateId: string,
  data: {
    documentType: DocumentType;
    documentImageData: string; // Base64
    selfieImageData: string; // Base64
    livenessImages?: string[]; // Base64 array for liveness frames
  }
): Promise<VerificationResult> {
  try {
    const documentBuffer = Buffer.from(data.documentImageData, 'base64');
    const selfieBuffer = Buffer.from(data.selfieImageData, 'base64');

    // Upload document image
    const docUpload = await uploadIdDocument(
      documentBuffer,
      candidateId,
      'id_front',
      'image/jpeg'
    );

    if (!docUpload.success) {
      return { success: false, error: 'Failed to upload document image' };
    }

    // Upload selfie
    const selfieUpload = await uploadIdDocument(
      selfieBuffer,
      candidateId,
      'selfie',
      'image/jpeg'
    );

    if (!selfieUpload.success) {
      return { success: false, error: 'Failed to upload selfie' };
    }

    // Analyze document
    const docAnalysis = await analyzeDocument(documentBuffer, data.documentType);

    // Compare faces
    const faceComparison = await compareFaces(selfieBuffer, documentBuffer);

    // Liveness detection
    let livenessResult: LivenessResult = { isLive: true, confidence: 100 };
    if (data.livenessImages && data.livenessImages.length > 0) {
      const livenessBuffers = data.livenessImages.map(img => Buffer.from(img, 'base64'));
      livenessResult = await detectLiveness(livenessBuffers);
    }

    // Calculate overall verification status
    const isVerified =
      docAnalysis.isValid &&
      docAnalysis.confidence >= 70 &&
      faceComparison.isMatch &&
      faceComparison.similarity >= 70 &&
      livenessResult.isLive &&
      livenessResult.confidence >= 70;

    const status: VerificationStatus = isVerified ? 'verified' : 'rejected';
    const rejectionReasons: string[] = [];

    if (!docAnalysis.isValid || docAnalysis.confidence < 70) {
      rejectionReasons.push('Document verification failed');
    }
    if (!faceComparison.isMatch || faceComparison.similarity < 70) {
      rejectionReasons.push('Face does not match document photo');
    }
    if (!livenessResult.isLive || livenessResult.confidence < 70) {
      rejectionReasons.push('Liveness check failed');
    }

    // Create or update identity record
    await prisma.candidateIdentity.upsert({
      where: { candidateId },
      create: {
        candidateId,
        idDocumentType: data.documentType,
        idDocumentUrl: docUpload.cdnUrl || docUpload.url,
        faceReferenceUrl: selfieUpload.cdnUrl || selfieUpload.url,
        verificationStatus: status,
        verifiedAt: isVerified ? new Date() : null,
        verifiedBy: 'ai_auto_verified',
        rejectionReason: rejectionReasons.length > 0 ? rejectionReasons.join('; ') : null,
        documentAuthScore: docAnalysis.confidence,
        faceMatchScore: faceComparison.similarity,
        livenessScore: livenessResult.confidence,
        verificationAttempts: 1,
        lastAttemptAt: new Date(),
        expiresAt: isVerified ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null, // 1 year
      },
      update: {
        idDocumentType: data.documentType,
        idDocumentUrl: docUpload.cdnUrl || docUpload.url,
        faceReferenceUrl: selfieUpload.cdnUrl || selfieUpload.url,
        verificationStatus: status,
        verifiedAt: isVerified ? new Date() : null,
        verifiedBy: 'ai_auto_verified',
        rejectionReason: rejectionReasons.length > 0 ? rejectionReasons.join('; ') : null,
        documentAuthScore: docAnalysis.confidence,
        faceMatchScore: faceComparison.similarity,
        livenessScore: livenessResult.confidence,
        verificationAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
        expiresAt: isVerified ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null,
      },
    });

    return {
      success: isVerified,
      status,
      scores: {
        documentAuth: docAnalysis.confidence,
        faceMatch: faceComparison.similarity,
        liveness: livenessResult.confidence,
      },
      error: rejectionReasons.length > 0 ? rejectionReasons.join('; ') : undefined,
    };
  } catch (error) {
    console.error('Verification submission error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Get verification status for a candidate
 */
export async function getVerificationStatus(candidateId: string): Promise<{
  status: VerificationStatus;
  isVerified: boolean;
  identity?: any;
}> {
  const identity = await prisma.candidateIdentity.findUnique({
    where: { candidateId },
  });

  if (!identity) {
    return {
      status: 'pending',
      isVerified: false,
    };
  }

  // Check if verification has expired
  if (identity.expiresAt && new Date() > identity.expiresAt) {
    await prisma.candidateIdentity.update({
      where: { candidateId },
      data: { verificationStatus: 'expired' },
    });
    return {
      status: 'expired',
      isVerified: false,
      identity,
    };
  }

  return {
    status: identity.verificationStatus as VerificationStatus,
    isVerified: identity.verificationStatus === 'verified',
    identity,
  };
}

/**
 * Admin: Manually verify/reject a candidate
 */
export async function adminVerify(
  candidateId: string,
  adminId: string,
  action: 'verify' | 'reject',
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const identity = await prisma.candidateIdentity.findUnique({
      where: { candidateId },
    });

    if (!identity) {
      return { success: false, error: 'No verification record found' };
    }

    await prisma.candidateIdentity.update({
      where: { candidateId },
      data: {
        verificationStatus: action === 'verify' ? 'verified' : 'rejected',
        verifiedAt: action === 'verify' ? new Date() : null,
        verifiedBy: adminId,
        rejectionReason: action === 'reject' ? reason : null,
        expiresAt: action === 'verify' ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null,
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

/**
 * Check if candidate needs verification for a test
 */
export async function checkVerificationRequired(
  candidateId: string,
  testId: string
): Promise<{
  required: boolean;
  verified: boolean;
  canProceed: boolean;
}> {
  const test = await prisma.test.findUnique({
    where: { id: testId },
    select: { requireIdVerification: true },
  });

  if (!test) {
    return { required: false, verified: false, canProceed: true };
  }

  if (!test.requireIdVerification) {
    return { required: false, verified: false, canProceed: true };
  }

  const verificationStatus = await getVerificationStatus(candidateId);

  return {
    required: true,
    verified: verificationStatus.isVerified,
    canProceed: verificationStatus.isVerified,
  };
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
