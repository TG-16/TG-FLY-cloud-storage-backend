const router = require('express').Router();
const { query } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { adminOnly } = require('../../middleware/adminOnly');

// GET /api/admin/logs
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 30;
    const offset = (page - 1) * limit;
    const { action, userId } = req.query;

    let whereClause = '';
    const params = [];

    if (action) {
      whereClause += ' WHERE el.action = ?';
      params.push(action);
    }
    if (userId) {
      whereClause += whereClause ? ' AND el.user_id = ?' : ' WHERE el.user_id = ?';
      params.push(userId);
    }

    const [countResult] = await query(
      `SELECT COUNT(*) as total FROM event_logs el${whereClause}`,
      params
    );

    const logs = await query(`
      SELECT el.*, u.email, u.name
      FROM event_logs el
      LEFT JOIN users u ON el.user_id = u.id
      ${whereClause}
      ORDER BY el.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json({
      logs,
      totalPages: Math.ceil(countResult.total / limit),
      currentPage: page,
    });
  } catch (err) {
    console.error('Admin logs error:', err);
    res.status(500).json({ message: 'Failed to load logs' });
  }
});

module.exports = router;
