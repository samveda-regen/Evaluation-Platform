import { Router } from 'express';
import { adminAuth, candidateAuth } from '../middleware/auth';
import {
  uploadRecording,
  listRecordings,
  deleteRecording,
  listCandidateRecordings,
  deleteCandidateRecording,
  uploadCandidateChunk,
  finalizeCandidateRecording,
} from '../controllers/dataCollection';

const router = Router();

// Admin - manual recordings
router.post('/upload', adminAuth, uploadRecording);
router.get('/', adminAuth, listRecordings);
router.delete('/:fileId', adminAuth, deleteRecording);

// Admin - view/manage candidate-session (start-test -> submit-test) recordings
router.get('/candidate-recordings', adminAuth, listCandidateRecordings);
router.delete('/candidate-recordings/:fileId', adminAuth, deleteCandidateRecording);

// Candidate - auto webcam recording for the active test attempt
router.post('/candidate/chunk', candidateAuth, uploadCandidateChunk);
router.post('/candidate/finalize', candidateAuth, finalizeCandidateRecording);

export default router;
