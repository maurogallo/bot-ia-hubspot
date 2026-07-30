const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

const processedIds = new Set();
setInterval(() => { if (processedIds.size > 1000) processedIds.clear(); }, 60000);

const META_API_BASE = `https://graph.facebook.com/${config.whatsapp.meta.apiVersion}`;

async function sendMessage(to, text) {
  const { phoneNumberId, accessToken } = config.whatsapp.meta;
  if (!phoneNumberId || !accessToken) {
    logger.warn('Meta WhatsApp not configured, cannot send message');
    return;
  }
  try {
    await axios.post(`${META_API_BASE}/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    logger.error('Meta send message error', { error: err.response?.data || err.message, to });
  }
}

function createAdapter(deps) {
  const { phoneNumberId, accessToken, verifyToken } = config.whatsapp.meta;

  logger.info('WhatsApp driver: Meta Business API', {
    configured: !!(phoneNumberId && accessToken),
    phoneNumberId: phoneNumberId ? `${phoneNumberId.substring(0, 4)}...` : undefined,
  });

  function getClient() { return null; }
  function getQrCode() { return null; }

  async function handleIncoming(payload) {
    try {
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];
      if (!message || message.type !== 'text') return;
      if (message.from === config.whatsapp.meta.phoneNumberId) return;

      const msgId = message.id;
      if (msgId && processedIds.has(msgId)) return;
      if (msgId) processedIds.add(msgId);

      const text = message.text?.body;
      if (!text) return;

      logger.info('Meta WhatsApp message', { phone: message.from, text: text.substring(0, 100) });

      const phoneNumberId = change?.value?.metadata?.phone_number_id;

      let tenant = null;
      if (deps.tenantResolver) {
        tenant = await deps.tenantResolver.resolveFromPhoneNumberId(phoneNumberId);
        if (!tenant.plan || tenant.slug === 'default') {
          tenant = await deps.tenantResolver.resolveFromWhatsApp(message.from);
        }
      }

      const result = await deps.handleMessage({
        message: text,
        from: message.from,
        channel: 'whatsapp',
        store: deps.store,
        ai: deps.ai,
        crm: deps.crm,
        calendar: deps.calendar,
        tenant,
      });

      if (result.response) {
        await sendMessage(message.from, result.response);
      }
    } catch (error) {
      logger.error('Meta WhatsApp incoming error', { error: error.message });
    }
  }

  return { getClient, getQrCode, handleIncoming, sendMessage };
}

module.exports = { createAdapter };
