const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

const TELEGRAM_API = 'https://api.telegram.org';

const processedIds = null;

function createAdapter(deps) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const baseUrl = `${TELEGRAM_API}/bot${token}`;

  if (!token) {
    logger.warn('Telegram bot token not configured');
  }

  async function sendMessage(chatId, text) {
    if (!token) return;
    try {
      await axios.post(`${baseUrl}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }, { timeout: 10000 });
    } catch (err) {
      logger.error('Telegram send error', { error: err.response?.data || err.message, chatId });
    }
  }

  async function handleMessage(message) {
    try {
      logger.info('Telegram handler entered', { text: message?.text, chatId: message?.chat?.id });
      const msgId = message.message_id;
      const text = message.text;
      const chatId = message.chat?.id;
      if (!text || !chatId) { logger.warn('Telegram missing text/chatId'); return; }

      logger.info('Telegram message', { chatId, text: text.substring(0, 100) });

      const tenant = deps.tenantResolver
        ? await deps.tenantResolver.resolveFromWhatsApp(String(chatId)) || await deps.store.getDefaultTenant()
        : null;

      const result = await deps.handleMessage({
        message: text,
        from: String(chatId),
        channel: 'telegram',
        store: deps.store,
        ai: deps.ai,
        crm: deps.crm,
        calendar: deps.calendar,
        tenant,
      });

      if (result.response) {
        await sendMessage(chatId, result.response);
      }
    } catch (error) {
      logger.error('Telegram handle error', { error: error.message });
    }
  }

  function getClient() { return null; }
  function getQrCode() { return null; }

  if (token) {
    logger.info('Telegram adapter configured', { tokenPrefix: token.substring(0, 8) + '...' });
  }

  return { getClient, getQrCode, handleMessage, sendMessage };
}

module.exports = { createAdapter };
