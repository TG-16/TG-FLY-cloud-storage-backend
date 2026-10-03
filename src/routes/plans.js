const router = require('express').Router();
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');
const { logEvent } = require('../services/logService');

// GET /api/plans
router.get('/', auth, async (req, res) => {
  try {
    const plans = await query('SELECT * FROM plans ORDER BY storage_mb ASC');
    res.json({ plans });
  } catch (err) {
    console.error('Plans error:', err);
    res.status(500).json({ message: 'Failed to fetch plans' });
  }
});

// POST /api/plans/upgrade
router.post('/upgrade', auth, async (req, res) => {
  try {
    const { planId, customGb, bankRef } = req.body;

    if (!planId || !bankRef) {
      return res.status(400).json({ message: 'Plan and bank reference are required' });
    }

    const plans = await query('SELECT * FROM plans WHERE id = ?', [planId]);
    if (plans.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const plan = plans[0];
    let amount = plan.price_etb;

    if (plan.is_custom) {
      if (!customGb || customGb < 1) {
        return res.status(400).json({ message: 'Custom plan requires at least 1 GB' });
      }
      amount = customGb * 6; // 6 ETB per GB
    }

    // Check for existing pending request
    const pending = await query(
      'SELECT id FROM payment_requests WHERE user_id = ? AND status = ?',
      [req.user.id, 'pending']
    );
    if (pending.length > 0) {
      return res.status(400).json({ message: 'You already have a pending upgrade request' });
    }

    await query(
      'INSERT INTO payment_requests (user_id, plan_id, custom_gb, amount_etb, bank_ref) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, planId, customGb || null, amount, bankRef]
    );

    await logEvent(req.user.id, 'upgrade-request', 'plan', planId, req.ip, { amount, bankRef });

    res.json({ message: 'Upgrade request submitted' });
  } catch (err) {
    console.error('Upgrade request error:', err);
    res.status(500).json({ message: 'Failed to submit upgrade request' });
  }
});

module.exports = router;
