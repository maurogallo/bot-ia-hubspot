const logger = require('./logger');
const config = require('./config');
const { app, store, whatsapp } = require('./app');

let server;

async function start() {
  logger.info('Starting server...', {
    environment: config.nodeEnv,
    port: config.port,
    ollamaModel: config.ollama.model,
  });

  try {
    await store.migrate();
    logger.info('Database migrated');
  } catch (error) {
    logger.error('Database connection failed', { error: error.message });
    process.exit(1);
  }

  server = app.listen(config.port, () => {
    logger.info(`Listening on http://localhost:${config.port}`);
    logger.info('WhatsApp client initializing...');
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received. Shutting down...`);
  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      if (whatsapp.getClient()) {
        try { await whatsapp.getClient().destroy(); logger.info('WhatsApp destroyed'); } catch { /* ignore */ }
      }
      try { await store.pool.end(); logger.info('DB pool closed'); } catch { /* ignore */ }
      logger.info('Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => { logger.error('Forced shutdown'); process.exit(1); }, 30000);
  } else process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

start();
