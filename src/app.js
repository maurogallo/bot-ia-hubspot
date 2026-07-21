require('express-async-errors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');
const config = require('./config');
const session = require('./session');
const aiAgent = require('./ai-agent');
const hubspot = require('./hubspot');
const whatsapp = require('./whatsapp');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
});

app.use('/api/', limiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now() - start,
    });
  });
  next();
});

app.get('/health', async (req, res) => {
  const ollamaHealth = await aiAgent.checkOllamaHealth();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ollama: ollamaHealth,
    whatsapp: whatsapp.getClient() ? 'connected' : 'disconnected',
    uptime: process.uptime(),
  });
});

app.post('/api/webhook', async (req, res) => {
  const { message, from, channel = 'web' } = req.body;

  if (!message || !from) {
    return res.status(400).json({ error: 'Los campos "message" y "from" son obligatorios' });
  }

  if (typeof message !== 'string' || message.length > 4000) {
    return res.status(400).json({ error: 'El mensaje es demasiado largo (máx 4000 caracteres)' });
  }

  const chatSession = await session.getOrCreateSession(channel, null, from);
  await session.addMessage(chatSession.id, 'user', message);

  const history = await session.getConversationHistory(chatSession.id);
  const { response: aiResponse, leadData } = await aiAgent.generateResponse(chatSession.id, history);

  await session.addMessage(chatSession.id, 'assistant', aiResponse, { leadData });

  if (leadData.intent === 'lead' && leadData.lead?.email) {
    try {
      const hubspotContact = await hubspot.getOrCreateContact(leadData.lead.email, {
        name: leadData.lead.name || undefined,
        phone: leadData.lead.phone || from,
      });
      await session.updateSessionContext(chatSession.id, { hubspotContactId: hubspotContact.id });
      logger.info('Lead saved from webhook', { contactId: hubspotContact.id, from });
    } catch (error) {
      logger.error('Failed to save lead to HubSpot from webhook', { error: error.message, from });
    }
  }

  res.json({ reply: aiResponse });
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    await hubspot.exchangeAuthorizationCode(code);
    res.send('Autenticación de HubSpot completada. Ya puedes cerrar esta ventana.');
  } catch (error) {
    logger.error('HubSpot OAuth callback error', { error: error.message });
    res.status(500).send('Error al autenticar con HubSpot');
  }
});

app.get('/auth/hubspot', async (req, res) => {
  try {
    const url = await hubspot.getAuthorizationUrl();
    res.redirect(url);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    service: config.business.name,
    version: require('../package.json').version,
    environment: config.nodeEnv,
    uptime: process.uptime(),
    whatsapp: whatsapp.getClient() ? 'connected' : 'disconnected',
  });
});

app.get('/whatsapp/qr', (req, res) => {
  const qr = whatsapp.getQrCode();
  if (!qr) {
    return res.status(404).json({ error: 'QR no disponible. Espera a que el cliente se inicialice.' });
  }
  res.json({ qr });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
