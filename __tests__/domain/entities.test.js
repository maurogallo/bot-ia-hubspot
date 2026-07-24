const { Session, Message, Lead } = require('../../src/domain/entities');

describe('Session', () => {
  it('creates a session with given values', () => {
    const s = Session({ id: 'abc', channel: 'whatsapp', phone: '+5491112345678' });
    expect(s.id).toBe('abc');
    expect(s.channel).toBe('whatsapp');
    expect(s.phone).toBe('+5491112345678');
    expect(s.isActive).toBe(true);
  });

  it('generates UUID when id is not provided', () => {
    const s = Session({ channel: 'web' });
    expect(s.id).toBeDefined();
    expect(typeof s.id).toBe('string');
    expect(s.id.length).toBeGreaterThan(10);
  });

  it('uses empty context by default', () => {
    const s = Session({ channel: 'web' });
    expect(s.context).toEqual({});
  });

  it('is frozen (immutable)', () => {
    const s = Session({ channel: 'web' });
    s.channel = 'whatsapp';
    expect(s.channel).toBe('web');
    expect(Object.isFrozen(s)).toBe(true);
  });
});

describe('Message', () => {
  it('creates a message with given values', () => {
    const msg = Message({ sessionId: 's1', role: 'user', content: 'Hola' });
    expect(msg.sessionId).toBe('s1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hola');
    expect(msg.metadata).toEqual({});
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  it('generates UUID when id is not provided', () => {
    const msg = Message({ sessionId: 's1', role: 'assistant', content: 'test' });
    expect(msg.id).toBeDefined();
    expect(msg.id.length).toBeGreaterThan(10);
  });

  it('uses empty metadata by default', () => {
    const msg = Message({ sessionId: 's1', role: 'user', content: 'test' });
    expect(msg.metadata).toEqual({});
  });

  it('preserves provided metadata', () => {
    const meta = { intent: 'lead', confidence: 0.95 };
    const msg = Message({ sessionId: 's1', role: 'assistant', content: 'test', metadata: meta });
    expect(msg.metadata).toEqual(meta);
  });

  it('is frozen', () => {
    const msg = Message({ sessionId: 's1', role: 'user', content: 'Hola' });
    msg.content = 'Adios';
    expect(msg.content).toBe('Hola');
    expect(Object.isFrozen(msg)).toBe(true);
  });
});

describe('Lead', () => {
  it('creates a lead with all fields null by default', () => {
    const lead = Lead({});
    expect(lead.name).toBeNull();
    expect(lead.email).toBeNull();
    expect(lead.phone).toBeNull();
    expect(lead.serviceInterest).toBeNull();
  });

  it('creates a lead with provided values', () => {
    const lead = Lead({ name: 'Juan', email: 'juan@test.com', phone: '+54911', serviceInterest: 'web' });
    expect(lead.name).toBe('Juan');
    expect(lead.email).toBe('juan@test.com');
    expect(lead.phone).toBe('+54911');
    expect(lead.serviceInterest).toBe('web');
  });

  it('is frozen', () => {
    const lead = Lead({ name: 'Juan' });
    lead.name = 'Pedro';
    expect(lead.name).toBe('Juan');
    expect(Object.isFrozen(lead)).toBe(true);
  });
});
