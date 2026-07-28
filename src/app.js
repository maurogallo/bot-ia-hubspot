require('express-async-errors');
const logger = require('./logger');
const config = require('./config');
const { createStore } = require('./adapters/outbound/postgres-store');
const { createProvider: createAI } = require('./adapters/outbound/ollama-provider');
const { createProvider: createCRM } = require('./adapters/outbound/hubspot-provider');
const { createApp } = require('./adapters/inbound/express-adapter');
const { createAdapter: createWebJSWA } = require('./adapters/inbound/whatsapp-adapter');
const { createAdapter: createMetaWA } = require('./adapters/inbound/meta-whatsapp-adapter');
const { handleMessage } = require('./domain/use-cases');

const store = createStore();
const ai = createAI();
const crm = createCRM();

const KNOWLEDGE_SEED = [
  { content: 'NeoWeb Studio es una agencia especializada en desarrollo web, landing pages y automatización de procesos. Fundada para ayudar a pymes y emprendedores a tener presencia digital profesional sin pagar costos excesivos.', metadata: { type: 'company_info' } },
  { content: 'Servicio: Landing Pages. Desde $299 USD. Incluye diseño optimizado para conversión, formulario de captura, integración con redes sociales, versión mobile, hosting 1 año gratis. Tiempo de entrega: 5-7 días hábiles.', metadata: { type: 'service', service: 'landing_page' } },
  { content: 'Servicio: Desarrollo Web. Desde $799 USD. Incluye sitio corporativo o tienda online, panel administrador, SEO básico, certificado SSL, integración de pagos, hosting 1 año gratis. Tiempo de entrega: 2-4 semanas.', metadata: { type: 'service', service: 'web_development' } },
  { content: 'Servicio: Automatización. Desde $499 USD. Incluye integración de CRM, chatbots con IA, email marketing automatizado, embudos de ventas, reportes y analytics. Tiempo de entrega: 1-3 semanas.', metadata: { type: 'service', service: 'automation' } },
  { content: 'Pregunta frecuente: ¿Necesito tener mi dominio y hosting? No, nosotros incluimos hosting gratis el primer año y te ayudamos con la compra del dominio si no tenés uno.', metadata: { type: 'faq' } },
  { content: 'Pregunta frecuente: ¿Ofrecen mantenimiento después de entregar el sitio? Sí, ofrecemos planes de mantenimiento desde $49 USD/mes que incluyen actualizaciones, backups y soporte técnico.', metadata: { type: 'faq' } },
  { content: 'Pregunta frecuente: ¿Cómo es el proceso de trabajo? 1) Reunión inicial para entender tu negocio. 2) Propuesta y cotización. 3) Diseño y maquetación. 4) Desarrollo. 5) Revisiones y ajustes. 6) Publicación y capacitación.', metadata: { type: 'process' } },
  { content: 'Casos de éxito: Clientes han aumentado sus ventas hasta un 40% después de tener una landing page profesional con captura de leads automatizada.', metadata: { type: 'social_proof' } },
  { content: 'Diferenciador: Usamos inteligencia artificial local (Ollama) para nuestros chatbots, lo que significa que tus datos nunca salen de tu infraestructura. Privacidad y seguridad total.', metadata: { type: 'differentiator' } },
  { content: 'Garantía: Todos nuestros trabajos incluyen revisiones ilimitadas durante el desarrollo y 30 días de soporte post-entrega sin costo adicional.', metadata: { type: 'guarantee' } },
];

async function seedKnowledge() {
  try {
    const count = await store.getKnowledgeCount();
    if (count > 0) {
      logger.info('Knowledge base already seeded', { count });
      return;
    }
    logger.info('Seeding knowledge base...');
    for (const doc of KNOWLEDGE_SEED) {
      const embedding = await ai.generateEmbedding(doc.content);
      await store.addKnowledge(doc.content, doc.metadata, embedding);
    }
    logger.info('Knowledge base seeded successfully', { docs: KNOWLEDGE_SEED.length });
  } catch (err) {
    logger.warn('Knowledge seeding skipped', { error: err.message });
  }
}

const deps = { store, ai, crm, handleMessage };

const createWhatsApp = config.whatsapp.driver === 'meta' ? createMetaWA : createWebJSWA;
const whatsapp = createWhatsApp(deps);
deps.getQrCode = whatsapp.getQrCode;
deps.metaHandleIncoming = whatsapp.handleIncoming;

const app = createApp(deps);

module.exports = { app, store, whatsapp, seedKnowledge };
