const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const responseCache = new Map();
const CACHE_MAX = 100;
const CACHE_TTL = 60 * 60 * 1000;
function getCacheKey(msg, tenantSlug) { return (tenantSlug || 'default') + ':' + msg.toLowerCase().replace(/[^a-záéíóúñü0-9\s]/g, '').trim(); }

function buildSystemPrompt(memory = {}, knowledgeDocs = [], tenant = null, services = []) {
  const businessName = tenant?.business_name || config.business.name;
  const businessServices = tenant?.business_services || config.business.services;
  const hasScheduling = tenant?.features?.scheduling !== false;

  const servicesList = services.length > 0 ? services : [
    { name: 'Landing Pages', description: 'desde 299 USD' },
    { name: 'Desarrollo Web', description: 'desde 799 USD' },
    { name: 'Automatizacion', description: 'desde 499 USD' },
  ];

  const servicesBlock = servicesList.map((s, i) =>
    `${i + 1}. ${s.name}${s.description ? ': ' + s.description : ''}${s.price ? ' - $' + s.price + ' ' + (s.price_label || 'USD') : ''}`
  ).join('\n');

  const serviceKeys = servicesList.map(s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '_')).join('|');

  const memoryBlock = Object.keys(memory).length > 0
    ? `\nDATOS DEL CLIENTE YA OBTENIDOS:\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  const knowledgeBlock = knowledgeDocs.length > 0
    ? `\nINFORMACION DE LA EMPRESA:\n${knowledgeDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
    : '';

  let schedulingRules = '';
  if (hasScheduling) {
    schedulingRules = `
INSTRUCCIONES DE AGENDAMIENTO:
- Si el cliente pide agendar una cita o reunion, NO derives a humano.
- Si ya tienes nombre, email y telefono del cliente, preguntale que dia y horario prefiere y usa intent="schedule" con action="request_availability".
- Si te faltan datos, pideles lo que falta (nombre, email, telefono) primero.
- Si el cliente confirma un horario, usa intent="schedule" con action="confirm_slot", preferred_date en formato YYYY-MM-DD y preferred_time en formato HH:MM.
- NO digas "un asesor te contactara" cuando pidan agendar. Agendalo vos.`;
  }

  return `Eres un asesor comercial de ${businessName} (${businessServices}).${knowledgeBlock}${memoryBlock}

SERVICIOS QUE OFRECES:
${servicesBlock}

COMPORTAMIENTO:
- Si el cliente pregunta sobre servicios, RESPONDE listando los servicios con sus precios. No pidas el nombre primero.
- Luego de responder, pregunta su nombre para seguir la conversacion.
- Pide datos en este orden: 1)nombre 2)necesidad 3)email 4)telefono. Pero si te saltas pasos para responder una pregunta, esta bien.
- Se breve, maximo 3 oraciones. Trata de "tu". Español neutro.${schedulingRules}

FORMATO DE RESPUESTA:
Responde SOLO con el mensaje al cliente. Al final, incluye SIEMPRE este JSON:
[LEAD_DATA]{"intent":"greeting|inquiry|lead|proposal|handoff|schedule","detected_service":"${serviceKeys}|unknown","lead":{"name":null,"email":null,"phone":null,"service_interest":null},"scheduling":{"action":"request_availability|confirm_slot|cancel","preferred_date":null,"preferred_time":null},"confidence":0.0}[/LEAD_DATA]

EJEMPLOS:
Cliente: hola
Tú: ¡Hola! Soy asesor de ${businessName}. ¿Cuál es tu nombre?
[LEAD_DATA]{"intent":"greeting","detected_service":"unknown","lead":{"name":null,"email":null,"phone":null,"service_interest":null},"scheduling":{"action":null,"preferred_date":null,"preferred_time":null},"confidence":0.5}[/LEAD_DATA]

Cliente: que servicios ofrecen
Tú: Ofrecemos: ${servicesList[0]?.name || 'Servicios'}. ¿Cuál te interesa? Por cierto, ¿cuál es tu nombre?
[LEAD_DATA]{"intent":"inquiry","detected_service":"unknown","lead":{"name":null,"email":null,"phone":null,"service_interest":null},"scheduling":{"action":null,"preferred_date":null,"preferred_time":null},"confidence":0.5}[/LEAD_DATA]`;
}

function createProvider(apiKey) {
  const key = apiKey || config.gemini?.apiKey || '';

  async function generateResponse(sessionId, conversationHistory, memory = {}, knowledgeDocs = [], tenant = null, services = []) {
    const knowledgeContents = knowledgeDocs.map(d => d.content || d);

    const lastMsg = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].content : '';
    const cacheKey = getCacheKey(lastMsg, tenant?.slug);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL && conversationHistory.length <= 2 && !memory.contact_name && cached.leadData.intent !== 'error') {
      return { response: cached.response, leadData: { ...cached.leadData } };
    }

    const systemPrompt = buildSystemPrompt(memory, knowledgeContents, tenant, services);

    const messages = conversationHistory.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    try {
      const response = await axios.post(`${GEMINI_API}?key=${key}`, {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: messages,
        generationConfig: { temperature: 0.7, maxOutputTokens: 256, topP: 0.9 },
      }, { timeout: 15000 });

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let leadData = { intent: 'inquiry', detected_service: 'unknown',
        lead: { name: null, email: null, phone: null, service_interest: null },
        scheduling: { action: null, preferred_date: null, preferred_time: null },
        actions: [], confidence: 0.5 };

      const jsonMatch = content.match(/(?:\[LEAD_DATA\])\s*({[\s\S]*?})\s*(?:\[\/LEAD_DATA\])/);
      if (jsonMatch) {
        try { leadData = { ...leadData, ...JSON.parse(jsonMatch[1]) }; }
        catch (e) { logger.warn('Failed to parse lead data', { error: e.message, sessionId }); }
      }

      const cleanResponse = content.replace(/\s*\[LEAD_DATA\][\s\S]*?\[\/LEAD_DATA\]\s*/, '').trim();

      if (responseCache.size >= CACHE_MAX) {
        const firstKey = responseCache.keys().next().value;
        responseCache.delete(firstKey);
      }
      responseCache.set(cacheKey, { response: cleanResponse, leadData, ts: Date.now() });

      return { response: cleanResponse, leadData };
    } catch (error) {
      logger.error('Gemini request failed', { error: error.message, sessionId });
      return {
        response: 'Lo siento, el servicio no esta disponible en este momento. Intenta mas tarde.',
        leadData: { intent: 'error', detected_service: 'unknown',
          lead: { name: null, email: null, phone: null, service_interest: null },
          scheduling: { action: null, preferred_date: null, preferred_time: null },
          actions: [], confidence: 0 },
      };
    }
  }

  async function checkHealth() {
    if (!key) return { available: false, reason: 'no api key' };
    try {
      await axios.get(`${GEMINI_API}?key=${key}`, { timeout: 5000, validateStatus: s => s < 500 });
      return { available: true, model: 'gemini-2.0-flash' };
    } catch (err) {
      return { available: false, reason: err.message };
    }
  }

  return { generateResponse, checkHealth };
}

module.exports = { createProvider };
