const logger = require('../logger');
const { getTenantFeatures, getQuotaLimit } = require('./tenant-features');
let notifyService = null;
try { notifyService = require('../adapters/outbound/notification-service'); } catch (e) { /* optional */ }

function extractMemoryFacts(leadData, message) {
  const facts = {};
  if (leadData.lead?.name) facts.contact_name = leadData.lead.name;
  if (leadData.lead?.email) facts.contact_email = leadData.lead.email;
  if (leadData.lead?.phone) facts.contact_phone = leadData.lead.phone;
  if (leadData.lead?.service_interest) facts.service_interest = leadData.lead.service_interest;
  if (leadData.detected_service && leadData.detected_service !== 'unknown') facts.detected_service = leadData.detected_service;
  return facts;
}

function extractFromMessage(message, memory) {
  const facts = {};
  const clean = message.trim();

  const emailMatch = clean.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch && !memory.contact_email) {
    facts.contact_email = emailMatch[1];
  }

  const phoneMatch = clean.match(/(\+?\d{8,15})/);
  if (phoneMatch && !memory.contact_phone && !emailMatch) {
    facts.contact_phone = phoneMatch[1];
  }

  if (!memory.contact_name && !emailMatch && !phoneMatch && clean.length >= 2 && clean.length <= 40 &&
      !clean.match(/^(hola|buenas|buenos|si|no|ok|gracias|bien|que|como|cuál|cuando|donde|porque|para|puedes|quiero|necesito|me|indica|dame|explícame|ayuda|info|detalle)/i)) {
    facts.contact_name = clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  return facts;
}

const HANDOFF_KEYWORDS = [
  'hablar con un humano', 'hablar con humano', 'asesor personal', 'persona real',
  'hablar con un asesor', 'atención personal', 'que me llame', 'contáctame',
  'quiero hablar con alguien',
  'hablar con un agente', 'transferir con humano', 'con un asesor',
  'hablar con una persona', 'necesito hablar con alguien',
];

function detectHandoffInMessage(message) {
  const lower = message.toLowerCase();
  return HANDOFF_KEYWORDS.some(k => lower.includes(k));
}

