const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

const responseCache = new Map();
const CACHE_MAX = 100;
const CACHE_TTL = 60 * 60 * 1000;
function getCacheKey(msg) { return msg.toLowerCase().replace(/[^a-záéíóúñü0-9\s]/g, '').trim(); }

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
    ? `\n## CLIENTE\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
    : '';
  const knowledgeBlock = knowledgeDocs.length > 0
    ? `\n## EMPRESA\n${knowledgeDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n`
    : '';

  const schedulingBlock = hasScheduling ? `
## AGENDAMIENTO
Si el cliente ya dio su nombre, email y telefono, OFRECE agendar una reunion. Si acepta:
- Pregunta que dia y horario prefiere
- Si menciona fecha/hora, usa intent="schedule" con scheduling.action="request_availability"
- Si confirma un horario especifico, usa scheduling.action="confirm_slot"
- Si quiere cancelar, usa scheduling.action="cancel"
- En scheduling.preferred_date escribe la fecha en formato YYYY-MM-DD
- En scheduling.preferred_time escribe la hora en formato HH:MM (24h)
` : '';

  return `Eres asesor comercial de ${businessName} (${businessServices}).${memoryBlock}${knowledgeBlock}${schedulingBlock}

Debes seguir este guion paso a paso:
1. Saluda y PREGUNTA SU NOMBRE
2. Pregunta que necesita
3. Propon el servicio adecuado de la lista de SERVICIOS
4. Pide su EMAIL y TELEFONO${hasScheduling ? '\n5. Si ya tienes nombre, email y telefono, ofrece agendar una reunion' : ''}

REGLAS:
- Siempre pide el nombre en tu primer mensaje
- No des largos discursos, se directo
- No termines sin nombre, email y telefono
- Si ya tienes datos, pide solo lo que falta
- Usa espanol neutro, trata de "tu"

## SERVICIOS
${servicesBlock}

## DERIVACION
Usa intent="handoff" si pide humano.

## FORMATO
Responde natural. Termina con:
[LEAD_DATA] { "intent": "greeting|inquiry|lead|proposal|handoff|schedule", "detected_service": "${serviceKeys}|unknown", "lead": { "name": null, "email": null, "phone": null, "service_interest": null }, "scheduling": { "action": "request_availability|confirm_slot|cancel", "preferred_date": null, "preferred_time": null }, "confidence": 0.0 } [/LEAD_DATA]`;
}

function createProvider() {
  async function generateResponse(sessionId, conversationHistory, memory = {}, knowledgeDocs = [], tenant = null, services = []) {
    const knowledgeContents = knowledgeDocs.map(d => d.content || d);

    const lastMsg = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].content : '';
    const cacheKey = getCacheKey(lastMsg);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL && conversationHistory.length <= 2 && !memory.contact_name && cached.leadData.intent !== 'error') {
      logger.info('Response cache hit', { sessionId, cacheKey });
      return { response: cached.response, leadData: { ...cached.leadData } };
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt(memory, knowledgeContents, tenant, services) },
      ...conversationHistory.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    try {
      logger.info('Calling Ollama', { model: config.ollama.model, sessionId });
      const response = await axios.post(`${config.ollama.baseUrl}/api/chat`, {
        model: config.ollama.model, messages, stream: false,
        options: { temperature: config.ollama.temperature, num_predict: config.ollama.maxTokens },
      }, { timeout: 120000 });

      const content = response.data.message.content;
      let leadData = { intent: 'inquiry', detected_service: 'unknown',
        lead: { name: null, email: null, phone: null, service_interest: null },
        scheduling: { action: null, preferred_date: null, preferred_time: null },
        actions: [], confidence: 0.5 };

      const jsonMatch = content.match(/(?:\[LEAD_DATA\]|\*\*LEAD_DATA\*\*)\s*({[\s\S]*?})\s*(?:\[\/LEAD_DATA\]|\*\*\/LEAD_DATA\*\*)/);
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
      logger.error('Ollama request failed', { error: error.message, sessionId });
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        return {
          response: 'Lo siento, el servicio de IA no está disponible. Intenta más tarde.',
          leadData: { intent: 'error', detected_service: 'unknown',
            lead: { name: null, email: null, phone: null, service_interest: null },
            scheduling: { action: null, preferred_date: null, preferred_time: null },
            actions: [], confidence: 0 },
        };
      }
      throw error;
    }
  }

  async function generateEmbedding(text) {
    const response = await axios.post(`${config.ollama.baseUrl}/api/embeddings`, {
      model: config.ollama.embeddingModel,
      prompt: text,
    }, { timeout: 15000 });
    return response.data.embedding;
  }

  async function checkHealth() {
    try {
      const response = await axios.get(`${config.ollama.baseUrl}/api/tags`, { timeout: 5000 });
      const models = response.data.models || [];
      const modelAvailable = models.some(m => m.name.startsWith(config.ollama.model));
      const embModelAvailable = models.some(m => m.name.startsWith(config.ollama.embeddingModel));
      return { available: true, modelAvailable, embeddingModelAvailable: embModelAvailable, models: models.map(m => m.name) };
    } catch {
      return { available: false, modelAvailable: false, embeddingModelAvailable: false, models: [] };
    }
  }

  return { generateResponse, generateEmbedding, checkHealth };
}

module.exports = { createProvider };
