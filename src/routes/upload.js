const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { CreateMultipartUploadCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { UploadPartCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET } = require('../config/s3');
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');
const { uploadChunkLimiter } = require('../middleware/rateLimit');
const { validateFile } = require('../middleware/fileValidator');
const { logEvent } = require('../services/logService');

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

// POST /api/upload/initiate
router.post('/initiate', auth, async (req, res) => {
  try {
    const { fileName, fileSize, mimeType, folderId } = req.body;

    if (!fileName || !fileSize) {
      return res.status(400).json({ message: 'fileName and fileSize are required' });
    }

    // Get user's available storage
    const users = await query(
      'SELECT u.storage_used_mb, u.custom_storage_mb, p.storage_mb FROM users u JOIN plans p ON u.plan_id = p.id WHERE u.id = ?',
      [req.user.id]
    );
    const userInfo = users[0];
    const maxStorage = userInfo.custom_storage_mb || userInfo.storage_mb;
    const remainingMb = maxStorage - userInfo.storage_used_mb;

    // Validate file
    const validation = validateFile(fileName, mimeType, fileSize, remainingMb);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.errors.join(', ') });
    }

    const fileSizeMb = fileSize / (1024 * 1024);
    const totalParts = Math.ceil(fileSize / CHUNK_SIZE);
    const fileId = uuidv4();
    const s3Key = `${req.user.id}/${folderId || 'root'}/${fileId}_${validation.sanitizedName}`;

    // Create file record in DB
    const fileResult = await query(
      'INSERT INTO files (user_id, folder_id, original_name, s3_key, mime_type, size_mb, upload_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, folderId || null, fileName, s3Key, mimeType, fileSizeMb, 'uploading']
    );
    const dbFileId = fileResult.insertId;

    // Initiate S3 multipart upload
    const command = new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: mimeType,
    });
    const s3Response = await s3Client.send(command);
    const uploadId = s3Response.UploadId;

    // Save upload session
    await query(
      'INSERT INTO upload_sessions (user_id, file_id, s3_upload_id, completed_parts, total_parts) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, dbFileId, uploadId, JSON.stringify([]), totalParts]
    );

    res.json({
      uploadId,
      fileId: dbFileId,
      totalParts,
      s3Key,
    });
  } catch (err) {
    console.error('Upload initiate error:', err);
    res.status(500).json({ message: 'Failed to initiate upload' });
  }
});

// POST /api/upload/presign — Get presigned URL for a chunk
router.post('/presign', auth, uploadChunkLimiter, async (req, res) => {
  try {
    const { uploadId, partNumber } = req.body;

    // Find the upload session
    const sessions = await query(
      'SELECT us.*, f.s3_key FROM upload_sessions us JOIN files f ON us.file_id = f.id WHERE us.s3_upload_id = ? AND us.user_id = ?',
      [uploadId, req.user.id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Upload session not found' });
    }

    const session = sessions[0];
    const command = new UploadPartCommand({
      Bucket: BUCKET,
      Key: session.s3_key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 min

    res.json({ presignedUrl });
  } catch (err) {
    console.error('Presign error:', err);
    res.status(500).json({ message: 'Failed to generate upload URL' });
  }
});

// POST /api/upload/presign-batch — Get presigned URLs for multiple chunks
router.post('/presign-batch', auth, uploadChunkLimiter, async (req, res) => {
  try {
    const { uploadId, partNumbers } = req.body;

    if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
      return res.status(400).json({ message: 'partNumbers must be a non-empty array' });
    }

    // Find the upload session
    const sessions = await query(
      'SELECT us.*, f.s3_key FROM upload_sessions us JOIN files f ON us.file_id = f.id WHERE us.s3_upload_id = ? AND us.user_id = ?',
      [uploadId, req.user.id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Upload session not found' });
    }

    const session = sessions[0];
    
    // Generate all URLs in parallel
    const urls = {};
    await Promise.all(partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: BUCKET,
        Key: session.s3_key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      urls[partNumber] = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour for batch
    }));

    res.json({ urls });
  } catch (err) {
    console.error('Presign batch error:', err);
    res.status(500).json({ message: 'Failed to generate upload URLs' });
  }
});

// POST /api/upload/complete
router.post('/complete', auth, async (req, res) => {
  try {
    const { uploadId, parts } = req.body;

    const sessions = await query(
      'SELECT us.*, f.s3_key, f.id as file_id, f.size_mb, f.mime_type FROM upload_sessions us JOIN files f ON us.file_id = f.id WHERE us.s3_upload_id = ? AND us.user_id = ?',
      [uploadId, req.user.id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Upload session not found' });
    }

    const session = sessions[0];

    // Complete S3 multipart upload
    const command = new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: session.s3_key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .sort((a, b) => a.PartNumber - b.PartNumber)
          .map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
      },
    });
    await s3Client.send(command);

    // Update file status
    await query('UPDATE files SET upload_status = ? WHERE id = ?', ['ready', session.file_id]);

    // Update user storage
    await query('UPDATE users SET storage_used_mb = storage_used_mb + ? WHERE id = ?',
      [session.size_mb, req.user.id]);

    // Delete upload session
    await query('DELETE FROM upload_sessions WHERE s3_upload_id = ?', [uploadId]);

    await logEvent(req.user.id, 'upload', 'file', session.file_id, req.ip, { size_mb: session.size_mb });

    res.json({ fileId: session.file_id, message: 'Upload complete' });

    // Generate thumbnail in background
    const { generateThumbnail } = require('../services/thumbnailService');
    generateThumbnail(session.file_id, session.s3_key, session.mime_type).catch(err => {
      console.error('Background thumbnail error:', err);
    });
  } catch (err) {
    console.error('Upload complete error:', err);
    res.status(500).json({ message: 'Failed to complete upload' });
  }
});

