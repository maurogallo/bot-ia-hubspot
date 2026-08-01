const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

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
    ? `\nDATOS DEL CLIENTE (ya los tienes, NO los pidas de nuevo):\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
    : '\nDATOS DEL CLIENTE: no tienes ningun dato todavia.\n';

  const knowledgeBlock = knowledgeDocs.length > 0
    ? `\nINFO EMPRESA:\n${knowledgeDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
    : '';

  let schedulingRules = '';
  if (hasScheduling) {
    schedulingRules = `
AGENDAMIENTO:
- Si pide agendar cita/reunion, NO derives. Usa intent="schedule" con action="request_availability".
- Pide datos faltantes (nombre/email/telefono) primero.
- Si confirma horario: intent="schedule" con action="confirm_slot", preferred_date=YYYY-MM-DD, preferred_time=HH:MM.`;
  }

  return `Eres asesor comercial de ${businessName}.${knowledgeBlock}${memoryBlock}

SERVICIOS:
${servicesBlock}

INSTRUCCIONES:
- Responde en maximo 2 oraciones. Español neutro, trata de "tu".
- Si el cliente pregunta por servicios, menciona 1 o 2 con sus precios.
- NUNCA escribas "[Mensaje]" ni etiquetas en tu respuesta.
${hasScheduling ? '- Si el cliente pide agendar, usa intent="schedule" con action="request_availability".' : '- Si el cliente da todos sus datos, usa intent="lead" para registrarlo.'}

Responde con tu mensaje y luego el JSON:
[LEAD_DATA]{"intent":"greeting|inquiry|lead|proposal|handoff|schedule","detected_service":"${serviceKeys}|unknown","lead":{"name":"","email":"","phone":"","service_interest":""},"scheduling":{"action":"request_availability|confirm_slot|cancel","preferred_date":null,"preferred_time":null},"confidence":0.9}[/LEAD_DATA]`;
}

function createProvider(apiKey) {
  const key = apiKey || config.groq?.apiKey || '';

  async function generateResponse(sessionId, conversationHistory, memory = {}, knowledgeDocs = [], tenant = null, services = []) {
    const knowledgeContents = knowledgeDocs.map(d => d.content || d);

    const lastMsg = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].content : '';
    const cacheKey = getCacheKey(lastMsg, tenant?.slug);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL && conversationHistory.length <= 1 && !memory.contact_name && cached.leadData.intent !== 'error') {
      return { response: cached.response, leadData: { ...cached.leadData } };
    }

    const systemPrompt = buildSystemPrompt(memory, knowledgeContents, tenant, services);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    try {
      const response = await axios.post(GROQ_API, {
        model: 'llama-3.1-8b-instant',
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }, {
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });

      const content = response.data.choices?.[0]?.message?.content || '';

      let leadData = { intent: 'inquiry', detected_service: 'unknown',
        lead: { name: null, email: null, phone: null, service_interest: null },
        scheduling: { action: null, preferred_date: null, preferred_time: null },
        actions: [], confidence: 0.5 };

      const jsonMatch = content.match(/(?:\[LEAD_DATA\])\s*({[\s\S]*?})\s*(?:\[\/LEAD_DATA\])/) ||
                        content.match(/({[\s\S]*"intent"[\s\S]*})/);
      if (jsonMatch) {
        try { leadData = { ...leadData, ...JSON.parse(jsonMatch[1]) }; }
        catch (e) { logger.warn('Failed to parse lead data', { error: e.message, sessionId }); }
      }

      let cleanResponse = content.replace(/\s*\[LEAD_DATA\][\s\S]*?\[\/LEAD_DATA\]\s*/, '').trim();
      if (cleanResponse === content || !cleanResponse) {
        cleanResponse = content.replace(/\s*\{[\s\S]*"intent"[\s\S]*\}\s*$/, '').trim();
      }

      if (responseCache.size >= CACHE_MAX) {
        const firstKey = responseCache.keys().next().value;
        responseCache.delete(firstKey);
      }
      responseCache.set(cacheKey, { response: cleanResponse, leadData, ts: Date.now() });

      return { response: cleanResponse, leadData };
    } catch (error) {
      logger.error('Groq request failed', { error: error.message, sessionId });
      return {
        response: 'Lo siento, el servicio no esta disponible en este momento. Intenta mas tarde.',
        leadData: { intent: 'error', detected_service: 'unknown',
          lead: { name: null, email: null, phone: null, service_interest: null },
          scheduling: { action: null, preferred_date: null, preferred_time: null },
          actions: [], confidence: 0 },
      };
    }
  }

  return { generateResponse };
}

module.exports = { createProvider };
