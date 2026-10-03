const router = require('express').Router();
const { GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, BUCKET } = require('../config/s3');
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');
const { logEvent } = require('../services/logService');

async function attachThumbnailUrls(files) {
  return Promise.all(files.map(async (file) => {
    if (file.thumbnail_key) {
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: file.thumbnail_key });
      file.thumbnail_url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    }
    return file;
  }));
}

// GET /api/files — list files in folder
router.get('/', auth, async (req, res) => {
  try {
    const { folderId } = req.query;
    let files;

    if (folderId) {
      files = await query(
        'SELECT * FROM files WHERE user_id = ? AND folder_id = ? AND upload_status = ? ORDER BY created_at DESC',
        [req.user.id, folderId, 'ready']
      );
    } else {
      files = await query(
        'SELECT * FROM files WHERE user_id = ? AND folder_id IS NULL AND upload_status = ? ORDER BY created_at DESC',
        [req.user.id, 'ready']
      );
    }

    files = await attachThumbnailUrls(files);
    res.json({ files });
  } catch (err) {
    console.error('List files error:', err);
    res.status(500).json({ message: 'Failed to list files' });
  }
});

// GET /api/files/search
router.get('/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ files: [] });

    const files = await query(
      'SELECT * FROM files WHERE user_id = ? AND upload_status = ? AND original_name LIKE ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id, 'ready', `%${q}%`]
    );

    files = await attachThumbnailUrls(files);
    res.json({ files });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ message: 'Search failed' });
  }
});

// DELETE /api/files/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const files = await query('SELECT * FROM files WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = files[0];

    // Delete from S3
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.s3_key }));
      if (file.thumbnail_key) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.thumbnail_key }));
      }
    } catch {
      // Continue even if S3 delete fails
    }

    // Delete from DB
    await query('DELETE FROM files WHERE id = ?', [id]);

    // Update user storage
    await query('UPDATE users SET storage_used_mb = GREATEST(0, storage_used_mb - ?) WHERE id = ?',
      [file.size_mb, req.user.id]);

    await logEvent(req.user.id, 'delete', 'file', id, req.ip, { name: file.original_name });

    res.json({ message: 'File deleted' });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ message: 'Failed to delete file' });
  }
});

module.exports = router;
