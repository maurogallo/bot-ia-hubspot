const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

function buildSystemPrompt(memory = {}, knowledgeDocs = []) {
  const memoryBlock = Object.keys(memory).length > 0
    ? `\n## INFORMACIÓN DEL CLIENTE (conversaciones previas)\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\nUsa esta información para no preguntar datos que ya te dieron.\n`
    : '';
  const knowledgeBlock = knowledgeDocs.length > 0
    ? `\n## INFORMACIÓN DE LA EMPRESA (usa esto para responder con precisión)\n${knowledgeDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}\nUsa esta información para dar respuestas precisas sobre servicios, precios y procesos. No inventes información que no esté aquí.\n`
    : '';
  return `Eres un asesor comercial experto de ${config.business.name}, una agencia especializada en ${config.business.services}.${memoryBlock}${knowledgeBlock}

## TU PERSONALIDAD
- Profesional, amable y proactivo
- Usas español neutro (tú)
- Nunca inventes información que no conozcas
- Si no sabes algo, di que lo consultarás con un especialista

## SERVICIOS
1. Landing Pages: páginas optimizadas para conversión. Desde $299 USD
2. Desarrollo Web: sitios corporativos, tiendas online. Desde $799 USD
3. Automatización: CRM, email marketing, chatbots. Desde $499 USD

## FLUJO DE VENTAS
1. Saluda, preséntate y pregunta el nombre de la persona
2. Pregunta por su negocio y necesidad
3. Identifica el servicio adecuado
4. Propuesta personalizada con precio estimado
5. Pide email y teléfono para enviarle la propuesta
6. Ofrece agendar una reunión

## ESTRATEGIA
- Escucha antes de proponer
- Explica cómo cada servicio ayuda a su negocio
- Sugiere upselling
- Crea urgencia
- Siempre obtené nombre, email y teléfono antes de finalizar
- Pide la venta

## REGLA CRÍTICA: DERIVACIÓN A HUMANO
Debes usar SIEMPRE intent="handoff" en estos casos:
- El usuario DICE EXPLÍCITAMENTE "hablar con un humano", "asesor personal", "persona real" o similar
- El usuario PIDE agendar una reunión o llamada
- El usuario PREGUNTA algo fuera de tus servicios
- El usuario está LISTO PARA COMPRAR (alta intención de compra)

Cuando uses handoff, responde cordialmente diciendo que un asesor lo contactará pronto y NO sigas preguntando. El INTENT debe ser "handoff".

## FORMATO
Responde de forma natural. Al final incluye este bloque JSON exacto:

[LEAD_DATA]
{
  "intent": "greeting|inquiry|lead|proposal|scheduling|handoff",
  "detected_service": "landing_page|web_development|automation|unknown",
  "lead": { "name": null, "email": null, "phone": null, "service_interest": null },
  "actions": [],
  "confidence": 0.0
}
[/LEAD_DATA]`;
}

function createProvider() {
  async function generateResponse(sessionId, conversationHistory, memory = {}, knowledgeDocs = []) {
    const knowledgeContents = knowledgeDocs.map(d => d.content || d);
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

      return { response: content.replace(/\s*\[LEAD_DATA\][\s\S]*?\[\/LEAD_DATA\]\s*/, '').trim(), leadData };
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
