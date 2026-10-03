const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { adminOnly } = require('../../middleware/adminOnly');
const { logEvent } = require('../../services/logService');

// GET /api/admin/users
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let countQuery = 'SELECT COUNT(*) as total FROM users';
    let dataQuery = `
      SELECT 
        u.id, u.email, u.name, u.avatar_url, u.plan_id, u.storage_used_mb, u.role, u.is_active, u.created_at, 
        p.name as plan_name, p.storage_mb as max_storage,
        (SELECT COUNT(*) FROM files WHERE user_id = u.id) as file_count,
        (SELECT COUNT(*) FROM folders WHERE user_id = u.id) as folder_count
      FROM users u
      JOIN plans p ON u.plan_id = p.id
    `;
    const params = [];

    if (search) {
      const whereClause = ' WHERE u.name LIKE ? OR u.email LIKE ?';
      countQuery += whereClause.replace(/u\./g, '');
      dataQuery += whereClause;
      params.push(`%${search}%`, `%${search}%`);
    }

    dataQuery += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';

    const [countResult] = await query(countQuery, params);
    const users = await query(dataQuery, [...params, limit, offset]);

    res.json({
      users,
      totalPages: Math.ceil(countResult.total / limit),
      currentPage: page,
    });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ message: 'Failed to load users' });
  }
});

// POST /api/admin/users/:id/reset-password
router.post('/:id/reset-password', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);

    await logEvent(req.user.id, 'password-reset', 'user', parseInt(id), req.ip);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

// POST /api/admin/users/:id/revoke
router.post('/:id/revoke', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await query('UPDATE users SET is_active = FALSE WHERE id = ?', [id]);
    await query(
      'INSERT INTO account_revocations (user_id, reason, revoked_by) VALUES (?, ?, ?)',
      [id, reason || 'No reason provided', req.user.id]
    );

    await logEvent(req.user.id, 'revoke', 'user', parseInt(id), req.ip, { reason });

    res.json({ message: 'Account revoked' });
  } catch (err) {
    console.error('Revoke error:', err);
    res.status(500).json({ message: 'Failed to revoke account' });
  }
});

// POST /api/admin/users/:id/restore
router.post('/:id/restore', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    await query('UPDATE users SET is_active = TRUE WHERE id = ?', [id]);
    await query(
      'UPDATE account_revocations SET restored_at = NOW() WHERE user_id = ? AND restored_at IS NULL',
      [id]
    );

    await logEvent(req.user.id, 'restore', 'user', parseInt(id), req.ip);

    res.json({ message: 'Account restored' });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ message: 'Failed to restore account' });
  }
});

module.exports = router;
