const axios = require('axios');
const logger = require('./logger');
const config = require('./config');

function buildSystemPrompt() {
  return `Eres un asesor comercial experto de ${config.business.name}, una agencia especializada en ${config.business.services}.

## TU PERSONALIDAD
- Profesional, amable y proactivo
- Usas español neutro (tú)
- Nunca inventes información que no conozcas
- Si no sabes algo, di que lo consultarás con un especialista

## SERVICIOS QUE OFRECES
1. Landing Pages: páginas optimizadas para conversión de ventas y captación de leads. Desde $299 USD
2. Desarrollo Web: sitios corporativos, tiendas online, portales web. Desde $799 USD
3. Automatización: integración de CRM, email marketing, chatbots, flujos de trabajo. Desde $499 USD

## FLUJO DE VENTAS
1. Saluda y preséntate brevemente
2. Pregunta por el negocio del cliente y qué necesita
3. Identifica el servicio adecuado según sus necesidades
4. Haz una propuesta personalizada con precio estimado
5. Ofrece agendar una reunión o llamada
6. Pide datos de contacto (nombre, email, teléfono) si no los tienes

## ESTRATEGIA DE VENTAS
- Escucha y entiende la necesidad antes de proponer
- Explica cómo cada servicio ayuda a su negocio específico
- Sugiere upselling: si piden landing page, menciona automatización; si piden web, menciona landing pages
- Crea urgencia: disponibilidad limitada
- Pide la venta: agenda una reunión para empezar

## FORMATO DE RESPUESTA
Responde de forma natural. Al final de tu respuesta incluye este bloque JSON exacto (sin espacios extra):

[LEAD_DATA]
{
  "intent": "greeting|inquiry|lead|proposal|scheduling",
  "detected_service": "landing_page|web_development|automation|unknown",
  "lead": {
    "name": null,
    "email": null,
    "phone": null,
    "service_interest": null
  },
  "actions": [],
  "confidence": 0.0
}
[/LEAD_DATA]`;
}

async function generateResponse(sessionId, conversationHistory) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...conversationHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    })),
  ];

  try {
    logger.info('Calling Ollama', { model: config.ollama.model, sessionId });

    const response = await axios.post(`${config.ollama.baseUrl}/api/chat`, {
      model: config.ollama.model,
      messages,
      stream: false,
      options: {
        temperature: config.ollama.temperature,
        num_predict: config.ollama.maxTokens,
      },
    }, { timeout: 30000 });

    const content = response.data.message.content;

    let leadData = {
      intent: 'inquiry',
      detected_service: 'unknown',
      lead: { name: null, email: null, phone: null, service_interest: null },
      actions: [],
      confidence: 0.5,
    };

    const jsonMatch = content.match(/\[LEAD_DATA\]\s*({[\s\S]*?})\s*\[\/LEAD_DATA\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        leadData = { ...leadData, ...parsed };
      } catch (parseErr) {
        logger.warn('Failed to parse lead data JSON', { error: parseErr.message, sessionId });
      }
    }

    const cleanResponse = content.replace(/\s*\[LEAD_DATA\][\s\S]*?\[\/LEAD_DATA\]\s*/, '').trim();

    return { response: cleanResponse, leadData };
  } catch (error) {
    logger.error('Ollama request failed', {
      error: error.message,
      sessionId,
      model: config.ollama.model,
    });

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return {
        response: 'Lo siento, el servicio de IA no está disponible en este momento. Por favor, intenta más tarde.',
        leadData: {
          intent: 'error', detected_service: 'unknown',
          lead: { name: null, email: null, phone: null, service_interest: null },
          actions: [], confidence: 0,
        },
      };
    }

    throw error;
  }
}

async function checkOllamaHealth() {
  try {
    const response = await axios.get(`${config.ollama.baseUrl}/api/tags`, { timeout: 5000 });
    const models = response.data.models || [];
    const isModelAvailable = models.some(m => m.name.startsWith(config.ollama.model));
    return { available: true, modelAvailable: isModelAvailable, models: models.map(m => m.name) };
  } catch {
    return { available: false, modelAvailable: false, models: [] };
  }
}

module.exports = { generateResponse, checkOllamaHealth };
