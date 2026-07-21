const { query } = require('./database');
const logger = require('./logger');

async function getOrCreateSession(channel, contactId = null, phone = null) {
  if (phone) {
    const existing = await query(
      'SELECT * FROM sessions WHERE phone = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1',
      [phone]
    );
    if (existing.rows.length > 0) {
      await query(
        'UPDATE sessions SET updated_at = NOW() WHERE id = $1',
        [existing.rows[0].id]
      );
      return existing.rows[0];
    }
  }

  const result = await query(
    `INSERT INTO sessions (channel, contact_id, phone, context)
     VALUES ($1, $2, $3, '{}'::jsonb)
     RETURNING *`,
    [channel, contactId, phone]
  );
  logger.info('New session created', { sessionId: result.rows[0].id, channel, phone });
  return result.rows[0];
}

async function addMessage(sessionId, role, content, metadata = {}) {
  const result = await query(
    `INSERT INTO messages (session_id, role, content, metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING *`,
    [sessionId, role, content, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

async function getConversationHistory(sessionId, limit = 20) {
  const result = await query(
    'SELECT role, content, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
    [sessionId, limit]
  );
  return result.rows;
}

async function updateSessionContext(sessionId, context) {
  await query(
    'UPDATE sessions SET context = $1::jsonb, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(context), sessionId]
  );
}

async function getSessionContext(sessionId) {
  const result = await query('SELECT context FROM sessions WHERE id = $1', [sessionId]);
  return result.rows[0]?.context || {};
}

module.exports = {
  getOrCreateSession,
  addMessage,
  getConversationHistory,
  updateSessionContext,
  getSessionContext,
};
