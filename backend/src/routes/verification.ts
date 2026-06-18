import { Router } from 'express';
import { candidateAuth, adminAuth } from '../middleware/auth';
import {
  submitVerificationDocuments,
  getMyVerificationStatus,
  cancelMyPendingVerification,
  checkTestVerificationRequired,
  uploadFaceReference,
  getPendingVerifications,
  getVerificationDetails,
  approveVerification,
  rejectVerification,
  getVerificationStats,
  deleteVerificationImages,
  deleteVerificationRecord,
} from '../controllers/verification';
import {
  createPhoneSession,
  getPhoneSessionStatus,
  uploadPhoneImage,
} from '../controllers/phoneSession';

const router = Router();

// ==================== CANDIDATE VERIFICATION ENDPOINTS ====================

// Submit verification documents (ID + selfie)
router.post('/submit', candidateAuth, submitVerificationDocuments);

// Get my verification status
router.get('/status', candidateAuth, getMyVerificationStatus);

// Cancel a pending/rejected submission so the candidate can re-upload
router.delete('/my-submission', candidateAuth, cancelMyPendingVerification);

// Check if verification is required for a specific test
router.get('/required/:testId', candidateAuth, checkTestVerificationRequired);

// Upload face reference for proctoring
router.post('/face-reference', candidateAuth, uploadFaceReference);

// ==================== PHONE CAMERA SESSION ENDPOINTS ====================

// Create a phone session (returns sessionId; desktop builds the QR URL)
router.post('/phone-session', candidateAuth, createPhoneSession);

// Poll session status — public (phone page also uses this to validate session)
router.get('/phone-session/:id', getPhoneSessionStatus);

// Phone uploads captured image — public (session ID acts as one-time token)
router.post('/phone-upload/:id', uploadPhoneImage);

// ==================== ADMIN VERIFICATION ENDPOINTS ====================

// Get all verifications with filtering
router.get('/admin/list', adminAuth, getPendingVerifications);

// Get verification statistics
router.get('/admin/stats', adminAuth, getVerificationStats);

// Get verification details for a candidate
router.get('/admin/:candidateId', adminAuth, getVerificationDetails);

// Approve verification
router.post('/admin/:candidateId/approve', adminAuth, approveVerification);

// Reject verification
router.post('/admin/:candidateId/reject', adminAuth, rejectVerification);

// Admin-triggered image deletion (keeps verification record, removes stored files)
router.delete('/admin/:candidateId/images', adminAuth, deleteVerificationImages);

// Admin deletes entire verification record (images + DB row)
router.delete('/admin/:candidateId', adminAuth, deleteVerificationRecord);

export default router;
