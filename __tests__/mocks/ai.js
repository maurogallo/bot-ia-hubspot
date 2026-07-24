function createMockAI() {
  return {
    generateResponse: jest.fn(async (sessionId, history, memory, knowledgeDocs) => {
      return {
        response: 'Gracias por tu consulta. ¿Te gustaría saber más sobre nuestros servicios?',
        leadData: {
          intent: 'unknown',
          confidence: 0,
          lead: {},
        },
      };
    }),

    generateEmbedding: jest.fn(async (text) => {
      return new Array(768).fill(0).map((_, i) => (i % 100) / 100);
    }),

    checkHealth: jest.fn(async () => ({
      available: true,
      modelAvailable: true,
      models: ['llama3.2:3b', 'nomic-embed-text'],
    })),
  };
}

module.exports = { createMockAI };
