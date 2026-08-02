const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

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
    ? `\nDATOS DEL CLIENTE (ya los tienes):\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
    : '\nDATOS DEL CLIENTE: no tienes ningun dato todavia.\n';

  const knowledgeBlock = knowledgeDocs.length > 0
    ? `\n${knowledgeDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n`
    : '';

  let schedulingRules = '';
  if (hasScheduling) {
    schedulingRules = '- Si el cliente quiere agendar y ya tienes nombre+email+telefono, usa intent="schedule" con action="request_availability". Si faltan datos, pidelos primero.';
  }

  return `Eres un asesor comercial de ${businessName} (${businessServices}).${knowledgeBlock}${memoryBlock}

SERVICIOS QUE OFRECES:
${servicesBlock}

INSTRUCCIONES:
- Responde en maximo 2 oraciones. Español neutro, trata de "tu".
- Si el cliente pregunta por servicios, menciona los de arriba con sus precios.
- NUNCA inventes servicios que no esten en la lista de arriba.
${hasScheduling ? schedulingRules : '- Si el cliente da todos sus datos, usa intent="lead".'}
- Si el cliente pide hablar con un humano, usa intent="handoff".

Responde con tu mensaje y luego el JSON:
[LEAD_DATA]{"intent":"greeting|inquiry|lead|proposal|handoff|schedule","detected_service":"${serviceKeys}|unknown","lead":{"name":"${memory.contact_name || ''}","email":"${memory.contact_email || ''}","phone":"${memory.contact_phone || ''}","service_interest":""},"scheduling":{"action":"request_availability|confirm_slot|cancel","preferred_date":null,"preferred_time":null},"confidence":0.9}[/LEAD_DATA]`;
}

function createProvider(apiKey) {
  const key = apiKey || config.openai?.apiKey || '';

  async function generateResponse(sessionId, conversationHistory, memory = {}, knowledgeDocs = [], tenant = null, services = []) {
    const knowledgeContents = knowledgeDocs.map(d => d.content || d);
    const systemPrompt = buildSystemPrompt(memory, knowledgeContents, tenant, services);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    try {
      const response = await axios.post(OPENAI_API, {
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 300,
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
        catch (e) { logger.warn('Failed to parse lead data', { error: e.message }); }
      }

      let cleanResponse = content.replace(/\s*\[LEAD_DATA\][\s\S]*?\[\/LEAD_DATA\]\s*/, '').trim();
      if (cleanResponse === content || !cleanResponse) {
        cleanResponse = content.replace(/\s*\{[\s\S]*?"intent"[\s\S]*?\}\s*$/, '').trim();
      }
      if (!cleanResponse || cleanResponse.length < 2) {
        cleanResponse = content.split('{')[0].trim();
      }

      return { response: cleanResponse, leadData };
    } catch (error) {
      logger.error('OpenAI request failed', { error: error.message, sessionId });
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
    return { available: true, model: 'gpt-4o-mini' };
  }

  return { generateResponse, checkHealth };
}

module.exports = { createProvider };
