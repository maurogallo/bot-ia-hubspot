const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

function buildSystemPrompt() {
  return `Eres un asesor comercial experto de ${config.business.name}, una agencia especializada en ${config.business.services}.

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
1. Saluda y preséntate
2. Pregunta por su negocio y necesidad
3. Identifica el servicio adecuado
4. Propuesta personalizada con precio estimado
5. Ofrece agendar una reunión
6. Pide datos de contacto si no los tienes

## ESTRATEGIA
- Escucha antes de proponer
- Explica cómo cada servicio ayuda a su negocio
- Sugiere upselling
- Crea urgencia
- Pide la venta

## FORMATO
Responde de forma natural. Al final incluye este bloque JSON exacto:

[LEAD_DATA]
{
  "intent": "greeting|inquiry|lead|proposal|scheduling",
  "detected_service": "landing_page|web_development|automation|unknown",
  "lead": { "name": null, "email": null, "phone": null, "service_interest": null },
  "actions": [],
  "confidence": 0.0
}
[/LEAD_DATA]`;
}

function createProvider() {
  async function generateResponse(sessionId, conversationHistory) {
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
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
      }, { timeout: 30000 });

      const content = response.data.message.content;
      let leadData = { intent: 'inquiry', detected_service: 'unknown',
        lead: { name: null, email: null, phone: null, service_interest: null },
        actions: [], confidence: 0.5 };

      const jsonMatch = content.match(/\[LEAD_DATA\]\s*({[\s\S]*?})\s*\[\/LEAD_DATA\]/);
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

  async function checkHealth() {
    try {
      const response = await axios.get(`${config.ollama.baseUrl}/api/tags`, { timeout: 5000 });
      const models = response.data.models || [];
      const modelAvailable = models.some(m => m.name.startsWith(config.ollama.model));
      return { available: true, modelAvailable, models: models.map(m => m.name) };
    } catch {
      return { available: false, modelAvailable: false, models: [] };
    }
  }

  return { generateResponse, checkHealth };
}

module.exports = { createProvider };