async function handleMessage({ message, from, channel, store, ai, crm, calendar, tenant = null }) {
  const features = getTenantFeatures(tenant);
  const tenantId = tenant?.id || null;

  if (tenant) {
    const quotaLimit = getQuotaLimit(tenant, 'conversations');
    if (quotaLimit !== -1 && typeof store.getMonthlyUsage === 'function') {
      const usage = await store.getMonthlyUsage(tenantId, 'conversations');
      if (usage >= quotaLimit) {
        logger.warn('Quota exceeded for tenant', { tenantId, slug: tenant.slug, usage, limit: quotaLimit });
        const quotaMsg = 'Lo siento, hemos alcanzado el limite de conversaciones de este mes. Por favor contacta a tu proveedor para ampliar el plan.';
        return { response: quotaMsg, leadData: null, handoffNeeded: false, quotaExceeded: true };
      }
    }
  }

  const session = await store.getOrCreateSession(channel, null, from, tenantId);

  if (tenant && typeof store.logUsage === 'function') {
    await store.logUsage(tenantId, 'conversations', 1);
  }

  await store.addMessage(session.id, 'user', message);

  const forceHandoff = detectHandoffInMessage(message);

  const history = await store.getConversationHistory(session.id);
  const memory = typeof store.getMemory === 'function' ? await store.getMemory(session.id) : {};

  let knowledgeDocs = [];
  if (features.knowledgeBase && typeof ai.generateEmbedding === 'function' && typeof store.searchKnowledge === 'function') {
    try {
      const embedding = await ai.generateEmbedding(message);
      if (tenantId && typeof store.searchKnowledgeForTenant === 'function') {
        knowledgeDocs = await store.searchKnowledgeForTenant(embedding, 3, tenantId);
      } else {
        knowledgeDocs = await store.searchKnowledge(embedding, 3);
      }
    } catch (err) {
      logger.warn('RAG knowledge search failed', { error: err.message, sessionId: session.id });
    }
  }

  const missingData = [];
  if (!memory.contact_name) missingData.push('nombre');
  if (!memory.contact_email) missingData.push('email');
  if (!memory.contact_phone) missingData.push('telefono');
  if (missingData.length > 0) {
    const next = missingData[0];
    knowledgeDocs = [{
      content: `INSTRUCCION OBLIGATORIA: Tu UNICA tarea ahora es conseguir el ${next} del cliente. No ofrezcas agendar, no hables de servicios, no des explicaciones. Solo pregunta el ${next}. Si el cliente ya te lo dio en este mensaje, dalo por recibido y pide el siguiente dato. Datos que te faltan: ${missingData.join(', ')}.`
    }, ...knowledgeDocs];
  } else {
    knowledgeDocs = [{
      content: 'INSTRUCCION: Ya tienes nombre (' + memory.contact_name + '), email y telefono. Dile: "Gracias ' + memory.contact_name + ', tengo tus datos. Te gustaria agendar una reunion?" Si acepta usa intent="schedule" con action="request_availability".'
    }, ...knowledgeDocs];
  }

  let services = [];
  if (tenantId && typeof store.getTenantServices === 'function') {
    try { services = await store.getTenantServices(tenantId); } catch (e) { /* ignore */ }
  }

  const { response, leadData } = await ai.generateResponse(session.id, history, memory, knowledgeDocs, tenant, services);

  await store.addMessage(session.id, 'assistant', response, { leadData });

  if (typeof store.upsertMemory === 'function') {
    const facts = extractMemoryFacts(leadData, message);
    const directFacts = extractFromMessage(message, memory);
    const allFacts = { ...facts, ...directFacts };
    const hadEmail = !!memory.contact_email;
    for (const [key, value] of Object.entries(allFacts)) {
      if (value) await store.upsertMemory(session.id, key, value);
    }
    if (!hadEmail && allFacts.contact_email && allFacts.contact_name && notifyService) {
      const updatedMemory = { ...memory, ...allFacts };
      logger.info('Lead complete, sending notification', { email: allFacts.contact_email, tenant: tenant?.slug });
      notifyService.sendNewLeadNotification(tenant, leadData, updatedMemory).catch(() => {});
    } else if (!hadEmail && allFacts.contact_email && allFacts.contact_name) {
      logger.info('Lead complete but notifyService not available');
    }
  }

  const isHandoff = forceHandoff || leadData.intent === 'handoff';

  const hasLeadInfo = leadData.lead?.email && (leadData.intent === 'lead' || leadData.confidence >= 0.7);

  if (hasLeadInfo && features.crm) {
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
        tenantId,
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

  if (leadData.intent === 'schedule' && features.scheduling && calendar && memory.contact_email) {
    const schedResult = await handleScheduling({
      session, leadData, message, from, store, calendar, tenant, tenantId,
      memory,
    });
    if (schedResult) return { ...schedResult, handoffNeeded: false };
  }

  return { response, leadData, handoffNeeded: false };
}

function proposeTimeSlots(slots) {
  if (!slots || slots.length === 0) {
    return 'Lo siento, no tengo horarios disponibles ese dia. Queres intentar con otro dia?';
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lines = slots.slice(0, 6).map((s, i) => `${letters[i]}) ${s.label}`);
  return `Estos son los horarios disponibles:\n${lines.join('\n')}\n\nCual te queda mejor? Responde con la letra.`;
}

async function handleScheduling({ session, leadData, message, from, store, calendar, tenant, tenantId, memory }) {
  const { scheduling } = leadData;
  if (!scheduling) return null;

  const email = memory.contact_email;
  const name = memory.contact_name;

  if (scheduling.action === 'request_availability') {
    let dateStr = scheduling.preferred_date;
    if (!dateStr) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateStr = tomorrow.toISOString().split('T')[0];
    }

    try {
      const { slots } = await calendar.getAvailability(dateStr);
      const response = proposeTimeSlots(slots);

      const schedulingLeadData = {
        ...leadData,
        scheduling: { ...scheduling, proposed_slots: slots.slice(0, 6), pending_date: dateStr },
      };

      await store.addMessage(session.id, 'assistant', response, { leadData: schedulingLeadData });

      return { response, leadData: schedulingLeadData };
    } catch (err) {
      logger.error('Scheduling availability error', { error: err.message, tenantId });
      return {
        response: 'Lo siento, tuve un problema al verificar la disponibilidad. Intenta mas tarde.',
        leadData,
      };
    }
  }

  if (scheduling.action === 'confirm_slot') {
    const preferredSlot = scheduling.preferred_date && scheduling.preferred_time
      ? `${scheduling.preferred_date}T${scheduling.preferred_time}:00`
      : null;

    if (!preferredSlot || !email) {
      return {
        response: 'Necesito tu email y un horario confirmado para agendar la reunion.',
        leadData,
      };
    }

    try {
      const event = await calendar.bookAppointment(name || email, email, preferredSlot);

      await store.saveAppointment({
        tenantId,
        sessionId: session.id,
        contactEmail: email,
        contactName: name,
        contactPhone: from,
        googleEventId: event.id,
        serviceInterest: memory.service_interest,
        startTime: event.start,
        endTime: event.end,
        metadata: { hangoutLink: event.hangoutLink, htmlLink: event.htmlLink },
      });

      const dateFormatted = new Date(event.start).toLocaleString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
      });

      let confirmMsg = `Listo ${name || ''}! Te envie la invitacion a ${email}. `;
      confirmMsg += `Nos vemos el ${dateFormatted}`;
      if (event.hangoutLink) confirmMsg += `\n\nLink de Google Meet: ${event.hangoutLink}`;

      await store.addMessage(session.id, 'assistant', confirmMsg, {
        leadData: { ...leadData, scheduling: { ...scheduling, event: event.id, meet: event.hangoutLink } },
      });

      return { response: confirmMsg, leadData };
    } catch (err) {
      logger.error('Scheduling booking error', { error: err.message, tenantId });
      return {
        response: 'Lo siento, no pude agendar la reunion. Intenta de nuevo mas tarde.',
        leadData,
      };
    }
  }

  if (scheduling.action === 'cancel') {
    try {
      const appointments = await store.getAppointmentsByEmail(tenantId, email);
      if (appointments.length > 0) {
        await store.cancelAppointment(appointments[0].id);
      }
      return {
        response: 'Listo, la reunion fue cancelada. Queres agendar otra fecha?',
        leadData,
      };
    } catch (err) {
      return {
        response: 'No pude cancelar la reunion. Contacta a soporte por favor.',
        leadData,
      };
    }
  }

  return null;
}

module.exports = { handleMessage, proposeTimeSlots };
