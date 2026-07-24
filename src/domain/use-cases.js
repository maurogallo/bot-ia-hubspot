const logger = require('../logger');

function extractMemoryFacts(leadData, message) {
  const facts = {};
  if (leadData.lead?.name) facts.contact_name = leadData.lead.name;
  if (leadData.lead?.email) facts.contact_email = leadData.lead.email;
  if (leadData.lead?.phone) facts.contact_phone = leadData.lead.phone;
  if (leadData.lead?.service_interest) facts.service_interest = leadData.lead.service_interest;
  if (leadData.detected_service && leadData.detected_service !== 'unknown') facts.detected_service = leadData.detected_service;
  return facts;
}

const HANDOFF_KEYWORDS = [
  'hablar con un humano', 'hablar con humano', 'asesor personal', 'persona real',
  'hablar con un asesor', 'atención personal', 'que me llame', 'contáctame',
  'quiero hablar con alguien', 'agendar una reunión', 'agendar una cita',
  'hablar con un agente', 'transferir con humano', 'con un asesor',
  'hablar con una persona', 'necesito hablar con alguien',
];

function detectHandoffInMessage(message) {
  const lower = message.toLowerCase();
  return HANDOFF_KEYWORDS.some(k => lower.includes(k));
}

async function handleMessage({ message, from, channel, store, ai, crm }) {
  const session = await store.getOrCreateSession(channel, null, from);

  await store.addMessage(session.id, 'user', message);

  const forceHandoff = detectHandoffInMessage(message);

  const history = await store.getConversationHistory(session.id);
  const memory = typeof store.getMemory === 'function' ? await store.getMemory(session.id) : {};

  let knowledgeDocs = [];
  if (typeof ai.generateEmbedding === 'function' && typeof store.searchKnowledge === 'function') {
    try {
      const embedding = await ai.generateEmbedding(message);
      knowledgeDocs = await store.searchKnowledge(embedding, 3);
    } catch (err) {
      logger.warn('RAG knowledge search failed', { error: err.message, sessionId: session.id });
    }
  }

  const { response, leadData } = await ai.generateResponse(session.id, history, memory, knowledgeDocs);

  await store.addMessage(session.id, 'assistant', response, { leadData });

  if (typeof store.upsertMemory === 'function') {
    const facts = extractMemoryFacts(leadData, message);
    for (const [key, value] of Object.entries(facts)) {
      if (value) await store.upsertMemory(session.id, key, value);
    }
  }

  const isHandoff = forceHandoff || leadData.intent === 'handoff';

  const hasLeadInfo = leadData.lead?.email && (leadData.intent === 'lead' || leadData.confidence >= 0.7);

  if (hasLeadInfo) {
    let contact = null;
    try {
      contact = await crm.getOrCreateContact(leadData.lead.email, {
        name: leadData.lead.name || undefined,
        phone: leadData.lead.phone || from,
      });
      await store.updateSessionContext(session.id, { hubspotContactId: contact.id });
      await store.saveContact({
        hubspotId: contact.id,
        name: leadData.lead.name,
        email: leadData.lead.email,
        phone: leadData.lead.phone || from,
      });
    } catch (err) {
      throw err;
    }
    if (contact) {
      try {
        const dealName = leadData.lead?.service_interest
          ? `Lead ${leadData.lead.name || leadData.lead.email} - ${leadData.lead.service_interest}`
          : `Lead ${leadData.lead.name || leadData.lead.email}`;
        await crm.createDeal(contact.id, dealName, null, {
          pipeline: 'default',
          dealstage: 'appointmentscheduled',
        });
      } catch (err) {
        logger.error('Deal creation failed', { error: err.message, email: leadData.lead.email });
      }
    }
  }

  if (isHandoff) {
    const handoffResponse = 'Gracias por tu interés. Un asesor comercial te contactará pronto para brindarte atención personalizada.';
    await store.addMessage(session.id, 'assistant', handoffResponse, { leadData, handoff: true });
    await store.updateSessionContext(session.id, {
      handoffNeeded: true,
      handoffReason: leadData.detected_service,
      handoffConfidence: leadData.confidence,
      handoffLead: leadData.lead,
    });
    return { response: handoffResponse, leadData, handoffNeeded: true };
  }

  return { response, leadData, handoffNeeded: false };
}

module.exports = { handleMessage };
