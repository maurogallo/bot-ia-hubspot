const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const logger = require('../../logger');
const config = require('../../config');

function createAdapter(deps) {
  let client = null;

  const puppeteerConfig = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'],
  };
  if (process.env.CHROMIUM_PATH) puppeteerConfig.executablePath = process.env.CHROMIUM_PATH;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsapp.sessionPath }),
    puppeteer: puppeteerConfig,
  });

  client.on('qr', (qr) => {
    logger.info('WhatsApp QR received');
    try { fs.writeFileSync('./whatsapp-qr.txt', qr); } catch { /* ignore */ }
  });

  client.on('ready', () => logger.info('WhatsApp client ready'));
  client.on('authenticated', () => logger.info('WhatsApp client authenticated'));
  client.on('auth_failure', (msg) => logger.error('WhatsApp auth failure', { message: msg }));
  client.on('disconnected', (reason) => logger.warn('WhatsApp disconnected', { reason }));

  client.on('message', async (message) => {
    try {
      if (message.isGroup) return;
      logger.info('WhatsApp message', { phone: message.from, text: message.body.substring(0, 100) });

      const reply = await deps.handleMessage({
        message: message.body,
        from: message.from,
        channel: 'whatsapp',
        store: deps.store,
        ai: deps.ai,
        crm: deps.crm,
      });

      await client.sendMessage(message.from, reply);
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
