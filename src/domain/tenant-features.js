const PLAN_FEATURES = {
  starter: {
    agents: 1,
    conversationsPerMonth: 100,
    scheduling: false,
    crm: false,
    knowledgeBase: false,
    whiteLabel: true,
    api: false,
    analytics: false,
    dedicatedSupport: false,
    onboarding: false,
  },
  business: {
    agents: 2,
    conversationsPerMonth: 500,
    scheduling: true,
    crm: true,
    knowledgeBase: true,
    whiteLabel: true,
    api: false,
    analytics: false,
    dedicatedSupport: false,
    onboarding: false,
  },
  pro: {
    agents: -1,
    conversationsPerMonth: -1,
    scheduling: true,
    crm: true,
    knowledgeBase: true,
    whiteLabel: true,
    api: true,
    analytics: true,
    dedicatedSupport: false,
    onboarding: false,
  },
  enterprise: {
    agents: -1,
    conversationsPerMonth: -1,
    scheduling: true,
    crm: true,
    knowledgeBase: true,
    whiteLabel: true,
    api: true,
    analytics: true,
    dedicatedSupport: true,
    onboarding: true,
  },
};

const LEGACY_FEATURES = {
  agents: -1,
  conversationsPerMonth: -1,
  scheduling: false,
  crm: true,
  knowledgeBase: true,
  whiteLabel: true,
  api: false,
  analytics: false,
  dedicatedSupport: false,
  onboarding: false,
};

function getTenantFeatures(tenant) {
  if (!tenant) return { ...LEGACY_FEATURES };
  const baseFeatures = PLAN_FEATURES[tenant.plan] || PLAN_FEATURES.starter;
  const overrides = tenant.features || {};
  return { ...baseFeatures, ...overrides };
}

function canUseFeature(tenant, feature) {
  const features = getTenantFeatures(tenant);
  return features[feature] === true;
}

function getQuotaLimit(tenant, metric) {
  const features = getTenantFeatures(tenant);
  const key = `${metric}PerMonth`;
  return features[key] !== undefined ? features[key] : -1;
}

module.exports = { PLAN_FEATURES, getTenantFeatures, canUseFeature, getQuotaLimit };
