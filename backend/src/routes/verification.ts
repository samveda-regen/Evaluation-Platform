import { Router } from 'express';
import { candidateAuth, adminAuth } from '../middleware/auth';
import {
  submitVerificationDocuments,
  getMyVerificationStatus,
  checkTestVerificationRequired,
  uploadFaceReference,
  getPendingVerifications,
  getVerificationDetails,
  approveVerification,
  rejectVerification,
  getVerificationStats,
} from '../controllers/verification';

const router = Router();

// ==================== CANDIDATE VERIFICATION ENDPOINTS ====================

// Submit verification documents (ID + selfie)
router.post('/submit', candidateAuth, submitVerificationDocuments);

// Get my verification status
router.get('/status', candidateAuth, getMyVerificationStatus);

// Check if verification is required for a specific test
router.get('/required/:testId', candidateAuth, checkTestVerificationRequired);

// Upload face reference for proctoring
router.post('/face-reference', candidateAuth, uploadFaceReference);

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

export default router;
