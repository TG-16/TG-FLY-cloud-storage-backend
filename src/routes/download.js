const router = require('express').Router();
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, BUCKET } = require('../config/s3');
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');
const { logEvent } = require('../services/logService');

// GET /api/download/:fileId
router.get('/:fileId', auth, async (req, res) => {
  try {
    const { fileId } = req.params;

    const files = await query(
      'SELECT * FROM files WHERE id = ? AND user_id = ? AND upload_status = ?',
      [fileId, req.user.id, 'ready']
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = files[0];

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: file.s3_key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

    await logEvent(req.user.id, 'download', 'file', file.id, req.ip);

    res.json({
      presignedUrl,
      totalBytes: file.size_mb * 1024 * 1024,
      fileName: file.original_name,
      mimeType: file.mime_type,
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ message: 'Failed to generate download URL' });
  }
});

module.exports = router;
