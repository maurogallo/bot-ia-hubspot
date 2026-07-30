/**
 * AIProvider port
 *
 * generateResponse(sessionId, conversationHistory, memory, knowledgeDocs, tenant) → { response, leadData }
 *   leadData: { intent, detected_service, lead: { name, email, phone, service_interest },
 *               scheduling: { action, preferred_date, preferred_time }, confidence }
 * generateEmbedding(text) → [number]
 * checkHealth() → { available, modelAvailable, models }
 */
