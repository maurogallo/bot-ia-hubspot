const logger = require('../logger');

function createResolver(store) {
  async function resolveFromRequest(req) {
    if (req.body?.tenant) {
      const tenant = await store.getTenantBySlug(req.body.tenant);
      if (tenant) {
        logger.debug('Tenant resolved from body.tenant', { slug: tenant.slug });
        return tenant;
      }
    }

    const headerSlug = req.headers['x-tenant'];
    if (headerSlug) {
      const tenant = await store.getTenantBySlug(headerSlug);
      if (tenant) {
        logger.debug('Tenant resolved from X-Tenant header', { slug: tenant.slug });
        return tenant;
      }
    }

    return await store.getDefaultTenant();
  }

  async function resolveFromWhatsApp(phone) {
    if (!phone) return await store.getDefaultTenant();
    const tenant = await store.getTenantByPhone(phone);
    if (tenant) return tenant;
    return await store.getDefaultTenant();
  }

  async function resolveFromPhoneNumberId(phoneNumberId) {
    if (!phoneNumberId) return await store.getDefaultTenant();
    const tenant = await store.getTenantByPhoneNumberId(phoneNumberId);
    if (tenant) return tenant;
    return await store.getDefaultTenant();
  }

  async function resolveFromSlug(slug) {
    if (!slug) return await store.getDefaultTenant();
    const tenant = await store.getTenantBySlug(slug);
    if (tenant) return tenant;
    return await store.getDefaultTenant();
  }

  return { resolveFromRequest, resolveFromWhatsApp, resolveFromPhoneNumberId, resolveFromSlug };
}

module.exports = { createResolver };
