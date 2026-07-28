const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 3090,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'hubspot_bot',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
  },

  hubspot: {
    clientId: process.env.HUBSPOT_CLIENT_ID,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
    redirectUri: process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3090/oauth/callback',
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    refreshToken: process.env.HUBSPOT_REFRESH_TOKEN,
  },

  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'qwen2:1.5b',
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE) || 0.7,
    maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS, 10) || 512,
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
  },

  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
    driver: process.env.WHATSAPP_DRIVER || 'webjs',
    meta: {
      phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
      accessToken: process.env.META_ACCESS_TOKEN || '',
      verifyToken: process.env.META_VERIFY_TOKEN || 'bot-verify-token',
      apiVersion: process.env.META_API_VERSION || 'v21.0',
    },
  },

  business: {
    name: process.env.BUSINESS_NAME || 'NeoWeb Studio',
    services: process.env.BUSINESS_SERVICES || 'Desarrollo web, landing pages, automatización de procesos',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 30,
  },

  dashboard: {
    username: process.env.DASHBOARD_USERNAME || '',
    password: process.env.DASHBOARD_PASSWORD || '',
  },

  webhookSecret: process.env.WEBHOOK_SECRET || '',
};

module.exports = config;
