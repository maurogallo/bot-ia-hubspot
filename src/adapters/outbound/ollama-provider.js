const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

const responseCache = new Map();
const CACHE_MAX = 100;
const CACHE_TTL = 60 * 60 * 1000;
function getCacheKey(msg) { return msg.toLowerCase().replace(/[^a-záéíóúñü0-9\s]/g, '').trim(); }

function buildSystemPrompt(memory = {}, knowledgeDocs = []) {
  const memoryBlock = Object.keys(memory).length > 0
    ? `\n## CLIENTE\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
    : '';
  const knowledgeBlock = knowledgeDocs.length > 0
    ? `\n## EMPRESA\n${knowledgeDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n`
    : '';
  return `Eres asesor comercial de ${config.business.name} (${config.business.services}).${memoryBlock}${knowledgeBlock}

## PERSONALIDAD
Profesional, amable, español neutro. No inventes información.

## SERVICIOS
1. Landing Pages: desde $299 USD
2. Desarrollo Web: desde $799 USD
3. Automatización: desde $499 USD

## CAPTURA DE DATOS DEL LEAD (OBLIGATORIO)
Debes obtener estos datos del cliente durante la conversación:
1. PRIMERO: Pregunta su nombre
2. LUEGO: Pregunta sobre su negocio y qué necesita
3. DESPUÉS: Propón el servicio adecuado
4. FINALMENTE: Pide su EMAIL y TELÉFONO para enviarle la propuesta

NO termines la conversación sin haber obtenido nombre, email y teléfono.
Si ya tienes algunos datos (memory), no preguntes de nuevo, pide solo los que faltan.

## DERIVACIÓN
Usa intent="handoff" si: pide humano, quiere agendar, listo para comprar.

## FORMATO
Responde natural. Termina con:
[LEAD_DATA] { "intent": "greeting|inquiry|lead|proposal|handoff", "detected_service": "landing_page|web_development|automation|unknown", "lead": { "name": null, "email": null, "phone": null, "service_interest": null }, "confidence": 0.0 } [/LEAD_DATA]`;
}

function createProvider() {
  async function generateResponse(sessionId, conversationHistory, memory = {}, knowledgeDocs = []) {
    const knowledgeContents = knowledgeDocs.map(d => d.content || d);

    const lastMsg = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].content : '';
    const cacheKey = getCacheKey(lastMsg);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL && conversationHistory.length <= 2 && !memory.contact_name) {
      logger.info('Response cache hit', { sessionId, cacheKey });
      return { response: cached.response, leadData: { ...cached.leadData } };
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt(memory, knowledgeContents) },
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
