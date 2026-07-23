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
  const { response, leadData } = await ai.generateResponse(session.id, history);

  await store.addMessage(session.id, 'assistant', response, { leadData });

  const isHandoff = forceHandoff || leadData.intent === 'handoff';

  if (leadData.intent === 'lead' && leadData.lead?.email) {
    try {
      const contact = await crm.getOrCreateContact(leadData.lead.email, {
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
