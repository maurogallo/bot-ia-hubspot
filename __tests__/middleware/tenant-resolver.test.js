const { createResolver } = require('../../src/middleware/tenant-resolver');

function mockStore(overrides = {}) {
  return {
    getTenantBySlug: jest.fn(),
    getTenantByPhone: jest.fn(),
    getTenantByPhoneNumberId: jest.fn(),
    getDefaultTenant: jest.fn(),
    ...overrides,
  };
}

describe('tenant-resolver', () => {
  const defaultTenant = { id: 'default-id', slug: 'default', plan: 'starter', business_name: 'Default' };
  const businessTenant = { id: 'biz-id', slug: 'clinica-test', plan: 'business', business_name: 'Clinica Test', whatsapp_phone: '+5491112345678' };

  test('resolves from body.tenant', async () => {
    const store = mockStore({
      getTenantBySlug: jest.fn().mockResolvedValue(businessTenant),
      getDefaultTenant: jest.fn().mockResolvedValue(defaultTenant),
    });
    const resolver = createResolver(store);
    const req = { body: { tenant: 'clinica-test' }, headers: {} };
    const tenant = await resolver.resolveFromRequest(req);
    expect(tenant.slug).toBe('clinica-test');
    expect(store.getTenantBySlug).toHaveBeenCalledWith('clinica-test');
  });

  test('resolves from X-Tenant header', async () => {
    const store = mockStore({
      getTenantBySlug: jest.fn().mockResolvedValue(businessTenant),
      getDefaultTenant: jest.fn().mockResolvedValue(defaultTenant),
    });
    const resolver = createResolver(store);
    const req = { body: {}, headers: { 'x-tenant': 'clinica-test' } };
    const tenant = await resolver.resolveFromRequest(req);
    expect(tenant.slug).toBe('clinica-test');
  });

  test('falls back to default tenant when nothing matches', async () => {
    const store = mockStore({
      getTenantBySlug: jest.fn().mockResolvedValue(null),
      getDefaultTenant: jest.fn().mockResolvedValue(defaultTenant),
    });
    const resolver = createResolver(store);
    const req = { body: { tenant: 'nonexistent' }, headers: {} };
    const tenant = await resolver.resolveFromRequest(req);
    expect(tenant.slug).toBe('default');
  });

  test('resolves WhatsApp phone to tenant', async () => {
    const store = mockStore({
      getTenantByPhone: jest.fn().mockResolvedValue(businessTenant),
      getDefaultTenant: jest.fn().mockResolvedValue(defaultTenant),
    });
    const resolver = createResolver(store);
    const tenant = await resolver.resolveFromWhatsApp('+5491112345678');
    expect(tenant.slug).toBe('clinica-test');
  });

  test('WhatsApp falls back to default for unknown phone', async () => {
    const store = mockStore({
      getTenantByPhone: jest.fn().mockResolvedValue(null),
      getDefaultTenant: jest.fn().mockResolvedValue(defaultTenant),
    });
    const resolver = createResolver(store);
    const tenant = await resolver.resolveFromWhatsApp('+5499999999');
    expect(tenant.slug).toBe('default');
  });

  test('resolves from phone number id', async () => {
    const metaTenant = { id: 'meta-id', slug: 'meta-tenant', plan: 'pro', whatsapp_phone_number_id: '123456789' };
    const store = mockStore({
      getTenantByPhoneNumberId: jest.fn().mockResolvedValue(metaTenant),
      getDefaultTenant: jest.fn().mockResolvedValue(defaultTenant),
    });
    const resolver = createResolver(store);
    const tenant = await resolver.resolveFromPhoneNumberId('123456789');
    expect(tenant.slug).toBe('meta-tenant');
  });

  test('resolveFromSlug works', async () => {
    const store = mockStore({
      getTenantBySlug: jest.fn().mockResolvedValue(businessTenant),
      getDefaultTenant: jest.fn().mockResolvedValue(defaultTenant),
    });
    const resolver = createResolver(store);
    const tenant = await resolver.resolveFromSlug('clinica-test');
    expect(tenant.slug).toBe('clinica-test');
  });
});
