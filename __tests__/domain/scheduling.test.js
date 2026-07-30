const { handleMessage, proposeTimeSlots } = require('../../src/domain/use-cases');
const { createMockStore } = require('../mocks/store');
const { createMockAI } = require('../mocks/ai');
const { createMockCRM } = require('../mocks/crm');

function createMockCalendar(overrides = {}) {
  return {
    getAvailability: jest.fn(async () => ({
      date: '2026-08-02',
      timezone: 'America/Argentina/Buenos_Aires',
      slots: [
        { label: '10:00 AM', value: '2026-08-02T10:00:00', start: '2026-08-02T13:00:00.000Z', end: '2026-08-02T13:30:00.000Z' },
        { label: '10:30 AM', value: '2026-08-02T10:30:00', start: '2026-08-02T13:30:00.000Z', end: '2026-08-02T14:00:00.000Z' },
        { label: '14:00 PM', value: '2026-08-02T14:00:00', start: '2026-08-02T17:00:00.000Z', end: '2026-08-02T17:30:00.000Z' },
      ],
    })),
    bookAppointment: jest.fn(async () => ({
      id: 'event-123',
      htmlLink: 'https://calendar.google.com/event',
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      start: '2026-08-02T14:00:00-03:00',
      end: '2026-08-02T14:30:00-03:00',
    })),
    ...overrides,
  };
}

describe('proposeTimeSlots', () => {
  test('formats slots with letters', () => {
    const slots = [
      { label: '10:00 AM' }, { label: '14:00 PM' }, { label: '16:00 PM' },
    ];
    const result = proposeTimeSlots(slots);
    expect(result).toContain('A) 10:00 AM');
    expect(result).toContain('B) 14:00 PM');
    expect(result).toContain('C) 16:00 PM');
  });

  test('limits to 6 slots', () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({ label: `${i}:00` }));
    const result = proposeTimeSlots(slots);
    const letterLines = result.split('\n').filter(l => /^[A-F]\)/.test(l));
    expect(letterLines.length).toBe(6);
  });

  test('no slots message', () => {
    const result = proposeTimeSlots([]);
    expect(result).toContain('no tengo horarios disponibles');
  });

  test('null slots message', () => {
    const result = proposeTimeSlots(null);
    expect(result).toContain('no tengo horarios disponibles');
  });
});

describe('handleScheduling', () => {
  function setup() {
    const store = createMockStore();
    store.getMemory = jest.fn(async () => ({
      contact_name: 'Juan', contact_email: 'juan@test.com', contact_phone: '+54911111',
    }));
    store.getAppointmentsByEmail = jest.fn(async () => []);
    store.saveAppointment = jest.fn(async (data) => ({ id: 'appt-1', ...data }));
    store.cancelAppointment = jest.fn(async () => {});

    const ai = createMockAI();
    const crm = createMockCRM();
    const calendar = createMockCalendar();
    const tenant = { id: 'tenant-1', slug: 'test', plan: 'business' };
    const tenantId = 'tenant-1';

    return { store, ai, crm, calendar, tenant, tenantId };
  }

  test('request_availability returns formatted slots', async () => {
    const { store, ai, crm, calendar, tenant, tenantId } = setup();

    const result = await handleMessage({
      message: 'Quiero agendar una reunion',
      from: '+54911111', channel: 'web',
      store, ai, crm, calendar, tenant,
    });

    expect(result.response).toBeDefined();
    expect(result.handoffNeeded).toBe(false);
  });

  test('confirm_slot books appointment and saves to store', async () => {
    const { store, ai, calendar, crm, tenant } = setup();

    ai.generateResponse = jest.fn(async () => ({
      response: 'Perfecto, confirmamos para el lunes.',
      leadData: {
        intent: 'schedule',
        detected_service: 'web_development',
        lead: { name: 'Juan', email: 'juan@test.com', phone: '+54911111', service_interest: 'Desarrollo Web' },
        scheduling: { action: 'confirm_slot', preferred_date: '2026-08-02', preferred_time: '14:00' },
        confidence: 0.9,
      },
    }));

    const result = await handleMessage({
      message: 'Confirmo el lunes a las 14hs',
      from: '+54911111', channel: 'web',
      store, ai, crm, calendar, tenant,
    });

    expect(calendar.bookAppointment).toHaveBeenCalled();
    expect(store.saveAppointment).toHaveBeenCalled();
    expect(result.response).toContain('invitacion');
    expect(result.handoffNeeded).toBe(false);
  });

  test('does not schedule without email', async () => {
    const { store, ai, calendar, crm, tenant } = setup();

    store.getMemory = jest.fn(async () => ({}));
    store.upsertMemory = jest.fn(async () => {});

    ai.generateResponse = jest.fn(async () => ({
      response: 'Quiero agendar',
      leadData: {
        intent: 'schedule',
        lead: { name: null, email: null, phone: null },
        scheduling: { action: 'confirm_slot', preferred_date: '2026-08-02', preferred_time: '14:00' },
        confidence: 0.9,
      },
    }));

    const result = await handleMessage({
      message: 'Agendame',
      from: '+54911111', channel: 'web',
      store, ai, crm, calendar, tenant,
    });

    expect(calendar.bookAppointment).not.toHaveBeenCalled();
    expect(result.response).toContain('email');
  });

  test('handles calendar availability error gracefully', async () => {
    const { store, ai, calendar, crm, tenant } = setup();

    calendar.getAvailability = jest.fn(async () => { throw new Error('API error'); });

    ai.generateResponse = jest.fn(async () => ({
      response: 'Agendame',
      leadData: {
        intent: 'schedule',
        lead: { name: 'Juan', email: 'juan@test.com' },
        scheduling: { action: 'request_availability', preferred_date: '2026-08-02' },
        confidence: 0.9,
      },
    }));

    const result = await handleMessage({
      message: 'Agendame',
      from: '+54911111', channel: 'web',
      store, ai, crm, calendar, tenant,
    });

    expect(result.response).toContain('problema');
  });

  test('starter tenant can schedule', async () => {
    const { store, ai, calendar, crm } = setup();
    const starterTenant = { id: 't2', slug: 'starter-tenant', plan: 'starter' };

    ai.generateResponse = jest.fn(async () => ({
      response: 'Quiero agendar',
      leadData: {
        intent: 'schedule',
        lead: { name: 'Juan', email: 'juan@test.com' },
        scheduling: { action: 'request_availability' },
        confidence: 0.9,
      },
    }));

    const result = await handleMessage({
      message: 'Agendame',
      from: '+54911111', channel: 'web',
      store, ai, crm, calendar, tenant: starterTenant,
    });

    expect(calendar.getAvailability).toHaveBeenCalled();
    expect(result.response).toBeDefined();
  });
});