// GET /api/upload/pending — Get pending upload sessions
router.get('/pending', auth, async (req, res) => {
  try {
    const sessions = await query(
      'SELECT us.*, f.original_name, f.size_mb FROM upload_sessions us JOIN files f ON us.file_id = f.id WHERE us.user_id = ?',
      [req.user.id]
    );
    res.json({ sessions });
  } catch (err) {
    console.error('Pending uploads error:', err);
    res.status(500).json({ message: 'Failed to get pending uploads' });
  }
});

// DELETE /api/upload/:uploadId — Abort upload
router.delete('/:uploadId', auth, async (req, res) => {
  try {
    const { uploadId } = req.params;

    const sessions = await query(
      'SELECT us.*, f.s3_key, f.id as file_id FROM upload_sessions us JOIN files f ON us.file_id = f.id WHERE us.s3_upload_id = ? AND us.user_id = ?',
      [uploadId, req.user.id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Upload session not found' });
    }

    const session = sessions[0];

    // Abort S3 multipart upload
    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: BUCKET,
        Key: session.s3_key,
        UploadId: uploadId,
      });
      await s3Client.send(command);
    } catch {
      // Ignore S3 abort errors
    }

    // Clean up DB
    await query('DELETE FROM upload_sessions WHERE s3_upload_id = ?', [uploadId]);
    await query('DELETE FROM files WHERE id = ?', [session.file_id]);

    res.json({ message: 'Upload aborted' });
  } catch (err) {
    console.error('Abort upload error:', err);
    res.status(500).json({ message: 'Failed to abort upload' });
  }
});

const { ListPartsCommand } = require('@aws-sdk/client-s3');

// GET /api/upload/:uploadId/parts — Get completed parts for an upload session directly from S3
router.get('/:uploadId/parts', auth, async (req, res) => {
  try {
    const { uploadId } = req.params;

    const sessions = await query(
      'SELECT f.s3_key FROM upload_sessions us JOIN files f ON us.file_id = f.id WHERE us.s3_upload_id = ? AND us.user_id = ?',
      [uploadId, req.user.id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Upload session not found' });
    }

    const command = new ListPartsCommand({
      Bucket: BUCKET,
      Key: sessions[0].s3_key,
      UploadId: uploadId,
    });
    
    try {
      const response = await s3Client.send(command);
      const completedParts = (response.Parts || []).map(p => ({
        PartNumber: p.PartNumber,
        ETag: p.ETag
      }));
      res.json({ completedParts });
    } catch (s3Err) {
      res.json({ completedParts: [] }); // Default to empty if S3 throws (e.g. no parts yet)
    }
  } catch (err) {
    console.error('Get parts error:', err);
    res.status(500).json({ message: 'Failed to get upload parts' });
  }
});

module.exports = router;
