require('express-async-errors');
const logger = require('./logger');
const config = require('./config');
const { createStore } = require('./adapters/outbound/postgres-store');
const { createProvider: createOllama } = require('./adapters/outbound/ollama-provider');
const { createProvider: createGroq } = require('./adapters/outbound/groq-provider');
const { createProvider: createCRM } = require('./adapters/outbound/hubspot-provider');
const { createProvider: createCalendar } = require('./adapters/outbound/google-calendar-provider');
const { createApp } = require('./adapters/inbound/express-adapter');
const { createAdapter: createWebJSWA } = require('./adapters/inbound/whatsapp-adapter');
const { createAdapter: createMetaWA } = require('./adapters/inbound/meta-whatsapp-adapter');
const { createAdapter: createTelegram } = require('./adapters/inbound/telegram-adapter');
const { handleMessage } = require('./domain/use-cases');
const { createResolver } = require('./middleware/tenant-resolver');

const store = createStore();
const ollama = createOllama();
const groq = createGroq();
const ai = {
  generateResponse: async (...args) => {
    const result = await groq.generateResponse(...args);
    if (result.leadData?.intent === 'error') {
      logger.info('Groq failed, falling back to Ollama');
      return await ollama.generateResponse(...args);
    }
    return result;
  },
  generateEmbedding: ollama.generateEmbedding,
  checkHealth: () => ollama.checkHealth(),
};
const crm = createCRM();
const calendar = createCalendar(config.calendar);
const tenantResolver = createResolver(store);

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
  { content: 'Agendamiento: Ofrecemos reuniones de 30 minutos de lunes a viernes de 9:00 a 18:00 hora Argentina. Si necesitas otro horario, consultanos.', metadata: { type: 'scheduling' } },
  { content: 'Para agendar una reunion necesitamos tu nombre, email y el servicio que te interesa. La reunion es por Google Meet y recibis la invitacion automatica en tu calendario.', metadata: { type: 'scheduling_process' } },
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

