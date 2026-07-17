import { Request, Response } from 'express';
import {
  uploadDataCollectionRecording,
  uploadCandidateDataCollectionRecording,
  listCandidateDataCollectionAdmin,
  saveCandidateRecordingChunk,
  listCandidateRecordingChunkBuffers,
  cleanupCandidateRecordingChunks,
  getFilesByReference,
  deleteFile,
  validateFile,
} from '../services/fileStorageService';
import { chunksToMp4 } from '../services/videoTranscodeService';

/**
 * Upload a standalone webcam recording (admin-triggered data collection),
 * unrelated to candidate exam attempts / proctoring sessions.
 */
export const uploadRecording = async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoData, mimeType, label } = req.body;
    const adminId = (req as any).admin?.id as string | undefined;

    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!videoData || !mimeType) {
      res.status(400).json({ error: 'videoData and mimeType are required' });
      return;
    }

    const base64Content = String(videoData).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Content, 'base64');

    const validation = validateFile(mimeType, buffer.length, 'recording');
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const upload = await uploadDataCollectionRecording(
      buffer,
      mimeType,
      adminId,
      typeof label === 'string' ? label.trim() : undefined
    );

    if (!upload.success) {
      res.status(500).json({ error: upload.error || 'Failed to store recording' });
      return;
    }

    res.status(201).json({
      success: true,
      fileId: upload.fileId,
      url: upload.url,
    });
  } catch (error) {
    console.error('Error uploading data collection recording:', error);
    res.status(500).json({ error: 'Failed to upload recording' });
  }
};

/**
 * List this admin's data collection recordings.
 */
export const listRecordings = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).admin?.id as string | undefined;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const files = await getFilesByReference('data_collection', {});
    const items = files
      .filter((file) => file.metadata?.adminId === adminId)
      .map((file) => ({
        fileId: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        label: (file.metadata?.label as string | null) ?? null,
        createdAt: file.createdAt,
        url: `/api/files/${file.id}`,
      }));

    res.json({ success: true, items, total: items.length });
  } catch (error) {
    console.error('Error listing data collection recordings:', error);
    res.status(500).json({ error: 'Failed to list recordings' });
  }
};

/**
 * Delete one of this admin's data collection recordings.
 */
export const deleteRecording = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).admin?.id as string | undefined;
    const { fileId } = req.params;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const files = await getFilesByReference('data_collection', {});
    const owned = files.find((file) => file.id === fileId && file.metadata?.adminId === adminId);
    if (!owned) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const result = await deleteFile(fileId);
    if (!result.success) {
      res.status(400).json({ error: result.error || 'Failed to delete recording' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting data collection recording:', error);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
};

/**
 * List candidate-session recordings (auto-captured start-test → submit-test)
 * for tests owned by this admin.
 */
export const listCandidateRecordings = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).admin?.id as string | undefined;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const items = await listCandidateDataCollectionAdmin(adminId);
    res.json({ success: true, items, total: items.length });
  } catch (error) {
    console.error('Error listing candidate data collection recordings:', error);
    res.status(500).json({ error: 'Failed to list recordings' });
  }
};

// ==================== CANDIDATE-SIDE: auto webcam recording ====================

/**
 * Receive one MediaRecorder chunk of the candidate's webcam-only recording,
 * captured continuously from "Start Test" to "Submit Test". Chunks are
 * written straight to a temp directory (not held in memory) and stitched
 * into a single MP4 at finalize time.
 */
export const uploadCandidateChunk = async (req: Request, res: Response): Promise<void> => {
  try {
    const attemptId = (req as any).candidate?.attemptId as string | undefined;
    if (!attemptId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { chunkIndex, chunkData } = req.body;
    if (chunkData === undefined || chunkData === null || chunkIndex === undefined) {
      res.status(400).json({ error: 'chunkIndex and chunkData are required' });
      return;
    }

    const buffer = Buffer.from(chunkData, 'base64');
    if (buffer.length > 12 * 1024 * 1024) {
      res.status(413).json({ error: 'Chunk too large' });
      return;
    }

    await saveCandidateRecordingChunk(attemptId, Number(chunkIndex), buffer);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving candidate recording chunk:', error);
    // Best-effort - a missed chunk should never block the exam.
    res.status(500).json({ error: 'Failed to save recording chunk' });
  }
};

// Attempts currently being finalized - guards against a second/duplicate
// finalize request (double-submit, retry, or a race between manual and
// auto-submit) reading the same chunks and producing a duplicate file.
const attemptsBeingFinalized = new Set<string>();

/**
 * Stitch all chunks uploaded for this attempt into a single MP4 (falling
 * back to the raw WebM if transcoding fails - the recording must never be
 * lost just because encoding failed) and store it under DATA COLLECTION.
 * Called once, right before the candidate's test submission completes.
 *
 * Idempotent per attempt: if a recording already exists for this attempt
 * (e.g. a duplicate/retried finalize call), it's returned as-is instead of
 * creating a second file, and any leftover chunks are discarded.
 */
export const finalizeCandidateRecording = async (req: Request, res: Response): Promise<void> => {
  const attemptId = (req as any).candidate?.attemptId as string | undefined;
  if (!attemptId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (attemptsBeingFinalized.has(attemptId)) {
    res.json({ success: true, skipped: true, reason: 'already_finalizing' });
    return;
  }
  attemptsBeingFinalized.add(attemptId);

  try {
    const existing = await getFilesByReference('candidate_data_collection', { attemptId });
    if (existing.length > 0) {
      await cleanupCandidateRecordingChunks(attemptId);
      const first = existing[0];
      res.json({ success: true, fileId: first.id, url: `/api/files/${first.id}`, alreadyFinalized: true });
      return;
    }

    const chunkBuffers = await listCandidateRecordingChunkBuffers(attemptId);
    if (chunkBuffers.length === 0) {
      res.json({ success: true, skipped: true });
      return;
    }

    let finalBuffer: Buffer;
    let mimeType: string;
    try {
      finalBuffer = await chunksToMp4(chunkBuffers);
      mimeType = 'video/mp4';
    } catch (transcodeError) {
      console.error('MP4 transcode failed, saving raw webm instead:', transcodeError);
      finalBuffer = Buffer.concat(chunkBuffers);
      mimeType = 'video/webm';
    }

    const upload = await uploadCandidateDataCollectionRecording(finalBuffer, mimeType, attemptId);
    await cleanupCandidateRecordingChunks(attemptId);

    if (!upload.success) {
      res.status(500).json({ error: upload.error || 'Failed to store recording' });
      return;
    }

    res.json({ success: true, fileId: upload.fileId, url: upload.url });
  } catch (error) {
    console.error('Error finalizing candidate recording:', error);
    res.status(500).json({ error: 'Failed to finalize recording' });
  } finally {
    attemptsBeingFinalized.delete(attemptId);
  }
};

/**
 * Delete a candidate-session recording (admin only, scoped to the admin's
 * own tests) - e.g. to clean up duplicates from before the finalize
 * idempotency guard existed.
 */
export const deleteCandidateRecording = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).admin?.id as string | undefined;
    const { fileId } = req.params;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const items = await listCandidateDataCollectionAdmin(adminId);
    const owned = items.find((item) => item.fileId === fileId);
    if (!owned) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const result = await deleteFile(fileId);
    if (!result.success) {
      res.status(400).json({ error: result.error || 'Failed to delete recording' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting candidate data collection recording:', error);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
};
