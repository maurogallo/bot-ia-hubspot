const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const logger = require('./logger');
const config = require('./config');
const session = require('./session');
const aiAgent = require('./ai-agent');
const hubspot = require('./hubspot');
const { query } = require('./database');

let client = null;

function initialize() {
  const puppeteerConfig = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  };

  const chromiumPath = process.env.CHROMIUM_PATH;
  if (chromiumPath) {
    puppeteerConfig.executablePath = chromiumPath;
  }

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsapp.sessionPath }),
    puppeteer: puppeteerConfig,
  });

  client.on('qr', (qr) => {
    logger.info('WhatsApp QR received. Scan with phone.');
    try {
      fs.writeFileSync('./whatsapp-qr.txt', qr);
    } catch { /* ignore */ }
  });

  client.on('ready', () => {
    logger.info('WhatsApp client is ready');
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp client authenticated');
  });

  client.on('auth_failure', (msg) => {
    logger.error('WhatsApp authentication failed', { message: msg });
  });

  client.on('disconnected', (reason) => {
    logger.warn('WhatsApp client disconnected', { reason });
  });

  client.on('message', handleIncomingMessage);

  client.initialize();
  return client;
}

async function handleIncomingMessage(message) {
  try {
    if (message.isGroup) return;

    const phone = message.from;
    const text = message.body;

    logger.info('WhatsApp message received', { phone, text: text.substring(0, 100) });

    const chatSession = await session.getOrCreateSession('whatsapp', null, phone);
    await session.addMessage(chatSession.id, 'user', text);

    const history = await session.getConversationHistory(chatSession.id);
    const { response: aiResponse, leadData } = await aiAgent.generateResponse(chatSession.id, history);

    await session.addMessage(chatSession.id, 'assistant', aiResponse, { leadData });

    if (leadData.intent === 'lead' && leadData.lead?.email) {
      try {
        const hubspotContact = await hubspot.getOrCreateContact(leadData.lead.email, {
          name: leadData.lead.name || undefined,
          phone: leadData.lead.phone || phone,
        });

        await query(
          `INSERT INTO contacts (hubspot_id, name, email, phone, last_interaction)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (hubspot_id) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             last_interaction = NOW()`,
          [hubspotContact.id, leadData.lead.name, leadData.lead.email, leadData.lead.phone || phone]
        );

        await session.updateSessionContext(chatSession.id, { hubspotContactId: hubspotContact.id });
        logger.info('Lead saved from WhatsApp', { contactId: hubspotContact.id, phone });
      } catch (error) {
        logger.error('Failed to save lead to HubSpot', { error: error.message, phone });
      }
    }

    await client.sendMessage(phone, aiResponse);
  } catch (error) {
    logger.error('Error processing WhatsApp message', {
      error: error.message,
      phone: message?.from,
    });
  }
}

async function sendMessage(to, text) {
  if (!client) throw new Error('WhatsApp client not initialized');
  return client.sendMessage(to, text);
}

function getClient() {
  return client;
}

function getQrCode() {
  try {
    return fs.readFileSync('./whatsapp-qr.txt', 'utf-8');
  } catch {
    return null;
  }
}

module.exports = { initialize, sendMessage, getClient, getQrCode };
