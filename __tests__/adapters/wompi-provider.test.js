const { createProvider } = require('../../src/adapters/outbound/wompi-provider');

describe('Wompi provider', () => {
  const config = {
    publicKey: 'pub_test_xxx',
    privateKey: 'priv_test_xxx',
    eventsSecret: 'prod_events_testsecret',
    environment: 'sandbox',
  };

  describe('verifyWebhookSignature', () => {
    it('returns false when events secret is missing', () => {
      const provider = createProvider({ ...config, eventsSecret: '' });
      expect(provider.verifyWebhookSignature({}, null)).toBe(false);
    });

    it('returns false when checksum is missing', () => {
      const provider = createProvider(config);
      expect(provider.verifyWebhookSignature({ event: 'transaction.updated' }, null)).toBe(false);
    });

    it('verifies a valid event checksum', () => {
      const crypto = require('crypto');
      const provider = createProvider(config);
      const transaction = {
        id: '1234-1610641025-49201',
        status: 'APPROVED',
        amount_in_cents: 4490000,
      };
      const event = {
        event: 'transaction.updated',
        data: { transaction },
        signature: {
          properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
          checksum: '',
        },
        timestamp: 1530291411,
      };
      const concat = `${transaction.id}${transaction.status}${transaction.amount_in_cents}${event.timestamp}${config.eventsSecret}`;
      event.signature.checksum = crypto.createHash('sha256').update(concat).digest('hex');

      expect(provider.verifyWebhookSignature(event, null)).toBe(true);
    });

    it('rejects a tampered event', () => {
      const crypto = require('crypto');
      const provider = createProvider(config);
      const transaction = { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000 };
      const event = {
        event: 'transaction.updated',
        data: { transaction },
        signature: {
          properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
          checksum: '',
        },
        timestamp: 1530291411,
      };
      const concat = `${transaction.id}DECLINED${transaction.amount_in_cents}${event.timestamp}${config.eventsSecret}`;
      event.signature.checksum = crypto.createHash('sha256').update(concat).digest('hex');

      expect(provider.verifyWebhookSignature(event, null)).toBe(false);
    });
  });

  describe('isConfigured', () => {
    it('is false without keys', () => {
      const provider = createProvider({ publicKey: '', privateKey: '', eventsSecret: '' });
      expect(provider.isConfigured()).toBe(false);
    });

    it('is true with keys', () => {
      const provider = createProvider(config);
      expect(provider.isConfigured()).toBe(true);
    });
  });
});
