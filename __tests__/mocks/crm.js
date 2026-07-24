function createMockCRM() {
  let contacts = [];
  let deals = [];

  return {
    getOrCreateContact: jest.fn(async (email, properties) => {
      let existing = contacts.find(c => c.email === email);
      if (existing) return existing;
      const contact = { id: `contact-${contacts.length + 1}`, email, ...properties };
      contacts.push(contact);
      return contact;
    }),

    createDeal: jest.fn(async (contactId, dealName, amount, properties) => {
      const deal = { id: `deal-${deals.length + 1}`, contactId, dealName, amount, ...properties };
      deals.push(deal);
      return deal;
    }),

    getAuthorizationUrl: jest.fn(() => 'https://app.hubspot.com/oauth/authorize?client_id=test'),
    exchangeAuthorizationCode: jest.fn(async (code) => ({ accessToken: 'mock-token', refreshToken: 'mock-refresh' })),
  };
}

module.exports = { createMockCRM };
