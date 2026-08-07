const { handleMessage } = require('../../src/domain/use-cases');
const { createMockStore } = require('../mocks/store');
const { createMockAI } = require('../mocks/ai');
const { createMockCRM } = require('../mocks/crm');

function setup() {
  const store = createMockStore();
  const ai = createMockAI();
  const crm = createMockCRM();
  return { store, ai, crm };
}

describe('handleMessage', () => {
  it('processes a simple message and returns response', async () => {
    const { store, ai, crm } = setup();
    const result = await handleMessage({ message: 'Hola', from: '+549111111', channel: 'web', store, ai, crm });

    expect(result.response).toBeDefined();
    expect(typeof result.response).toBe('string');
    expect(result.handoffNeeded).toBe(false);

    expect(store.getOrCreateSession).toHaveBeenCalledWith('web', null, '+549111111', null);
    expect(store.addMessage).toHaveBeenCalledTimes(2);
    expect(ai.generateResponse).toHaveBeenCalled();
  });

  it('passes conversation history to AI', async () => {
    const { store, ai, crm } = setup();
    store.getConversationHistory = jest.fn(async () => [
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: 'Bienvenido' },
    ]);
    await handleMessage({ message: 'Test', from: '+549112222', channel: 'web', store, ai, crm });

    const historyArg = ai.generateResponse.mock.calls[0][1];
    expect(historyArg).toHaveLength(2);
    expect(historyArg[0].content).toBe('Hola');
  });

  it('passes memory to AI', async () => {
    const { store, ai, crm } = setup();
    store.getMemory = jest.fn(async () => ({ contact_name: 'Juan' }));
    await handleMessage({ message: 'Test', from: '+549113333', channel: 'web', store, ai, crm });

    const memoryArg = ai.generateResponse.mock.calls[0][2];
    expect(memoryArg.contact_name).toBe('Juan');
  });

  it('performs RAG search and passes knowledge docs', async () => {
    const { store, ai, crm } = setup();
    const docs = [{ content: 'Servicio de landing pages', metadata: { type: 'service' } }];
    store.searchKnowledge = jest.fn(async () => docs);
    ai.generateEmbedding = jest.fn(async () => [0.1, 0.2, 0.3]);

    await handleMessage({ message: '¿Landing pages?', from: '+549114444', channel: 'web', store, ai, crm });

    expect(ai.generateEmbedding).toHaveBeenCalledWith('¿Landing pages?');
    expect(store.searchKnowledge).toHaveBeenCalled();
    const knowledgeArg = ai.generateResponse.mock.calls[0][3];
    expect(knowledgeArg).toEqual(expect.arrayContaining(docs));
  });

  it('handles RAG failure gracefully', async () => {
    const { store, ai, crm } = setup();
    ai.generateEmbedding = jest.fn(async () => { throw new Error('Ollama error'); });

    const result = await handleMessage({ message: 'Test', from: '+549115555', channel: 'web', store, ai, crm });
    expect(result.response).toBeDefined();
  });

  it('extracts lead data and registers in CRM', async () => {
    const { store, ai, crm } = setup();
    ai.generateResponse = jest.fn(async () => ({
      response: 'Te registro como lead',
      leadData: {
        intent: 'lead',
        confidence: 0.85,
        lead: { name: 'Juan Pérez', email: 'juan@test.com', phone: '+549116666', service_interest: 'landing page' },
      },
    }));

    const result = await handleMessage({ message: 'Quiero una landing', from: '+549116666', channel: 'web', store, ai, crm });

    expect(crm.getOrCreateContact).toHaveBeenCalledWith('juan@test.com', {
      name: 'Juan Pérez',
      phone: '+549116666',
    });
    expect(store.saveContact).toHaveBeenCalled();
    expect(crm.createDeal).toHaveBeenCalled();
    expect(result.handoffNeeded).toBe(false);
  });

  it('does not register lead if confidence is low', async () => {
    const { store, ai, crm } = setup();
    ai.generateResponse = jest.fn(async () => ({
      response: 'Cuéntame más',
      leadData: {
        intent: 'unknown',
        confidence: 0.3,
        lead: { name: 'Juan', email: 'juan@test.com' },
      },
    }));

    await handleMessage({ message: 'Hola', from: '+549117777', channel: 'web', store, ai, crm });

    expect(crm.getOrCreateContact).not.toHaveBeenCalled();
  });

  it('registers lead when intent is lead even with confidence < 0.7', async () => {
    const { store, ai, crm } = setup();
    ai.generateResponse = jest.fn(async () => ({
      response: 'Te registro como lead',
      leadData: {
        intent: 'lead',
        confidence: 0.5,
        lead: { name: 'María', email: 'maria@test.com' },
      },
    }));

    await handleMessage({ message: 'Test', from: '+549118888', channel: 'web', store, ai, crm });

    expect(crm.getOrCreateContact).toHaveBeenCalled();
  });

  it('detects handoff from AI intent', async () => {
    const { store, ai, crm } = setup();
    ai.generateResponse = jest.fn(async () => ({
      response: 'Te transfiero',
      leadData: { intent: 'handoff', confidence: 0.9, lead: {}, detected_service: 'landing page' },
    }));

    const result = await handleMessage({ message: 'Test', from: '+549119999', channel: 'web', store, ai, crm });

    expect(result.handoffNeeded).toBe(true);
    expect(store.updateSessionContext).toHaveBeenCalled();
    expect(store.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      'assistant',
      expect.stringContaining('asesor'),
      expect.any(Object)
    );
  });

  it('detects handoff from keywords in message', async () => {
    const { store, ai, crm } = setup();

    const result = await handleMessage({ message: 'Quiero hablar con un humano', from: '+549110000', channel: 'web', store, ai, crm });

    expect(result.handoffNeeded).toBe(true);
  });

  it('handles CRM errors gracefully', async () => {
    const { store, ai, crm } = setup();
    ai.generateResponse = jest.fn(async () => ({
      response: 'Te registro',
      leadData: { intent: 'lead', confidence: 0.9, lead: { name: 'Test', email: 'test@test.com' } },
    }));
    crm.getOrCreateContact = jest.fn(async () => { throw new Error('HubSpot API error'); });

    await expect(handleMessage({ message: 'Test', from: '+549110001', channel: 'web', store, ai, crm })).rejects.toThrow('HubSpot API error');
  });

  it('persists extracted facts to memory', async () => {
    const { store, ai, crm } = setup();
    ai.generateResponse = jest.fn(async () => ({
      response: 'Te registro',
      leadData: {
        intent: 'lead',
        confidence: 0.9,
        lead: { name: 'Carlos', email: 'carlos@test.com', phone: '+549110002', service_interest: 'web' },
      },
    }));

    await handleMessage({ message: 'Quiero web', from: '+549110002', channel: 'web', store, ai, crm });

    expect(store.upsertMemory).toHaveBeenCalledWith(expect.any(String), 'contact_name', 'Carlos');
    expect(store.upsertMemory).toHaveBeenCalledWith(expect.any(String), 'contact_email', 'carlos@test.com');
    expect(store.upsertMemory).toHaveBeenCalledWith(expect.any(String), 'contact_phone', '+549110002');
    expect(store.upsertMemory).toHaveBeenCalledWith(expect.any(String), 'service_interest', 'web');
  });

  it('blocks messages from a tenant with billing suspended', async () => {
    const { store, ai, crm } = setup();
    const tenant = { id: 'tenant-1', slug: 'test', plan: 'pro', billing_status: 'past_due' };

    const result = await handleMessage({ message: 'Hola', from: '+549110003', channel: 'web', store, ai, crm, tenant });

    expect(result.billingSuspended).toBe(true);
    expect(result.response).toContain('suscripcion');
    expect(store.getOrCreateSession).not.toHaveBeenCalled();
    expect(ai.generateResponse).not.toHaveBeenCalled();
  });

  it('sends quota warning when usage reaches 80% of limit (once per month)', async () => {
    const { store, ai, crm } = setup();
    const tenant = { id: 'tenant-1', slug: 'test', plan: 'starter' };
    store.getMonthlyUsage = jest.fn(async (tenantId, metric) => {
      return metric === 'quota_warning_80' ? 0 : 80;
    });
    const notifyService = require('../../src/adapters/outbound/notification-service');
    const spy = jest.spyOn(notifyService, 'sendQuotaWarning').mockResolvedValue();

    await handleMessage({ message: 'Hola', from: '+549110004', channel: 'web', store, ai, crm, tenant });

    expect(spy).toHaveBeenCalled();
    expect(store.logUsage).toHaveBeenCalledWith(expect.any(String), 'quota_warning_80', 1);
    spy.mockRestore();
  });
});
