function createMockStore() {
  const sessions = {};
  const messages = {};
  const memories = {};
  let contacts = [];
  let knowledgeDocs = [];
  let sessionCounter = 0;

  return {
    getOrCreateSession: jest.fn(async (channel, contactId, phone) => {
      const existing = Object.values(sessions).find(s => s.phone === phone && s.isActive);
      if (existing) return existing;
      const id = `session-${++sessionCounter}`;
      const session = { id, channel, phone, context: {}, isActive: true };
      sessions[id] = session;
      return { ...session };
    }),

    addMessage: jest.fn(async (sessionId, role, content, metadata) => {
      if (!messages[sessionId]) messages[sessionId] = [];
      const msg = { id: `msg-${messages[sessionId].length + 1}`, sessionId, role, content, metadata: metadata || {} };
      messages[sessionId].push(msg);
      return msg;
    }),

    getConversationHistory: jest.fn(async (sessionId, limit = 20) => {
      return (messages[sessionId] || []).slice(-limit);
    }),

    updateSessionContext: jest.fn(async (sessionId, context) => {
      if (sessions[sessionId]) sessions[sessionId].context = { ...sessions[sessionId].context, ...context };
    }),

    saveContact: jest.fn(async (data) => {
      contacts.push(data);
      return data;
    }),

    getMemory: jest.fn(async (sessionId) => {
      return memories[sessionId] || {};
    }),

    upsertMemory: jest.fn(async (sessionId, key, value) => {
      if (!memories[sessionId]) memories[sessionId] = {};
      memories[sessionId][key] = value;
    }),

    searchKnowledge: jest.fn(async (embedding, limit = 3) => {
      return knowledgeDocs.slice(0, limit);
    }),

    getKnowledgeCount: jest.fn(async () => knowledgeDocs.length),

    addKnowledge: jest.fn(async (content, metadata, embedding) => {
      const doc = { id: `doc-${knowledgeDocs.length + 1}`, content, metadata: metadata || {}, embedding };
      knowledgeDocs.push(doc);
      return doc;
    }),

    getAllKnowledge: jest.fn(async () => knowledgeDocs),

    deleteKnowledge: jest.fn(async (id) => {
      knowledgeDocs = knowledgeDocs.filter(d => d.id !== id);
    }),

    getStats: jest.fn(async () => ({
      totalSessions: Object.keys(sessions).length,
      totalMessages: Object.values(messages).reduce((a, b) => a + b.length, 0),
      totalLeads: contacts.length,
    })),

    getActiveConversations: jest.fn(async () => []),
    getConversationById: jest.fn(async (id) => null),
    getLeads: jest.fn(async () => contacts),
    getHandoffSessions: jest.fn(async () => []),
    assignHandoff: jest.fn(async (id, assignedTo) => {}),

    getMonthlyUsage: jest.fn(async () => 0),
    logUsage: jest.fn(async () => {}),
    getActiveSubscriptionByTenant: jest.fn(async () => null),
    getSubscriptionByTenant: jest.fn(async () => null),
    getAllSubscriptions: jest.fn(async () => []),
    createSubscription: jest.fn(async (data) => ({ id: 'sub-1', ...data })),
    updateSubscription: jest.fn(async (id, data) => ({ id, ...data })),
    setTenantBillingStatus: jest.fn(async () => {}),
    setTenantWompiSubscription: jest.fn(async () => {}),
    saveInvoice: jest.fn(async (data) => ({ id: 'inv-1', ...data })),
    getInvoicesByTenant: jest.fn(async () => []),
    getAllInvoices: jest.fn(async () => []),
    getInvoiceByReference: jest.fn(async () => null),
    getInvoiceByTransactionId: jest.fn(async () => null),
    getFinancialDashboard: jest.fn(async () => ({ mrr: 0 })),
    getPastDueTenants: jest.fn(async () => []),
    suspendTenant: jest.fn(async () => {}),
    reactivateTenant: jest.fn(async () => {}),
    getTenantBySlug: jest.fn(async (slug) => ({ id: 'tenant-1', slug, plan: 'pro', owner_email: 'owner@test.com' })),
    getTenantByPhone: jest.fn(async () => null),
    getTenantByPhoneNumberId: jest.fn(async () => null),
    getDefaultTenant: jest.fn(async () => null),
    getAllTenants: jest.fn(async () => []),
  };
}

module.exports = { createMockStore };
