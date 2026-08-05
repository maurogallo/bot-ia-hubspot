const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const logger = require('../../logger');
const config = require('../../config');

function createAdapter(deps) {
  let client = null;
  const processedIds = new Set();
  const processedCleanup = setInterval(() => {
    if (processedIds.size > 1000) processedIds.clear();
  }, 60000);

  const puppeteerConfig = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'],
  };
  if (process.env.CHROMIUM_PATH) puppeteerConfig.executablePath = process.env.CHROMIUM_PATH;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsapp.sessionPath }),
    puppeteer: puppeteerConfig,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  client.on('qr', (qr) => {
    logger.info('WhatsApp QR received');
    try { fs.writeFileSync('./whatsapp-qr.txt', qr); } catch { /* ignore */ }
  });

  client.on('ready', () => logger.info('WhatsApp client ready'));
  client.on('authenticated', () => logger.info('WhatsApp client authenticated'));
  client.on('auth_failure', (msg) => logger.error('WhatsApp auth failure', { message: msg }));
  client.on('disconnected', (reason) => logger.warn('WhatsApp disconnected', { reason }));

  client.on('message_create', async (message) => {
    try {
      if (message.isGroup) return;
      if (!message.body || !message.body.trim()) return;
      if (message.fromMe) return;
      if (message.from && !message.from.endsWith('@c.us') && !message.from.match(/^\d+@/)) return;
      const msgId = message.id ? message.id.id || message.id._serialized : null;
      if (msgId && processedIds.has(msgId)) return;
      if (msgId) processedIds.add(msgId);

      logger.info('WhatsApp message', { phone: message.from, text: message.body.substring(0, 100) });

      const tenant = deps.tenantResolver
        ? await deps.tenantResolver.resolveFromWhatsApp(message.from)
        : null;

      const result = await deps.handleMessage({
        message: message.body,
        from: message.from,
        channel: 'whatsapp',
        store: deps.store,
        ai: deps.ai,
        crm: deps.crm,
        calendar: deps.calendar,
        tenant,
      });

      if (result.response) {
        await client.sendMessage(message.from, result.response);
      }
      if (result.handoffNeeded) {
        logger.info('Handoff needed for WhatsApp session', { phone: message.from });
      }
    } catch (error) {
      logger.error('WhatsApp message error', { error: error.message, phone: message?.from });
    }
  });

  client.initialize();

  function getClient() { return client; }
  function getQrCode() { try { return fs.readFileSync('./whatsapp-qr.txt', 'utf-8'); } catch { return null; } }

  return { getClient, getQrCode };
}

module.exports = { createAdapter };
