const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
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
    redirectUri: process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    refreshToken: process.env.HUBSPOT_REFRESH_TOKEN,
  },

  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE) || 0.7,
    maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS, 10) || 1024,
  },

  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
  },

  business: {
    name: process.env.BUSINESS_NAME || 'NeoWeb Studio',
    services: process.env.BUSINESS_SERVICES || 'Desarrollo web, landing pages, automatización de procesos',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 30,
  },
};

module.exports = config;
