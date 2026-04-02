import express from 'express';
import {
  deleteFile,
  getFile,
  getFileByStorageKey,
  getStorageStats,
  listIdDocumentsAdmin,
} from '../services/fileStorageService.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/files/:fileId
 * Serve a file from PostgreSQL storage
 */
router.get('/admin/id-documents', adminAuth as any, async (req, res) => {
  try {
    const { search, candidateName, testCode, documentType } = req.query;
    const adminId = (req as any).admin?.id as string | undefined;
    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const items = await listIdDocumentsAdmin(adminId, {
      search: typeof search === 'string' ? search : undefined,
      candidateName: typeof candidateName === 'string' ? candidateName : undefined,
      testCode: typeof testCode === 'string' ? testCode : undefined,
      documentType:
        typeof documentType === 'string'
          ? (documentType as 'id_front' | 'id_back' | 'selfie' | 'face_reference')
          : undefined,
    });

    return res.json({
      success: true,
      items,
      total: items.length,
    });
  } catch (error) {
    console.error('Error listing admin ID documents:', error);
    return res.status(500).json({ error: 'Failed to list ID documents' });
  }
});

router.delete('/admin/id-documents/:fileId', adminAuth as any, async (req, res) => {
  try {
    const { fileId } = req.params;
    const result = await deleteFile(fileId);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to delete file' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting ID document:', error);
    return res.status(500).json({ error: 'Failed to delete ID document' });
  }
});

router.get('/path/*', async (req, res) => {
  try {
    const storageKeyRaw = ((req.params as Record<string, string>)[0] || '');
    const storageKey = decodeURIComponent(storageKeyRaw);
    const file = await getFileByStorageKey(storageKey);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.fileSize);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    return res.send(file.data);
  } catch (error) {
    console.error('Error serving file by storage key:', error);
    return res.status(500).json({ error: 'Failed to serve file' });
  }
});

router.get('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await getFile(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.fileSize);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);

    // Cache headers for performance
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
    res.setHeader('ETag', `"${fileId}"`);

    // Check for conditional request
    if (req.headers['if-none-match'] === `"${fileId}"`) {
      return res.status(304).end();
    }

    return res.send(file.data);
  } catch (error) {
    console.error('Error serving file:', error);
    return res.status(500).json({ error: 'Failed to serve file' });
  }
});

/**
 * GET /api/files/:fileId/download
 * Download a file (forces download instead of inline display)
 */
router.get('/:fileId/download', async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await getFile(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set headers for download
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.fileSize);
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);

    return res.send(file.data);
  } catch (error) {
    console.error('Error downloading file:', error);
    return res.status(500).json({ error: 'Failed to download file' });
  }
});

/**
 * GET /api/files/stats (admin only)
 * Get storage statistics
 */
router.get('/admin/stats', adminAuth as any, async (_req, res) => {
  try {
    const stats = await getStorageStats();

    // Convert bytes to human-readable format
    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    return res.json({
      totalFiles: stats.totalFiles,
      totalSize: stats.totalSize,
      totalSizeFormatted: formatSize(stats.totalSize),
      byCategory: Object.fromEntries(
        Object.entries(stats.byCategory).map(([category, data]) => [
          category,
          {
            ...data,
            sizeFormatted: formatSize(data.size),
          },
        ])
      ),
    });
  } catch (error) {
    console.error('Error getting storage stats:', error);
    return res.status(500).json({ error: 'Failed to get storage stats' });
  }
});

export default router;
