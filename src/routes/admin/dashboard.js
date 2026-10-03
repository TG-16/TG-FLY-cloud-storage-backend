const router = require('express').Router();
const { query } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { adminOnly } = require('../../middleware/adminOnly');

// GET /api/admin/dashboard
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const [totalUsers] = await query('SELECT COUNT(*) as count FROM users');
    const [activeUsers] = await query('SELECT COUNT(*) as count FROM users WHERE is_active = TRUE');
    const [storageRes] = await query('SELECT COALESCE(SUM(storage_used_mb), 0) as total FROM users');
    const [pendingPayments] = await query("SELECT COUNT(*) as count FROM payment_requests WHERE status = 'pending'");

    // Storage by plan
    const storagByPlan = await query(`
      SELECT p.name, COUNT(u.id) as userCount, COALESCE(SUM(u.storage_used_mb), 0) as totalStorage
      FROM plans p
      LEFT JOIN users u ON u.plan_id = p.id
      GROUP BY p.id, p.name
      ORDER BY p.storage_mb ASC
    `);

    // Recent logs
    const recentLogs = await query(`
      SELECT el.*, u.email
      FROM event_logs el
      LEFT JOIN users u ON el.user_id = u.id
      ORDER BY el.created_at DESC
      LIMIT 10
    `);

    res.json({
      totalUsers: totalUsers.count,
      activeUsers: activeUsers.count,
      totalStorageUsed: storageRes.total,
      pendingPayments: pendingPayments.count,
      storagByPlan,
      recentLogs,
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ message: 'Failed to load admin dashboard' });
  }
});

module.exports = router;
