const { PLAN_FEATURES, getTenantFeatures, canUseFeature, getQuotaLimit } = require('../../src/domain/tenant-features');

describe('tenant-features', () => {
  describe('PLAN_FEATURES matrix', () => {
    test('starter has scheduling disabled', () => {
      expect(PLAN_FEATURES.starter.scheduling).toBe(false);
      expect(PLAN_FEATURES.starter.crm).toBe(false);
      expect(PLAN_FEATURES.starter.knowledgeBase).toBe(false);
    });

    test('business has scheduling and crm', () => {
      expect(PLAN_FEATURES.business.scheduling).toBe(true);
      expect(PLAN_FEATURES.business.crm).toBe(true);
      expect(PLAN_FEATURES.business.knowledgeBase).toBe(true);
    });

    test('pro has unlimited quotas', () => {
      expect(PLAN_FEATURES.pro.conversationsPerMonth).toBe(-1);
      expect(PLAN_FEATURES.pro.agents).toBe(-1);
    });

    test('enterprise has dedicated support', () => {
      expect(PLAN_FEATURES.enterprise.dedicatedSupport).toBe(true);
      expect(PLAN_FEATURES.enterprise.onboarding).toBe(true);
    });
  });

  describe('getTenantFeatures', () => {
    test('returns legacy features when no tenant (backward compat)', () => {
      const f = getTenantFeatures(null);
      expect(f.scheduling).toBe(false);
      expect(f.crm).toBe(true);
      expect(f.knowledgeBase).toBe(true);
    });

    test('returns plan features for valid tenant', () => {
      const tenant = { plan: 'business', features: {} };
      const f = getTenantFeatures(tenant);
      expect(f.agents).toBe(2);
      expect(f.conversationsPerMonth).toBe(500);
      expect(f.scheduling).toBe(true);
    });

    test('falls back to starter for unknown plan', () => {
      const tenant = { plan: 'unknown', features: {} };
      const f = getTenantFeatures(tenant);
      expect(f.agents).toBe(1);
    });

    test('overrides apply on top of base features', () => {
      const tenant = { plan: 'starter', features: { scheduling: true } };
      const f = getTenantFeatures(tenant);
      expect(f.scheduling).toBe(true);
      expect(f.crm).toBe(false);
    });
  });

  describe('canUseFeature', () => {
    test('business can schedule', () => {
      expect(canUseFeature({ plan: 'business' }, 'scheduling')).toBe(true);
    });

    test('starter cannot use crm', () => {
      expect(canUseFeature({ plan: 'starter' }, 'crm')).toBe(false);
    });
  });

  describe('getQuotaLimit', () => {
    test('starter has 100 conversations', () => {
      expect(getQuotaLimit({ plan: 'starter' }, 'conversations')).toBe(100);
    });

    test('business has 500 conversations', () => {
      expect(getQuotaLimit({ plan: 'business' }, 'conversations')).toBe(500);
    });

    test('pro is unlimited (-1)', () => {
      expect(getQuotaLimit({ plan: 'pro' }, 'conversations')).toBe(-1);
    });

    test('unknown metric defaults to -1', () => {
      expect(getQuotaLimit({ plan: 'starter' }, 'unknownMetric')).toBe(-1);
    });
  });
});
