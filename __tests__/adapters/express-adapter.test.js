const { createApp } = require('../../src/adapters/inbound/express-adapter');
const { createMockStore } = require('../mocks/store');
const { createMockAI } = require('../mocks/ai');
const { createMockCRM } = require('../mocks/crm');

beforeEach(() => {
  delete process.env.DASHBOARD_USERNAME;
  delete process.env.DASHBOARD_PASSWORD;
});

function createDeps(overrides = {}) {
  const store = overrides.store || createMockStore();
  const ai = overrides.ai || createMockAI();
  const crm = overrides.crm || createMockCRM();
  return {
    store,
    ai,
    crm,
    handleMessage: jest.fn(async ({ message, from, channel }) => ({
      response: 'Respuesta de prueba',
      handoffNeeded: false,
    })),
    getQrCode: jest.fn(() => 'qr-data-string'),
    billing: {
      createPaymentSession: jest.fn(async () => ({ transactionId: 'tx-1', reference: 'ref-1', status: 'PENDING', redirectUrl: 'https://pay.example/1' })),
      getFinancialInstitutions: jest.fn(async () => [{ code: '1', name: 'Bancolombia' }]),
      verifyWebhookSignature: jest.fn(() => true),
      handleTransactionUpdated: jest.fn(async () => ({ handled: true })),
    },
  };
}

describe('Express adapter', () => {
  describe('GET /health', () => {
    it('returns health status', async () => {
      const app = createApp(createDeps());
      const res = await app.inject ? null : null;
      const http = require('http');
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.ollama.available).toBe(true);

      server.close();
    });
  });

  describe('GET /api/status', () => {
    it('returns service info', async () => {
      const app = createApp(createDeps());
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/status`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.service).toBeDefined();
      expect(data.environment).toBeDefined();

      server.close();
    });
  });

  describe('POST /api/webhook', () => {
    it('rejects requests without message', async () => {
      const app = createApp(createDeps());
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'test' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('message');

      server.close();
    });

    it('rejects requests without from', async () => {
      const app = createApp(createDeps());
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hola' }),
      });

      expect(response.status).toBe(400);

      server.close();
    });

    it('processes valid webhook messages', async () => {
      const deps = createDeps();
      const app = createApp(deps);
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hola', from: 'test-user' }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.reply).toBe('Respuesta de prueba');
      expect(deps.handleMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Hola', from: 'test-user', channel: 'web' })
      );

      server.close();
    });

    it('rejects messages longer than 4000 chars', async () => {
      const app = createApp(createDeps());
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x'.repeat(4001), from: 'test' }),
      });

      expect(response.status).toBe(400);

      server.close();
    });
  });

  describe('GET /whatsapp/qr', () => {
    it('returns QR code as JSON', async () => {
      const deps = createDeps();
      const app = createApp(deps);
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/whatsapp/qr`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.qr).toBe('qr-data-string');

      server.close();
    });

    it('returns 404 when QR not available', async () => {
      const deps = createDeps();
      deps.getQrCode = () => null;
      const app = createApp(deps);
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/whatsapp/qr`);

      expect(response.status).toBe(404);

      server.close();
    });
  });

  describe('GET /api/knowledge', () => {
    it('lists knowledge documents', async () => {
      const deps = createDeps();
      const app = createApp(deps);
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/knowledge`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);

      server.close();
    });
  });

  describe('Billing endpoints', () => {
    it('GET /api/billing/institutions returns institutions', async () => {
      const app = createApp(createDeps());
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/billing/institutions`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);

      server.close();
    });

    it('POST /api/billing/checkout creates a payment session', async () => {
      const deps = createDeps();
      delete process.env.DASHBOARD_USERNAME;
      const app = createApp(deps);
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'test', plan: 'pro' }),
      });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.redirectUrl).toContain('https://pay.example');

      server.close();
    });

    it('POST /api/wompi-webhook responds 200 and processes transaction', async () => {
      const deps = createDeps();
      const app = createApp(deps);
      const server = app.listen(0);
      const { port } = server.address();

      const event = {
        event: 'transaction.updated',
        data: { transaction: { id: 'tx-1', status: 'APPROVED', reference: 'ref-1', amount_in_cents: 1000 } },
        signature: { properties: [], checksum: 'x' },
        timestamp: 1000,
      };

      const response = await fetch(`http://localhost:${port}/api/wompi-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });

      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(deps.billing.verifyWebhookSignature).toHaveBeenCalled();
      expect(deps.billing.handleTransactionUpdated).toHaveBeenCalled();

      server.close();
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const app = createApp(createDeps());
      const server = app.listen(0);
      const { port } = server.address();

      const response = await fetch(`http://localhost:${port}/nonexistent`);

      expect(response.status).toBe(404);

      server.close();
    });
  });

  describe('Dashboard static assets', () => {
    it('serves the dashboard skeleton and modular assets', async () => {
      const app = createApp(createDeps());
      const server = app.listen(0);
      const { port } = server.address();
      const base = `http://localhost:${port}`;

      const html = await fetch(`${base}/dashboard`);
      expect(html.status).toBe(200);
      const htmlText = await html.text();
      expect(htmlText).toContain('/dashboard/styles.css');
      expect(htmlText).toContain('/dashboard/js/main.js');

      const css = await fetch(`${base}/dashboard/styles.css`);
      expect(css.status).toBe(200);
      expect(css.headers.get('content-type')).toContain('text/css');

      const js = await fetch(`${base}/dashboard/js/main.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toContain('javascript');

      const view = await fetch(`${base}/dashboard/js/views/clients.js`);
      expect(view.status).toBe(200);

      server.close();
    });
  });
});