const INDUSTRY_TEMPLATES = [
  { name: 'Salud', icon: '🏥', description: 'Clinicas, consultorios, centros medicos',
    services: [{ name: 'Consulta General', price: 50, price_label: 'USD' }, { name: 'Especialidad', price: 80, price_label: 'USD' }, { name: 'Urgencia', price: 120, price_label: 'USD' }, { name: 'Chequeo Preventivo', price: 100, price_label: 'USD' }],
    knowledge: ['Somos un centro de salud comprometido con el bienestar de nuestros pacientes.', 'Ofrecemos consultas presenciales y telemedicina.', 'Aceptamos la mayoria de obras sociales y prepagas.'],
    questions: ['¿Que sintomas presenta?', '¿Hace cuanto tiene estos sintomas?', '¿Tiene obra social o prepaga?', '¿Prefiere consulta presencial o virtual?'] },
  { name: 'Legal', icon: '⚖️', description: 'Abogados, estudios juridicos, mediacion',
    services: [{ name: 'Consulta Juridica', price: 100, price_label: 'USD' }, { name: 'Juicio Civil', price: 2500, price_label: 'USD' }, { name: 'Mediacion', price: 500, price_label: 'USD' }, { name: 'Asesoria Corporativa', price: 1500, price_label: 'USD' }],
    knowledge: ['Somos un estudio juridico con 15 años de experiencia.', 'Ofrecemos primera consulta sin cargo.', 'Nos especializamos en derecho civil, comercial y laboral.'],
    questions: ['¿Que tipo de caso tiene?', '¿Hay documentacion disponible?', '¿Cual es la urgencia del caso?', '¿Ya tiene representacion legal?'] },
  { name: 'Inmobiliaria', icon: '🏠', description: 'Agencias inmobiliarias, corredores, property management',
    services: [{ name: 'Compra de Propiedad', price: null, price_label: 'Comision' }, { name: 'Alquiler', price: null, price_label: 'Comision' }, { name: 'Tasacion', price: 150, price_label: 'USD' }, { name: 'Property Management', price: 200, price_label: 'USD/mes' }],
    knowledge: ['Somos una agencia inmobiliaria lider en la region.', 'Ofrecemos propiedades residenciales y comerciales.', 'Contamos con financiamiento propio para compradores.'],
    questions: ['¿Busca comprar o alquilar?', '¿En que zona?', '¿Cual es su presupuesto?', '¿Cuantas habitaciones necesita?'] },
  { name: 'Educacion', icon: '📚', description: 'Cursos, academias, capacitacion corporativa',
    services: [{ name: 'Curso Online', price: 199, price_label: 'USD' }, { name: 'Curso Presencial', price: 299, price_label: 'USD' }, { name: 'Capacitacion Corporativa', price: 999, price_label: 'USD' }, { name: 'Diplomatura', price: 1499, price_label: 'USD' }],
    knowledge: ['Somos una institucion educativa reconocida.', 'Ofrecemos certificacion oficial al completar los cursos.', 'Tenemos modalidad 100% online y presencial.'],
    questions: ['¿Que area le interesa?', '¿Cual es su nivel actual?', '¿Prefiere modalidad online o presencial?', '¿Que disponibilidad horaria tiene?'] },
  { name: 'Estetica', icon: '💇', description: 'Salones de belleza, barberias, spas, centros de estetica',
    services: [{ name: 'Corte de Cabello', price: 30, price_label: 'USD' }, { name: 'Coloracion', price: 80, price_label: 'USD' }, { name: 'Tratamiento Facial', price: 120, price_label: 'USD' }, { name: 'Masaje', price: 60, price_label: 'USD' }],
    knowledge: ['Somos un salon de belleza con productos premium.', 'Todos nuestros profesionales estan certificados.', 'Ofrecemos garantia de satisfaccion en todos los servicios.'],
    questions: ['¿Que servicio le interesa?', '¿Prefiere algun profesional en particular?', '¿Tiene preferencia de horario?', '¿Es la primera vez que nos visita?'] },
  { name: 'Restaurantes', icon: '🍽️', description: 'Restaurantes, bares, delivery, catering',
    services: [{ name: 'Reserva de Mesa', price: null, price_label: '' }, { name: 'Delivery', price: null, price_label: 'Segun pedido' }, { name: 'Evento Privado', price: 500, price_label: 'USD' }, { name: 'Catering Corporativo', price: 1500, price_label: 'USD' }],
    knowledge: ['Somos un restaurante de cocina de autor.', 'Trabajamos con ingredientes frescos de proveedores locales.', 'Ofrecemos menu ejecutivo de lunes a viernes.'],
    questions: ['¿Para cuantas personas?', '¿Para que fecha?', '¿Alguna ocasion especial?', '¿Tiene restricciones alimentarias?'] },
  { name: 'Tecnologia', icon: '💻', description: 'Desarrollo de software, consultoria IT, soporte tecnico',
    services: [{ name: 'Desarrollo Web', price: 1500, price_label: 'USD' }, { name: 'App Mobile', price: 3000, price_label: 'USD' }, { name: 'Consultoria IT', price: 150, price_label: 'USD/hora' }, { name: 'Soporte Tecnico', price: 99, price_label: 'USD/mes' }],
    knowledge: ['Somos una empresa de tecnologia especializada en desarrollo a medida.', 'Trabajamos con las ultimas tecnologias del mercado.', 'Ofrecemos soporte 24/7 para todos nuestros clientes.'],
    questions: ['¿Que tecnologia necesita?', '¿Cual es el alcance del proyecto?', '¿Tiene un deadline?', '¿Cual es su presupuesto estimado?'] },
  { name: 'Finanzas', icon: '📊', description: 'Contadores, asesores financieros, seguros, inversiones',
    services: [{ name: 'Asesoria Contable', price: 200, price_label: 'USD/mes' }, { name: 'Declaracion de Impuestos', price: 150, price_label: 'USD' }, { name: 'Plan de Inversion', price: 500, price_label: 'USD' }, { name: 'Seguros', price: null, price_label: 'Cotizar' }],
    knowledge: ['Somos un estudio contable con 20 años de trayectoria.', 'Ofrecemos asesoria personalizada para empresas y particulares.', 'Trabajamos con los principales bancos y aseguradoras del pais.'],
    questions: ['¿Es persona fisica o empresa?', '¿Que servicios necesita?', '¿Cual es su volumen de facturacion?', '¿Tiene contador actualmente?'] },
];

async function seedTemplates() {
  try {
    await store.seedIndustryTemplates(INDUSTRY_TEMPLATES);
    logger.info('Industry templates seeded');
  } catch (err) {
    logger.warn('Template seeding skipped', { error: err.message });
  }
}

const deps = { store, ai, crm, calendar, handleMessage, tenantResolver };

const createWhatsApp = config.whatsapp.driver === 'meta' ? createMetaWA : createWebJSWA;
const whatsapp = createWhatsApp(deps);
const telegram = createTelegram(deps);
deps.getQrCode = whatsapp.getQrCode;
deps.metaHandleIncoming = whatsapp.handleIncoming;
deps.telegramHandleIncoming = telegram.handleMessage;

const app = createApp(deps);

module.exports = { app, store, whatsapp, seedKnowledge, seedTemplates };
