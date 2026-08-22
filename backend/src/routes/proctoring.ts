import { Router } from 'express';
import { candidateAuth, adminAuth } from '../middleware/auth';
import {
  initializeSession,
  submitAnalysis,
  reportViolation,
  uploadFaceSnapshot,
  getRecordingUploadUrl,
  finalizeRecording,
  uploadRecordingChunk,
  endSession,
  getSessionDetails,
  getSessionEvents,
  reviewEvent,
  getSessionRecordings,
  getAttemptProctoringSummary,
  updateMobileDevice,
  updateMonitorCount,
  getLiveTestSessions,
  ingestExternalEngineEvent,
} from '../controllers/proctoring';

const router = Router();

// ==================== CANDIDATE PROCTORING ENDPOINTS ====================

// Initialize proctoring session when test starts
router.post('/session/:attemptId/init', candidateAuth, initializeSession);

// Submit real-time proctoring analysis data
router.post('/session/:sessionId/analysis', candidateAuth, submitAnalysis);

// Report a specific violation
router.post('/session/:sessionId/violation', candidateAuth, reportViolation);
router.post('/session/:sessionId/engine-event', ingestExternalEngineEvent);
router.post('/engine/event', ingestExternalEngineEvent);

// Upload face snapshot
router.post('/session/:sessionId/snapshot', candidateAuth, uploadFaceSnapshot);

// Get pre-signed URL for recording upload
router.post('/session/:sessionId/recording-url', candidateAuth, getRecordingUploadUrl);

// Finalize recording after upload
router.post('/session/:sessionId/recording/finalize', candidateAuth, finalizeRecording);

// Upload recording chunk (camera/screen/audio)
router.post('/session/:sessionId/recording/upload', candidateAuth, uploadRecordingChunk);

// End proctoring session
router.post('/session/:sessionId/end', candidateAuth, endSession);

// Update mobile device pairing
router.post('/session/:sessionId/mobile', candidateAuth, updateMobileDevice);

// Update monitor count
router.post('/session/:sessionId/monitors', candidateAuth, updateMonitorCount);

// ==================== ADMIN PROCTORING ENDPOINTS ====================

// Get proctoring session details
router.get('/admin/session/:sessionId', adminAuth, getSessionDetails);

// Get all events for a session
router.get('/admin/session/:sessionId/events', adminAuth, getSessionEvents);

// Review/dismiss an event
router.patch('/admin/event/:eventId/review', adminAuth, reviewEvent);

// Get recordings for a session
router.get('/admin/session/:sessionId/recordings', adminAuth, getSessionRecordings);

// Get proctoring summary for an attempt
router.get('/admin/attempt/:attemptId/summary', adminAuth, getAttemptProctoringSummary);

// Get all live proctoring sessions for a test
router.get('/admin/test/:testId/live', adminAuth, getLiveTestSessions);

export default router;
