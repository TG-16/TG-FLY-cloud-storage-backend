const router = require('express').Router();
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');

// GET /api/dashboard
router.get('/', auth, async (req, res) => {
  try {
    // User storage info
    const users = await query(
      'SELECT u.storage_used_mb, u.custom_storage_mb, p.storage_mb, p.name as plan_name FROM users u JOIN plans p ON u.plan_id = p.id WHERE u.id = ?',
      [req.user.id]
    );
    const userInfo = users[0];

    // Recent files
    const recentFiles = await query(
      'SELECT id, original_name, mime_type, size_mb, created_at FROM files WHERE user_id = ? AND upload_status = ? ORDER BY created_at DESC LIMIT 5',
      [req.user.id, 'ready']
    );

    // Total files and folders
    const [fileCount] = await query(
      'SELECT COUNT(*) as count FROM files WHERE user_id = ? AND upload_status = ?',
      [req.user.id, 'ready']
    );
    const [folderCount] = await query(
      'SELECT COUNT(*) as count FROM folders WHERE user_id = ?',
      [req.user.id]
    );

    res.json({
      storageUsed: userInfo.storage_used_mb,
      storageTotal: userInfo.custom_storage_mb || userInfo.storage_mb,
      planName: userInfo.plan_name,
      recentFiles,
      totalFiles: fileCount.count,
      totalFolders: folderCount.count,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
});

module.exports = router;
