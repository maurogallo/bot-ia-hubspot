/**
 * ConversationStore port
 *
 * getOrCreateSession(channel, contactId, phone) → session
 * addMessage(sessionId, role, content, metadata) → message
 * getConversationHistory(sessionId, limit) → messages[]
 * updateSessionContext(sessionId, context) → void
 * saveContact(data) → contact
 * upsertMemory(sessionId, key, value) → void
 * getMemory(sessionId) → object
 *
 * Knowledge / RAG:
 * getKnowledgeCount() → number
 * addKnowledge(content, metadata, embedding) → row
 * searchKnowledge(embedding, limit) → [{ content, metadata, similarity }]
 * getAllKnowledge() → rows[]
 * deleteKnowledge(id) → void
 */
