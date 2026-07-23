const { Pool } = require('pg');
const logger = require('../../logger');
const config = require('../../config');

function createStore() {
  const pool = new Pool({
    host: config.db.host, port: config.db.port,
    database: config.db.database, user: config.db.user,
    password: config.db.password, max: config.db.max,
    idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => logger.error('PostgreSQL pool error', { error: err.message }));

  async function migrate() {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'web')),
          contact_id TEXT, phone TEXT,
          context JSONB DEFAULT '{}', metadata JSONB DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
          content TEXT NOT NULL, metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS contacts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          hubspot_id TEXT UNIQUE, name TEXT, email TEXT UNIQUE, phone TEXT,
          last_interaction TIMESTAMPTZ, metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
      `);
      logger.info('Database migrations completed');
    } catch (err) { logger.error('Migration failed', { error: err.message }); throw err; }
    finally { client.release(); }
  }

  async function query(text, params) {
    const start = Date.now();
    const result = await pool.query(text, params);
    logger.debug('Query', { text: text.substring(0, 80), duration: Date.now() - start });
    return result;
  }

  async function getOrCreateSession(channel, contactId = null, phone = null) {
    if (phone) {
      const existing = await query(
        'SELECT * FROM sessions WHERE phone = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1',
        [phone]
      );
      if (existing.rows.length > 0) {
        await query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [existing.rows[0].id]);
        return existing.rows[0];
      }
    }
    const result = await query(
      `INSERT INTO sessions (channel, contact_id, phone, context) VALUES ($1, $2, $3, '{}'::jsonb) RETURNING *`,
      [channel, contactId, phone]
    );
    logger.info('Session created', { sessionId: result.rows[0].id, channel, phone });
    return result.rows[0];
  }

  async function addMessage(sessionId, role, content, metadata = {}) {
    const result = await query(
      `INSERT INTO messages (session_id, role, content, metadata) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
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

  async function saveContact({ hubspotId, name, email, phone }) {
    await query(
      `INSERT INTO contacts (hubspot_id, name, email, phone, last_interaction)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (hubspot_id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email,
         phone = EXCLUDED.phone, last_interaction = NOW()`,
      [hubspotId, name, email, phone]
    );
  }

  async function getActiveConversations(limit = 20) {
    const result = await query(`
      SELECT s.id, s.channel, s.phone, s.contact_id, s.is_active,
             s.created_at, s.updated_at,
             (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT role FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_role,
             (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count,
             (SELECT COUNT(*) FROM messages WHERE session_id = s.id AND role = 'user') as user_messages
      FROM sessions s
      WHERE s.is_active = true
      ORDER BY s.updated_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async function getConversationById(sessionId) {
    const session = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    if (session.rows.length === 0) return null;
    const messages = await query(
      'SELECT role, content, metadata, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    );
    return { session: session.rows[0], messages: messages.rows };
  }

  async function getLeads() {
    const result = await query(
      'SELECT * FROM contacts ORDER BY last_interaction DESC NULLS LAST, created_at DESC'
    );
    return result.rows;
  }

  async function getHandoffSessions() {
    const result = await query(`
      SELECT s.id, s.channel, s.phone, s.contact_id, s.context,
             s.created_at, s.updated_at,
             (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
      FROM sessions s
      WHERE s.is_active = true AND s.context->>'handoffNeeded' = 'true'
        AND (s.context->>'handoffAssignedTo' IS NULL OR s.context->>'handoffAssignedTo' = '')
      ORDER BY s.updated_at DESC
    `);
    return result.rows;
  }

  async function assignHandoff(sessionId, assignedTo) {
    const session = await query('SELECT context FROM sessions WHERE id = $1', [sessionId]);
    if (session.rows.length === 0) throw new Error('Sesión no encontrada');
    const context = session.rows[0].context || {};
    context.handoffAssignedTo = assignedTo;
    context.handoffAssignedAt = new Date().toISOString();
    await query('UPDATE sessions SET context = $1::jsonb, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(context), sessionId]);
    logger.info('Handoff assigned', { sessionId, assignedTo });
  }

  async function getStats() {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM sessions) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE is_active = true) as active_sessions,
        (SELECT COUNT(*) FROM contacts) as total_leads,
        (SELECT COUNT(*) FROM messages) as total_messages,
        (SELECT COUNT(*) FROM messages WHERE created_at >= NOW() - INTERVAL '24 hours') as messages_24h
    `);
    return result.rows[0];
  }

  return { migrate, pool, getOrCreateSession, addMessage, getConversationHistory,
    updateSessionContext, saveContact, getActiveConversations, getConversationById, getLeads, getStats,
    getHandoffSessions, assignHandoff };
}

module.exports = { createStore };
