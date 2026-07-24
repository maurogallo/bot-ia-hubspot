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
});
