import { Request, Response } from 'express';
import prisma from '../utils/db';
import {
  submitVerification,
  getVerificationStatus,
  adminVerify,
  checkVerificationRequired,
  DocumentType,
} from '../services/verificationService';
import { uploadIdDocument } from '../services/fileStorageService';

/**
 * Submit verification documents and selfie
 */
export const submitVerificationDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const candidateId = (req as any).candidate?.id;
    const { documentType, documentImageData, selfieImageData, livenessImages } = req.body;

    if (!candidateId) {
      res.status(401).json({ error: 'Candidate authentication required' });
      return;
    }

    if (!documentType || !documentImageData || !selfieImageData) {
      res.status(400).json({ error: 'Document type, document image, and selfie are required' });
      return;
    }

    // Validate document type
    const validTypes: DocumentType[] = ['national_id', 'passport', 'drivers_license', 'student_id'];
    if (!validTypes.includes(documentType)) {
      res.status(400).json({ error: 'Invalid document type' });
      return;
    }

    const result = await submitVerification(candidateId, {
      documentType,
      documentImageData,
      selfieImageData,
      livenessImages,
    });

    res.json({
      success: result.success,
      status: result.status,
      scores: result.scores,
      error: result.error,
    });
  } catch (error) {
    console.error('Error submitting verification:', error);
    res.status(500).json({ error: 'Failed to process verification' });
  }
};

/**
 * Get current verification status for candidate
 */
export const getMyVerificationStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const candidateId = (req as any).candidate?.id;

    if (!candidateId) {
      res.status(401).json({ error: 'Candidate authentication required' });
      return;
    }

    const status = await getVerificationStatus(candidateId);

    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('Error getting verification status:', error);
    res.status(500).json({ error: 'Failed to get verification status' });
  }
};

/**
 * Check if verification is required for a test
 */
export const checkTestVerificationRequired = async (req: Request, res: Response): Promise<void> => {
  try {
    const candidateId = (req as any).candidate?.id;
    const { testId } = req.params;

    if (!candidateId) {
      res.status(401).json({ error: 'Candidate authentication required' });
      return;
    }

    const result = await checkVerificationRequired(candidateId, testId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error checking verification requirement:', error);
    res.status(500).json({ error: 'Failed to check verification requirement' });
  }
};

/**
 * Upload face reference photo for proctoring
 */
export const uploadFaceReference = async (req: Request, res: Response): Promise<void> => {
  try {
    const candidateId = (req as any).candidate?.id;
    const { imageData } = req.body;

    if (!candidateId) {
      res.status(401).json({ error: 'Candidate authentication required' });
      return;
    }

    if (!imageData) {
      res.status(400).json({ error: 'Image data is required' });
      return;
    }

    const buffer = Buffer.from(imageData, 'base64');
    const uploadResult = await uploadIdDocument(buffer, candidateId, 'face_reference', 'image/jpeg');

    if (!uploadResult.success) {
      res.status(500).json({ error: 'Failed to upload face reference' });
      return;
    }

    // Update or create identity record
    await prisma.candidateIdentity.upsert({
      where: { candidateId },
      create: {
        candidateId,
        faceReferenceUrl: uploadResult.cdnUrl || uploadResult.url,
        verificationStatus: 'pending',
      },
      update: {
        faceReferenceUrl: uploadResult.cdnUrl || uploadResult.url,
      },
    });

    res.json({
      success: true,
      faceReferenceUrl: uploadResult.cdnUrl || uploadResult.url,
    });
  } catch (error) {
    console.error('Error uploading face reference:', error);
    res.status(500).json({ error: 'Failed to upload face reference' });
  }
};

// ==================== ADMIN ENDPOINTS ====================

/**
 * Get all pending verifications
 */
export const getPendingVerifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) {
      where.verificationStatus = status;
    }

    const [verifications, total] = await Promise.all([
      prisma.candidateIdentity.findMany({
        where,
        include: {
          candidate: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { lastAttemptAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.candidateIdentity.count({ where }),
    ]);

    res.json({
      success: true,
      verifications,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Error getting verifications:', error);
    res.status(500).json({ error: 'Failed to get verifications' });
  }
};

/**
 * Get verification details for a candidate
 */
export const getVerificationDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { candidateId } = req.params;

    const identity = await prisma.candidateIdentity.findUnique({
      where: { candidateId },
      include: {
        candidate: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!identity) {
      res.status(404).json({ error: 'Verification record not found' });
      return;
    }

    res.json({
      success: true,
      identity,
    });
  } catch (error) {
    console.error('Error getting verification details:', error);
    res.status(500).json({ error: 'Failed to get verification details' });
  }
};

/**
 * Admin manually approve verification
 */
export const approveVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const { candidateId } = req.params;
    const adminId = (req as any).admin?.id;

    const result = await adminVerify(candidateId, adminId, 'verify');

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      message: 'Verification approved',
    });
  } catch (error) {
    console.error('Error approving verification:', error);
    res.status(500).json({ error: 'Failed to approve verification' });
  }
};

/**
 * Admin manually reject verification
 */
export const rejectVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const { candidateId } = req.params;
    const { reason } = req.body;
    const adminId = (req as any).admin?.id;

    if (!reason) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const result = await adminVerify(candidateId, adminId, 'reject', reason);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      message: 'Verification rejected',
    });
  } catch (error) {
    console.error('Error rejecting verification:', error);
    res.status(500).json({ error: 'Failed to reject verification' });
  }
};

/**
 * Get verification statistics
 */
export const getVerificationStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const [pending, verified, rejected, expired, total] = await Promise.all([
      prisma.candidateIdentity.count({ where: { verificationStatus: 'pending' } }),
      prisma.candidateIdentity.count({ where: { verificationStatus: 'verified' } }),
      prisma.candidateIdentity.count({ where: { verificationStatus: 'rejected' } }),
      prisma.candidateIdentity.count({ where: { verificationStatus: 'expired' } }),
      prisma.candidateIdentity.count(),
    ]);

    res.json({
      success: true,
      stats: {
        pending,
        verified,
        rejected,
        expired,
        total,
        verificationRate: total > 0 ? ((verified / total) * 100).toFixed(1) : 0,
      },
    });
  } catch (error) {
    console.error('Error getting verification stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
};
