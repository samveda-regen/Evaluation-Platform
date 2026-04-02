import { Request, Response } from 'express';
import prisma from '../utils/db';
import {
  uploadMCQMedia,
  deleteFile,
  validateFile,
  getMediaType,
  generateUniqueFilename,
  storeFile,
} from '../services/fileStorageService';

/**
 * Get pre-signed URL for direct browser upload
 */
export const getUploadUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { filename, mimeType, fileSize, questionId } = req.body;

    // Validate file type and size
    const validation = validateFile(mimeType, fileSize, 'media');
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Generate unique filename
    const uniqueFilename = generateUniqueFilename(filename);
    const folder = questionId ? `mcq-media/${questionId}` : 'mcq-media/unassigned';
    const key = `${folder}/${uniqueFilename}`;

    // With PostgreSQL storage, return a server upload endpoint instead of pre-signed URL
    res.json({
      success: true,
      uploadUrl: '/api/media/upload',
      fileUrl: `/api/files/${key}`,
      key,
      filename: uniqueFilename,
    });
  } catch (error) {
    console.error('Error getting upload URL:', error);
    res.status(500).json({ error: 'Failed to get upload URL' });
  }
};

/**
 * Create media asset record after successful upload
 */
export const createMediaAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      filename,
      originalName,
      mimeType,
      fileSize,
      storageUrl,
      storageKey,
      width,
      height,
      duration,
      thumbnailUrl,
      questionId,
    } = req.body;

    const adminId = (req as any).admin?.id;
    const mediaType = getMediaType(mimeType);
    const normalizedQuestionId =
      typeof questionId === 'string' && questionId.trim().length > 0 ? questionId.trim() : null;

    if (normalizedQuestionId) {
      const question = await prisma.mCQQuestion.findUnique({
        where: { id: normalizedQuestionId },
        select: { id: true },
      });

      if (!question) {
        res.status(404).json({ error: 'Question not found' });
        return;
      }
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        filename,
        originalName,
        mimeType,
        fileSize,
        storageUrl,
        storageBucket: process.env.SPACES_BUCKET || 'test-platform',
        storageKey,
        mediaType,
        width,
        height,
        duration,
        thumbnailUrl,
        status: 'ready',
        mcqQuestionId: normalizedQuestionId,
        uploadedBy: adminId,
      },
    });

    res.status(201).json({
      success: true,
      asset,
    });
  } catch (error) {
    console.error('Error creating media asset:', error);
    res.status(500).json({ error: 'Failed to create media asset' });
  }
};

/**
 * Upload media via server (for smaller files)
 */
export const uploadMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const { file, questionId } = req.body;

    if (!file || !file.data || !file.mimeType || !file.originalName) {
      res.status(400).json({ error: 'File data is required' });
      return;
    }

    const normalizedQuestionId =
      typeof questionId === 'string' && questionId.trim().length > 0 ? questionId.trim() : null;

    if (normalizedQuestionId) {
      const question = await prisma.mCQQuestion.findUnique({
        where: { id: normalizedQuestionId },
        select: { id: true },
      });

      if (!question) {
        res.status(404).json({ error: 'Question not found' });
        return;
      }
    }

    // Validate file
    const buffer = Buffer.from(file.data, 'base64');
    const validation = validateFile(file.mimeType, buffer.length, 'media');
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Upload to storage
    const uploadResult = await uploadMCQMedia(
      buffer,
      file.originalName,
      file.mimeType,
      questionId
    );

    if (!uploadResult.success) {
      res.status(500).json({ error: uploadResult.error });
      return;
    }

    const mediaType = getMediaType(file.mimeType);
    const adminId = (req as any).admin?.id;

    // Create database record
    const asset = await prisma.mediaAsset.create({
      data: {
        filename: uploadResult.key!.split('/').pop()!,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: buffer.length,
        storageUrl: uploadResult.cdnUrl || uploadResult.url!,
        storageBucket: 'postgresql',
        storageKey: uploadResult.key!,
        mediaType,
        width: file.width,
        height: file.height,
        duration: file.duration,
        status: 'ready',
        mcqQuestionId: normalizedQuestionId,
        uploadedBy: adminId,
      },
    });

    res.status(201).json({
      success: true,
      asset,
    });
  } catch (error) {
    console.error('Error uploading media:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
};

/**
 * Get all media assets for a question
 */
export const getQuestionMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const { questionId } = req.params;

    const assets = await prisma.mediaAsset.findMany({
      where: { mcqQuestionId: questionId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      assets,
    });
  } catch (error) {
    console.error('Error getting question media:', error);
    res.status(500).json({ error: 'Failed to get media' });
  }
};

/**
 * Get single media asset
 */
export const getMediaAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assetId } = req.params;

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }

    res.json({
      success: true,
      asset,
    });
  } catch (error) {
    console.error('Error getting media asset:', error);
    res.status(500).json({ error: 'Failed to get media' });
  }
};

/**
 * Update media asset (attach to question, update metadata)
 */
export const updateMediaAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assetId } = req.params;
    const { questionId, width, height, duration, thumbnailUrl } = req.body;

    const asset = await prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        mcqQuestionId: questionId,
        width,
        height,
        duration,
        thumbnailUrl,
      },
    });

    res.json({
      success: true,
      asset,
    });
  } catch (error) {
    console.error('Error updating media asset:', error);
    res.status(500).json({ error: 'Failed to update media' });
  }
};

/**
 * Delete media asset
 */
export const deleteMediaAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assetId } = req.params;

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }

    // Delete from storage
    if (asset.storageKey) {
      await deleteFile(asset.storageKey);
    }

    // Delete database record
    await prisma.mediaAsset.delete({
      where: { id: assetId },
    });

    res.json({
      success: true,
      message: 'Media asset deleted',
    });
  } catch (error) {
    console.error('Error deleting media asset:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
};

/**
 * Get all unassigned media assets
 */
export const getUnassignedMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { mcqQuestionId: null },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      assets,
    });
  } catch (error) {
    console.error('Error getting unassigned media:', error);
    res.status(500).json({ error: 'Failed to get media' });
  }
};

/**
 * Bulk assign media to question
 */
export const assignMediaToQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { questionId } = req.params;
    const { assetIds } = req.body;

    if (!assetIds || !Array.isArray(assetIds)) {
      res.status(400).json({ error: 'Asset IDs array is required' });
      return;
    }

    // Verify question exists
    const question = await prisma.mCQQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    // Update all assets
    await prisma.mediaAsset.updateMany({
      where: { id: { in: assetIds } },
      data: { mcqQuestionId: questionId },
    });

    const assets = await prisma.mediaAsset.findMany({
      where: { mcqQuestionId: questionId },
    });

    res.json({
      success: true,
      assets,
    });
  } catch (error) {
    console.error('Error assigning media:', error);
    res.status(500).json({ error: 'Failed to assign media' });
  }
};

/**
 * Remove media from question (but don't delete)
 */
export const removeMediaFromQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assetId } = req.params;

    await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { mcqQuestionId: null },
    });

    res.json({
      success: true,
      message: 'Media removed from question',
    });
  } catch (error) {
    console.error('Error removing media:', error);
    res.status(500).json({ error: 'Failed to remove media' });
  }
};
