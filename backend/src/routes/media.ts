import { Router } from 'express';
import { adminAuth } from '../middleware/auth';
import {
  getUploadUrl,
  createMediaAsset,
  uploadMedia,
  getQuestionMedia,
  getMediaAsset,
  updateMediaAsset,
  deleteMediaAsset,
  getUnassignedMedia,
  assignMediaToQuestion,
  removeMediaFromQuestion,
} from '../controllers/media';

const router = Router();

// All media routes require admin authentication

// Get pre-signed URL for direct upload
router.post('/upload-url', adminAuth, getUploadUrl);

// Create media asset record (after browser upload)
router.post('/asset', adminAuth, createMediaAsset);

// Upload media via server (for smaller files)
router.post('/upload', adminAuth, uploadMedia);

// Get all media for a specific question
router.get('/question/:questionId', adminAuth, getQuestionMedia);

// Get all unassigned media
router.get('/unassigned', adminAuth, getUnassignedMedia);

// Get single media asset
router.get('/:assetId', adminAuth, getMediaAsset);

// Update media asset
router.patch('/:assetId', adminAuth, updateMediaAsset);

// Delete media asset
router.delete('/:assetId', adminAuth, deleteMediaAsset);

// Bulk assign media to question
router.post('/question/:questionId/assign', adminAuth, assignMediaToQuestion);

// Remove media from question
router.delete('/:assetId/unassign', adminAuth, removeMediaFromQuestion);

export default router;
