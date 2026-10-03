const router = require('express').Router();
const { query } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { adminOnly } = require('../../middleware/adminOnly');
const { logEvent } = require('../../services/logService');

// GET /api/admin/payments
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    const payments = await query(`
      SELECT pr.*, u.name as user_name, u.email as user_email, u.avatar_url, p.name as plan_name, p.storage_mb
      FROM payment_requests pr
      JOIN users u ON pr.user_id = u.id
      JOIN plans p ON pr.plan_id = p.id
      WHERE pr.status = ?
      ORDER BY pr.created_at DESC
    `, [status]);

    res.json({ payments });
  } catch (err) {
    console.error('Admin payments error:', err);
    res.status(500).json({ message: 'Failed to load payments' });
  }
});

// POST /api/admin/payments/:id/confirm
router.post('/:id/confirm', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const payments = await query('SELECT * FROM payment_requests WHERE id = ? AND status = ?', [id, 'pending']);
    if (payments.length === 0) {
      return res.status(404).json({ message: 'Payment request not found' });
    }

    const payment = payments[0];

    // Update payment status
    await query(
      'UPDATE payment_requests SET status = ?, confirmed_by = ?, confirmed_at = NOW() WHERE id = ?',
      ['confirmed', req.user.id, id]
    );

    // Update user plan
    if (payment.custom_gb) {
      await query(
        'UPDATE users SET plan_id = ?, custom_storage_mb = ? WHERE id = ?',
        [payment.plan_id, payment.custom_gb * 1024, payment.user_id]
      );
    } else {
      await query(
        'UPDATE users SET plan_id = ?, custom_storage_mb = NULL WHERE id = ?',
        [payment.plan_id, payment.user_id]
      );
    }

    await logEvent(req.user.id, 'payment-confirmed', 'payment', parseInt(id), req.ip, {
      userId: payment.user_id,
      amount: payment.amount_etb,
    });

    res.json({ message: 'Payment confirmed, user upgraded' });
  } catch (err) {
    console.error('Confirm payment error:', err);
    res.status(500).json({ message: 'Failed to confirm payment' });
  }
});

// POST /api/admin/payments/:id/reject
router.post('/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    await query('UPDATE payment_requests SET status = ? WHERE id = ? AND status = ?', ['rejected', id, 'pending']);

    await logEvent(req.user.id, 'payment-rejected', 'payment', parseInt(id), req.ip);

    res.json({ message: 'Payment rejected' });
  } catch (err) {
    console.error('Reject payment error:', err);
    res.status(500).json({ message: 'Failed to reject payment' });
  }
});

module.exports = router;
