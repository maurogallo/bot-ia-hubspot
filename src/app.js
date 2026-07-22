require('express-async-errors');
const { createStore } = require('./adapters/outbound/postgres-store');
const { createProvider: createAI } = require('./adapters/outbound/ollama-provider');
const { createProvider: createCRM } = require('./adapters/outbound/hubspot-provider');
const { createApp } = require('./adapters/inbound/express-adapter');
const { createAdapter: createWhatsApp } = require('./adapters/inbound/whatsapp-adapter');
const { handleMessage } = require('./domain/use-cases');

const store = createStore();
const ai = createAI();
const crm = createCRM();

const deps = { store, ai, crm, handleMessage };

const whatsapp = createWhatsApp(deps);
deps.getQrCode = whatsapp.getQrCode;

const app = createApp(deps);

module.exports = { app, store, whatsapp };
