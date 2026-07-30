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

        CREATE TABLE IF NOT EXISTS tenants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug TEXT UNIQUE NOT NULL,
          business_name TEXT NOT NULL,
          business_services TEXT,
          plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','business','pro','enterprise')),
          features JSONB DEFAULT '{}',
          calendar_config JSONB DEFAULT '{}',
          hubspot_config JSONB DEFAULT '{}',
          whatsapp_phone TEXT,
          whatsapp_phone_number_id TEXT,
          owner_name TEXT,
          owner_email TEXT,
          owner_phone TEXT,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
        CREATE INDEX IF NOT EXISTS idx_tenants_whatsapp ON tenants(whatsapp_phone);

        CREATE TABLE IF NOT EXISTS tenant_services (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          price DECIMAL(10,2),
          price_label TEXT DEFAULT 'USD',
          sort_order INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tenant_services_tenant ON tenant_services(tenant_id);

        ALTER TABLE IF EXISTS sessions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
        ALTER TABLE IF EXISTS contacts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

        CREATE TABLE IF NOT EXISTS appointments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID REFERENCES tenants(id),
          session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
          contact_email TEXT NOT NULL,
          contact_name TEXT,
          contact_phone TEXT,
          google_event_id TEXT UNIQUE,
          service_interest TEXT,
          start_time TIMESTAMPTZ NOT NULL,
          end_time TIMESTAMPTZ NOT NULL,
          status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','no_show')),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
        CREATE INDEX IF NOT EXISTS idx_appointments_contact_email ON appointments(contact_email);
        CREATE INDEX IF NOT EXISTS idx_appointments_tenant_id ON appointments(tenant_id);

        CREATE TABLE IF NOT EXISTS usage_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          metric TEXT NOT NULL,
          value INTEGER DEFAULT 1,
          recorded_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_usage_log_tenant ON usage_log(tenant_id, metric);
        CREATE INDEX IF NOT EXISTS idx_usage_log_month ON usage_log(tenant_id, metric, recorded_at);

        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS knowledge (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID REFERENCES tenants(id),
          content TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          embedding vector(768),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
          ON knowledge USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64);
        CREATE INDEX IF NOT EXISTS idx_knowledge_tenant ON knowledge(tenant_id);
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

  async function getOrCreateSession(channel, contactId = null, phone = null, tenantId = null) {
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
      `INSERT INTO sessions (channel, contact_id, phone, context, tenant_id) VALUES ($1, $2, $3, '{}'::jsonb, $4) RETURNING *`,
      [channel, contactId, phone, tenantId]
    );
    logger.info('Session created', { sessionId: result.rows[0].id, channel, phone, tenantId });
    return result.rows[0];
  }

  async function addMessage(sessionId, role, content, metadata = {}) {
    const result = await query(
      `INSERT INTO messages (session_id, role, content, metadata) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
      [sessionId, role, content, JSON.stringify(metadata)]
    );
    return result.rows[0];
  }

  async function getConversationHistory(sessionId, limit = 8) {
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

  async function saveContact({ hubspotId, name, email, phone, tenantId = null }) {
    await query(
      `INSERT INTO contacts (hubspot_id, name, email, phone, last_interaction, tenant_id)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (hubspot_id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email,
         phone = EXCLUDED.phone, last_interaction = NOW(),
         tenant_id = COALESCE(EXCLUDED.tenant_id, contacts.tenant_id)`,
      [hubspotId, name, email, phone, tenantId]
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

  async function getSession(sessionId) {
    const result = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    return result.rows[0] || null;
  }

  async function upsertMemory(sessionId, key, value) {
    const session = await getSession(sessionId);
    if (!session) return;
    const context = session.context || {};
    if (!context.memory) context.memory = {};
    context.memory[key] = value;
    await query('UPDATE sessions SET context = $1::jsonb, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(context), sessionId]);
  }

  async function getMemory(sessionId) {
    const session = await getSession(sessionId);
    return session?.context?.memory || {};
  }

  async function getKnowledgeCount() {
    const result = await query('SELECT COUNT(*) FROM knowledge');
    return parseInt(result.rows[0].count, 10);
  }

  function formatVector(embedding) {
    if (Array.isArray(embedding)) return '[' + embedding.join(',') + ']';
    return embedding;
  }

  async function addKnowledge(content, metadata = {}, embedding) {
    const result = await query(
      'INSERT INTO knowledge (content, metadata, embedding) VALUES ($1, $2::jsonb, $3::vector) RETURNING id, content, metadata, created_at',
      [content, JSON.stringify(metadata), formatVector(embedding)]
    );
    return result.rows[0];
  }

  async function searchKnowledge(embedding, limit = 3) {
    const result = await query(
      `SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity
       FROM knowledge WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT $2`,
      [formatVector(embedding), limit]
    );
    return result.rows;
  }

  async function getAllKnowledge() {
    const result = await query('SELECT id, content, metadata, created_at FROM knowledge ORDER BY created_at ASC');
    return result.rows;
  }

  async function deleteKnowledge(id) {
    await query('DELETE FROM knowledge WHERE id = $1', [id]);
  }

  async function getKnowledgeByTenant(tenantId) {
    const result = await query(
      'SELECT id, content, metadata, created_at FROM knowledge WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY created_at ASC',
      [tenantId]
    );
    return result.rows;
  }

  async function addKnowledgeForTenant(content, metadata = {}, embedding, tenantId = null) {
    const result = await query(
      'INSERT INTO knowledge (tenant_id, content, metadata, embedding) VALUES ($1, $2, $3::jsonb, $4::vector) RETURNING id, content, metadata, created_at',
      [tenantId, content, JSON.stringify(metadata), formatVector(embedding)]
    );
    return result.rows[0];
  }

  async function searchKnowledgeForTenant(embedding, limit = 3, tenantId = null) {
    const result = await query(
      `SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity
       FROM knowledge WHERE embedding IS NOT NULL
         AND (tenant_id IS NULL OR tenant_id = $2)
       ORDER BY embedding <=> $1::vector LIMIT $3`,
      [formatVector(embedding), tenantId, limit]
    );
    return result.rows;
  }

  // ---- Tenants ----

  async function getTenantBySlug(slug) {
    const result = await query('SELECT * FROM tenants WHERE slug = $1 AND is_active = true', [slug]);
    return result.rows[0] || null;
  }

  async function getTenantByPhone(phone) {
    const result = await query('SELECT * FROM tenants WHERE whatsapp_phone = $1 AND is_active = true', [phone]);
    return result.rows[0] || null;
  }

  async function getTenantByPhoneNumberId(phoneNumberId) {
    const result = await query('SELECT * FROM tenants WHERE whatsapp_phone_number_id = $1 AND is_active = true', [phoneNumberId]);
    return result.rows[0] || null;
  }

  async function getDefaultTenant() {
    const result = await query("SELECT * FROM tenants WHERE slug = 'default' AND is_active = true");
    if (result.rows.length > 0) return result.rows[0];
    const all = await query('SELECT * FROM tenants WHERE is_active = true ORDER BY created_at ASC LIMIT 1');
    return all.rows[0] || null;
  }

  async function getAllTenants() {
    const result = await query('SELECT * FROM tenants ORDER BY created_at DESC');
    return result.rows;
  }

  async function createTenant(data) {
    const { slug, businessName, plan = 'starter', features = {},
      calendarConfig = {}, hubspotConfig = {}, whatsappPhone = null,
      whatsappPhoneNumberId = null, ownerName = null, ownerEmail = null,
      ownerPhone = null, businessServices = null } = data;
    const result = await query(
      `INSERT INTO tenants (slug, business_name, business_services, plan, features, calendar_config, hubspot_config,
        whatsapp_phone, whatsapp_phone_number_id, owner_name, owner_email, owner_phone)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12) RETURNING *`,
      [slug, businessName, businessServices, plan, JSON.stringify(features), JSON.stringify(calendarConfig),
        JSON.stringify(hubspotConfig), whatsappPhone, whatsappPhoneNumberId, ownerName, ownerEmail, ownerPhone]
    );
    logger.info('Tenant created', { slug, plan });
    return result.rows[0];
  }

  async function updateTenant(slug, data) {
    const sets = [];
    const values = [];
    let idx = 1;
    const map = {
      businessName: 'business_name',
      businessServices: 'business_services',
      plan: 'plan',
      whatsappPhone: 'whatsapp_phone',
      whatsappPhoneNumberId: 'whatsapp_phone_number_id',
      ownerName: 'owner_name',
      ownerEmail: 'owner_email',
      ownerPhone: 'owner_phone',
      isActive: 'is_active',
    };
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        values.push(data[key]);
      }
    }
    for (const jsonField of ['features', 'calendar_config', 'hubspot_config']) {
      if (data[jsonField] !== undefined) {
        sets.push(`${jsonField} = $${idx++}::jsonb`);
        values.push(JSON.stringify(data[jsonField]));
      }
    }
    if (sets.length === 0) return null;
    sets.push('updated_at = NOW()');
    values.push(slug);
    const result = await query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE slug = $${idx} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async function deactivateTenant(slug) {
    await query("UPDATE tenants SET is_active = false, updated_at = NOW() WHERE slug = $1", [slug]);
  }

  async function getTenantServices(tenantId) {
    const result = await query(
      'SELECT * FROM tenant_services WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order ASC, created_at ASC',
      [tenantId]
    );
    return result.rows;
  }

  async function saveTenantService(data) {
    const { tenantId, name, description = null, price = null, priceLabel = 'USD', sortOrder = 0 } = data;
    const result = await query(
      `INSERT INTO tenant_services (tenant_id, name, description, price, price_label, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, name, description, price, priceLabel, sortOrder]
    );
    return result.rows[0];
  }

  async function deleteTenantService(id) {
    await query('DELETE FROM tenant_services WHERE id = $1', [id]);
  }

  async function getTenantStats(tenantId) {
    const result = await query(
      `SELECT
        (SELECT COUNT(*) FROM sessions WHERE tenant_id = $1) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE tenant_id = $1 AND is_active = true) as active_sessions,
        (SELECT COUNT(*) FROM contacts WHERE tenant_id = $1) as total_leads,
        (SELECT COUNT(*) FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.tenant_id = $1) as total_messages,
        (SELECT COUNT(*) FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.tenant_id = $1 AND m.created_at >= NOW() - INTERVAL '24 hours') as messages_24h,
        (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1) as total_appointments,
        (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1 AND start_time >= NOW()) as upcoming_appointments`,
      [tenantId]
    );
    return result.rows[0];
  }

  // ---- Appointments ----

  async function saveAppointment(data) {
    const { tenantId, sessionId, contactEmail, contactName, contactPhone,
      googleEventId, serviceInterest, startTime, endTime, status = 'confirmed', metadata = {} } = data;
    const result = await query(
      `INSERT INTO appointments (tenant_id, session_id, contact_email, contact_name, contact_phone,
        google_event_id, service_interest, start_time, end_time, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING *`,
      [tenantId, sessionId, contactEmail, contactName, contactPhone,
        googleEventId, serviceInterest, startTime, endTime, status, JSON.stringify(metadata)]
    );
    return result.rows[0];
  }

  async function getAppointmentsByEmail(tenantId, email) {
    const result = await query(
      'SELECT * FROM appointments WHERE tenant_id = $1 AND contact_email = $2 ORDER BY start_time DESC',
      [tenantId, email]
    );
    return result.rows;
  }

  async function getAppointmentsByTenant(tenantId, limit = 50) {
    const result = await query(
      'SELECT * FROM appointments WHERE tenant_id = $1 ORDER BY start_time DESC LIMIT $2',
      [tenantId, limit]
    );
    return result.rows;
  }

  async function getUpcomingAppointments(tenantId, limit = 20) {
    const result = await query(
      'SELECT * FROM appointments WHERE tenant_id = $1 AND start_time >= NOW() AND status = $2 ORDER BY start_time ASC LIMIT $3',
      [tenantId, 'confirmed', limit]
    );
    return result.rows;
  }

  async function updateAppointmentStatus(id, status) {
    await query(
      'UPDATE appointments SET status = $1, metadata = metadata || $2::jsonb WHERE id = $3',
      [status, JSON.stringify({ status_updated_at: new Date().toISOString() }), id]
    );
  }

  async function cancelAppointment(id) {
    await updateAppointmentStatus(id, 'cancelled');
  }

  async function getAppointmentById(id) {
    const result = await query('SELECT * FROM appointments WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  // ---- Usage / Quotas ----

  async function getMonthlyUsage(tenantId, metric) {
    const result = await query(
      `SELECT COALESCE(SUM(value), 0) as total FROM usage_log
       WHERE tenant_id = $1 AND metric = $2
         AND recorded_at >= date_trunc('month', NOW())`,
      [tenantId, metric]
    );
    return parseInt(result.rows[0].total, 10);
  }

  async function logUsage(tenantId, metric, value = 1) {
    await query(
      'INSERT INTO usage_log (tenant_id, metric, value) VALUES ($1, $2, $3)',
      [tenantId, metric, value]
    );
  }

  async function getUsageStats(tenantId) {
    const result = await query(
      `SELECT metric, COALESCE(SUM(value), 0) as total
       FROM usage_log WHERE tenant_id = $1
         AND recorded_at >= date_trunc('month', NOW())
       GROUP BY metric`,
      [tenantId]
    );
    const stats = {};
    for (const row of result.rows) stats[row.metric] = parseInt(row.total, 10);
    return stats;
  }

  // ---- Tenant-scoped existing queries ----

  async function getActiveConversationsByTenant(tenantId, limit = 20) {
    const result = await query(`
      SELECT s.id, s.channel, s.phone, s.contact_id, s.is_active,
             s.created_at, s.updated_at,
             (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT role FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_role,
             (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
      FROM sessions s
      WHERE s.is_active = true AND s.tenant_id = $1
      ORDER BY s.updated_at DESC
      LIMIT $2
    `, [tenantId, limit]);
    return result.rows;
  }

  async function getLeadsByTenant(tenantId) {
    const result = await query(
      'SELECT * FROM contacts WHERE tenant_id = $1 ORDER BY last_interaction DESC NULLS LAST, created_at DESC',
      [tenantId]
    );
    return result.rows;
  }

  async function getHandoffSessionsByTenant(tenantId) {
    const result = await query(`
      SELECT s.id, s.channel, s.phone, s.contact_id, s.context,
             s.created_at, s.updated_at,
             (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
      FROM sessions s
      WHERE s.is_active = true AND s.tenant_id = $1
        AND s.context->>'handoffNeeded' = 'true'
        AND (s.context->>'handoffAssignedTo' IS NULL OR s.context->>'handoffAssignedTo' = '')
      ORDER BY s.updated_at DESC
    `, [tenantId]);
    return result.rows;
  }

  return { migrate, pool, getOrCreateSession, addMessage, getConversationHistory,
    updateSessionContext, saveContact, getActiveConversations, getConversationById, getLeads, getStats,
    getHandoffSessions, assignHandoff, getSession, upsertMemory, getMemory,
    getKnowledgeCount, addKnowledge, searchKnowledge, getAllKnowledge, deleteKnowledge,
    getKnowledgeByTenant, addKnowledgeForTenant, searchKnowledgeForTenant,
    getTenantBySlug, getTenantByPhone, getTenantByPhoneNumberId, getDefaultTenant,
    getAllTenants, createTenant, updateTenant, deactivateTenant, getTenantServices, saveTenantService, deleteTenantService, getTenantStats,
    saveAppointment, getAppointmentsByEmail, getAppointmentsByTenant,
    getUpcomingAppointments, updateAppointmentStatus, cancelAppointment, getAppointmentById,
    getMonthlyUsage, logUsage, getUsageStats,
    getActiveConversationsByTenant, getLeadsByTenant, getHandoffSessionsByTenant };
}

module.exports = { createStore };
