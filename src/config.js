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
    model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE) || 0.7,
    maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS, 10) || 256,
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },

  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
    driver: process.env.WHATSAPP_DRIVER || 'meta',
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
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
  },

  dashboard: {
    username: process.env.DASHBOARD_USERNAME || '',
    password: process.env.DASHBOARD_PASSWORD || '',
  },

  calendar: {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL || '',
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    timezone: process.env.BUSINESS_TIMEZONE || 'America/Argentina/Buenos_Aires',
    meetingDuration: parseInt(process.env.MEETING_DURATION_MINUTES, 10) || 30,
  },

  webhookSecret: process.env.WEBHOOK_SECRET || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'bot@neowebstudio.com',
  },

  billing: {
    provider: process.env.BILLING_PROVIDER || 'wompi',
    currency: process.env.BILLING_CURRENCY || 'COP',
    webhookUrl: process.env.BILLING_WEBHOOK_URL || '/api/wompi-webhook',
    successUrl: process.env.BILLING_SUCCESS_URL || 'https://bot.synaptiqnova.online/dashboard',
    cancelUrl: process.env.BILLING_CANCEL_URL || 'https://bot.synaptiqnova.online/dashboard',
    graceDays: parseInt(process.env.BILLING_GRACE_DAYS, 10) || 3,
    planPrices: {
      starter: parseInt(process.env.BILLING_PRICE_STARTER, 10) || 99000,
      business: parseInt(process.env.BILLING_PRICE_BUSINESS, 10) || 249000,
      pro: parseInt(process.env.BILLING_PRICE_PRO, 10) || 499000,
      enterprise: parseInt(process.env.BILLING_PRICE_ENTERPRISE, 10) || 990000,
    },
  },

  wompi: {
    publicKey: process.env.WOMPI_PUBLIC_KEY || '',
    privateKey: process.env.WOMPI_PRIVATE_KEY || '',
    eventsSecret: process.env.WOMPI_EVENTS_SECRET || '',
    environment: process.env.WOMPI_ENVIRONMENT || 'sandbox',
  },
};

module.exports = config;
