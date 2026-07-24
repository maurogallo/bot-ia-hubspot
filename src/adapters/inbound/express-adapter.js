const path = require('path');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('../../logger');
const config = require('../../config');

const sessionSecret = crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h

function parseCookies(req) {
  const c = req.headers.cookie;
  if (!c) return {};
  return Object.fromEntries(c.split(';').map(x => x.trim().split('=').map(decodeURIComponent)));
}

function signToken(username, password) {
  return crypto.createHmac('sha256', sessionSecret).update(`${username}:${password}`).digest('hex');
}

function verifyToken(token, username, password, ts) {
  if (Date.now() - Number(ts) > TOKEN_TTL) return false;
  return token === signToken(username, password);
}

function requireDashboardAuth(req, res, next) {
  const { username, password } = config.dashboard;
  if (!username || !password) return next();
  const cookies = parseCookies(req);
  const raw = cookies.dashboard_token;
  if (!raw) return res.redirect('/login');
  const [token, ts] = raw.split(':');
  if (!token || !ts || !verifyToken(token, username, password, ts)) return res.redirect('/login');
  next();
}

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
<script src="/widget.js" data-business="${config.business.name}" data-primary="#2563eb"${config.webhookSecret ? ` data-webhook-secret="${config.webhookSecret}"` : ''}></script>
</body></html>`);
  });

  app.get('/health', async (req, res) => {
    const ollamaHealth = await deps.ai.checkHealth();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), ollama: ollamaHealth, uptime: process.uptime(), embeddingModel: config.ollama.embeddingModel });
  });

  function verifyWebhookSignature(req, res, next) {
    const secret = config.webhookSecret;
    if (!secret) return next();
    const signature = req.headers['x-webhook-signature'];
    if (!signature) return res.status(401).json({ error: 'Firma HMAC requerida' });
    const rawBody = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (signature.length !== 64 || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Firma HMAC inválida' });
    }
    next();
  }

  app.post('/api/webhook', verifyWebhookSignature, async (req, res) => {
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
    const accept = req.headers.accept || '';
    if (accept.includes('text/html') || req.query.render === '1') {
      res.type('html').send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>WhatsApp QR - ${config.business.name}</title>
<style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f0f4ff;font-family:-apple-system,sans-serif}
h1{font-size:22px;color:#1e293b;margin-bottom:8px}p{color:#64748b;margin-bottom:24px}
#qr{max-width:400px;width:90%}.steps{text-align:left;background:#fff;padding:20px 28px;border-radius:12px;box-shadow:0 1px 3px #00000010;max-width:400px;font-size:14px;color:#475569;line-height:1.8}
.steps ol{margin:0;padding-left:20px}.steps li{margin:4px 0}</style></head>
<body><h1>${config.business.name}</h1><p>Escanea con WhatsApp para conectar</p>
<img id="qr" src="https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}" alt="QR Code">
<div class="steps"><ol><li>Abrí WhatsApp en tu celular</li><li>Andá a <strong>Dispositivos vinculados</strong></li><li>Tocá <strong>Vincular un dispositivo</strong></li><li>Escaneá este código</li></ol></div>
<p style="color:#94a3b8;font-size:12px;margin-top:16px">El QR se actualiza automáticamente</p>
<script>setInterval(async function(){try{const r=await fetch('/whatsapp/qr?render=1');if(r.ok){const t=await r.text();const m=t.match(/<img[^>]+src="([^"]+)"/);if(m)document.getElementById('qr').src=m[1]}}catch(e){}},5000)</script>
</body></html>`);
    } else {
      res.json({ qr });
    }
  });

  const { username, password } = config.dashboard;
  if (username && password) {
    const loginPage = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Login — ${config.business.name}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e2e8f0}.card{background:#1e293b;padding:40px;border-radius:16px;width:360px;max-width:90%;box-shadow:0 25px 50px #00000040}h1{font-size:22px;margin:0 0 8px;color:#f1f5f9}p{font-size:14px;color:#94a3b8;margin:0 0 24px}label{display:block;font-size:13px;color:#94a3b8;margin-bottom:4px}input{width:100%;padding:10px 14px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;font-size:14px;margin-bottom:16px;outline:none;transition:border-color .2s}input:focus{border-color:#3b82f6}button{width:100%;padding:10px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600;transition:background .2s}button:hover{background:#2563eb}.error{color:#ef4444;font-size:13px;margin-top:12px;text-align:center}</style></head><body><div class="card"><h1>${config.business.name}</h1><p>Ingresá al dashboard</p><form method="post" action="/login"><label for="user">Usuario</label><input type="text" id="user" name="username" required autofocus><label for="pass">Contraseña</label><input type="password" id="pass" name="password" required><button type="submit">Ingresar</button></form></div></body></html>`;

    app.get('/login', (req, res) => {
      const cookies = parseCookies(req);
      const raw = cookies.dashboard_token;
      if (raw) {
        const [token, ts] = raw.split(':');
        if (token && ts && verifyToken(token, username, password, ts)) return res.redirect('/dashboard');
      }
      res.type('html').send(loginPage);
    });

    app.post('/login', express.urlencoded({ extended: true }), (req, res) => {
      if (req.body.username === username && req.body.password === password) {
        const token = signToken(username, password);
        res.cookie('dashboard_token', `${token}:${Date.now()}`, { httpOnly: true, sameSite: 'lax', maxAge: TOKEN_TTL, path: '/' });
        return res.redirect('/dashboard');
      }
      res.type('html').send(loginPage.replace('</form>', '</form><div class="error">Usuario o contraseña incorrectos</div>'));
    });

    app.post('/logout', (req, res) => {
      res.clearCookie('dashboard_token', { path: '/' });
      res.redirect('/login');
    });
  }

  app.get('/dashboard', requireDashboardAuth, (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', '..', 'public', 'dashboard.html'));
  });

  app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', '..', 'public', 'landing.html'));
  });

  app.get('/api/dashboard/stats', requireDashboardAuth, async (req, res) => {
    try {
      const stats = await deps.store.getStats();
      res.json(stats);
    } catch (error) {
      logger.error('Dashboard stats error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  });

  app.get('/api/dashboard/conversations', requireDashboardAuth, async (req, res) => {
    try {
      const conversations = await deps.store.getActiveConversations();
      res.json(conversations);
    } catch (error) {
      logger.error('Dashboard conversations error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener conversaciones' });
    }
  });

  app.get('/api/dashboard/conversations/:id', requireDashboardAuth, async (req, res) => {
    try {
      const conversation = await deps.store.getConversationById(req.params.id);
      if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
      res.json(conversation);
    } catch (error) {
      logger.error('Dashboard conversation detail error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener conversación' });
    }
  });

  app.get('/api/dashboard/leads', requireDashboardAuth, async (req, res) => {
    try {
      const leads = await deps.store.getLeads();
      res.json(leads);
    } catch (error) {
      logger.error('Dashboard leads error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener leads' });
    }
  });

  app.get('/api/dashboard/handoffs', requireDashboardAuth, async (req, res) => {
    try {
      const handoffs = await deps.store.getHandoffSessions();
      res.json(handoffs);
    } catch (error) {
      logger.error('Dashboard handoffs error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener handoffs' });
    }
  });

  app.post('/api/dashboard/handoffs/:id/assign', requireDashboardAuth, async (req, res) => {
    try {
      const { assignedTo } = req.body;
      await deps.store.assignHandoff(req.params.id, assignedTo || 'Agente');
      res.json({ success: true });
    } catch (error) {
      logger.error('Dashboard assign handoff error', { error: error.message });
      res.status(500).json({ error: 'Error al asignar handoff' });
    }
  });

  app.get('/api/knowledge', async (req, res) => {
    try {
      const docs = await deps.store.getAllKnowledge();
      res.json(docs);
    } catch (error) {
      logger.error('Knowledge list error', { error: error.message });
      res.status(500).json({ error: 'Error al obtener documentos' });
    }
  });

  app.post('/api/knowledge', async (req, res) => {
    try {
      const { content, metadata = {} } = req.body;
      if (!content || typeof content !== 'string') return res.status(400).json({ error: 'content es requerido' });
      const embedding = await deps.ai.generateEmbedding(content);
      const doc = await deps.store.addKnowledge(content, metadata, embedding);
      logger.info('Knowledge doc added', { id: doc.id });
      res.status(201).json(doc);
    } catch (error) {
      logger.error('Knowledge add error', { error: error.message });
      res.status(500).json({ error: 'Error al agregar documento' });
    }
  });

  app.delete('/api/knowledge/:id', async (req, res) => {
    try {
      await deps.store.deleteKnowledge(req.params.id);
      res.json({ success: true });
    } catch (error) {
      logger.error('Knowledge delete error', { error: error.message });
      res.status(500).json({ error: 'Error al eliminar documento' });
    }
  });

  app.post('/api/knowledge/reseed', async (req, res) => {
    try {
      const { seedKnowledge } = require('../../app');
      await seedKnowledge();
      res.json({ success: true });
    } catch (error) {
      logger.error('Knowledge reseed error', { error: error.message });
      res.status(500).json({ error: 'Error al re-sembrar' });
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
