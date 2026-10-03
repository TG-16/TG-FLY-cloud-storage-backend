const { query } = require('../config/db');

async function logEvent(userId, action, resourceType = null, resourceId = null, ipAddress = null, metadata = null) {
  try {
    await query(
      'INSERT INTO event_logs (user_id, action, resource_type, resource_id, ip_address, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, action, resourceType, resourceId, ipAddress, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    // Don't fail requests because of logging errors
    console.error('Event log error:', err.message);
  }
}

module.exports = { logEvent };
