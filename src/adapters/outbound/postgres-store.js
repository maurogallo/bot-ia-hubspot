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

  return { migrate, pool, getOrCreateSession, addMessage, getConversationHistory, updateSessionContext, saveContact };
}

module.exports = { createStore };
