const crypto = require('crypto');

function Session({ id, channel, phone, context = {} }) {
  if (!id) id = crypto.randomUUID();
  return Object.freeze({ id, channel, phone: phone || null, context, isActive: true });
}

function Message({ id, sessionId, role, content, metadata = {} }) {
  if (!id) id = crypto.randomUUID();
  return Object.freeze({ id, sessionId, role, content, metadata, createdAt: new Date() });
}

function Lead({ name = null, email = null, phone = null, serviceInterest = null }) {
  return Object.freeze({ name, email, phone, serviceInterest });
}

module.exports = { Session, Message, Lead };
