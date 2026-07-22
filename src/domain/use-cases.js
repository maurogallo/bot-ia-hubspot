async function handleMessage({ message, from, channel, store, ai, crm }) {
  const session = await store.getOrCreateSession(channel, null, from);

  await store.addMessage(session.id, 'user', message);

  const history = await store.getConversationHistory(session.id);
  const { response, leadData } = await ai.generateResponse(session.id, history);

  await store.addMessage(session.id, 'assistant', response, { leadData });

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

  return response;
}

module.exports = { handleMessage };
