const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('../../logger');
const config = require('../../config');

function createApp(deps) {
  const app = express();

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }));
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] }));

  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs, max: config.rateLimit.max,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
  });
  app.use('/api/', limiter);

  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('HTTP request', { method: req.method, path: req.path, status: res.statusCode, duration: Date.now() - start });
    });
    next();
  });

  app.use(express.static(path.resolve(__dirname, '..', '..', '..', 'public'), {
    maxAge: '1h',
    setHeaders: (res, filePath) => { if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript'); },
  }));

  app.get('/widget/test', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Demo Widget</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:linear-gradient(135deg,#f0f4ff,#e0e7ff);min-height:100vh;display:flex;flex-direction:column;
align-items:center;justify-content:center;padding:20px;text-align:center}
h1{color:#1e293b;font-size:28px}.card{background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.08);margin-top:24px}
footer{position:fixed;bottom:0;left:0;right:0;padding:12px;background:#fff;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8}
</style></head><body>
<h1>${config.business.name}</h1>
<div class="card">Bot con IA local + HubSpot CRM</div>
<footer>Ollama + HubSpot</footer>
<script src="/widget.js" data-business="${config.business.name}" data-primary="#2563eb"></script>
</body></html>`);
  });

  app.get('/health', async (req, res) => {
    const ollamaHealth = await deps.ai.checkHealth();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), ollama: ollamaHealth, uptime: process.uptime() });
  });

  app.post('/api/webhook', async (req, res) => {
    const { message, from, channel = 'web' } = req.body;
    if (!message || !from) return res.status(400).json({ error: 'Los campos "message" y "from" son obligatorios' });
    if (typeof message !== 'string' || message.length > 4000) return res.status(400).json({ error: 'Mensaje demasiado largo' });
    try {
      const result = await deps.handleMessage({ message, from, channel, store: deps.store, ai: deps.ai, crm: deps.crm });
      res.json({ reply: result.response, handoffNeeded: result.handoffNeeded });
    } catch (error) {
      logger.error('Webhook error', { error: error.message });
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.get('/oauth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing authorization code');
    try {
      await deps.crm.exchangeAuthorizationCode(code);
      res.send('Autenticación de HubSpot completada.');
    } catch (error) {
      logger.error('OAuth callback error', { error: error.message });
      res.status(500).send('Error al autenticar con HubSpot');
    }
  });

  app.get('/auth/hubspot', async (req, res) => {
    try { res.redirect(await deps.crm.getAuthorizationUrl()); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/status', (req, res) => {
    res.json({
      service: config.business.name,
      version: require('../../../package.json').version,
      environment: config.nodeEnv,
      uptime: process.uptime(),
    });
  });

  app.get('/whatsapp/qr', (req, res) => {
    const qr = deps.getQrCode ? deps.getQrCode() : null;
    if (!qr) return res.status(404).json({ error: 'QR no disponible' });
    res.json({ qr });
  });

  app.get('/dashboard', (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', '..', 'public', 'dashboard.html'));
  });

  app.get('/api/dashboard/stats', async (req, res) => {
    try {
      const stats = await deps.store.getStats();
      res.json(stats);
    } catch (error) {
      logger.error('Dashboard stats error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  });

  app.get('/api/dashboard/conversations', async (req, res) => {
    try {
      const conversations = await deps.store.getActiveConversations();
      res.json(conversations);
    } catch (error) {
      logger.error('Dashboard conversations error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener conversaciones' });
    }
  });

  app.get('/api/dashboard/conversations/:id', async (req, res) => {
    try {
      const conversation = await deps.store.getConversationById(req.params.id);
      if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
      res.json(conversation);
    } catch (error) {
      logger.error('Dashboard conversation detail error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener conversación' });
    }
  });

  app.get('/api/dashboard/leads', async (req, res) => {
    try {
      const leads = await deps.store.getLeads();
      res.json(leads);
    } catch (error) {
      logger.error('Dashboard leads error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener leads' });
    }
  });

  app.get('/api/dashboard/handoffs', async (req, res) => {
    try {
      const handoffs = await deps.store.getHandoffSessions();
      res.json(handoffs);
    } catch (error) {
      logger.error('Dashboard handoffs error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener handoffs' });
    }
  });

  app.post('/api/dashboard/handoffs/:id/assign', async (req, res) => {
    try {
      const { assignedTo } = req.body;
      await deps.store.assignHandoff(req.params.id, assignedTo || 'Agente');
      res.json({ success: true });
    } catch (error) {
      logger.error('Dashboard assign handoff error', { error: error.message });
      res.status(500).json({ error: 'Error al asignar handoff' });
    }
  });

  app.use((req, res) => { res.status(404).json({ error: 'Ruta no encontrada' }); });
  app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { createApp };
