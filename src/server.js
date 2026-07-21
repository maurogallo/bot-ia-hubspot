const app = require('./app');
const logger = require('./logger');
const config = require('./config');
const database = require('./database');
const whatsapp = require('./whatsapp');

let server;
let whatsappClient;

async function start() {
  logger.info('Starting bot server...', {
    environment: config.nodeEnv,
    port: config.port,
    ollamaModel: config.ollama.model,
  });

  try {
    await database.migrate();
    logger.info('Database connected and migrated');
  } catch (error) {
    logger.error('Failed to connect to database', { error: error.message });
    process.exit(1);
  }

  try {
    whatsappClient = whatsapp.initialize();
    logger.info('WhatsApp client initializing...');
  } catch (error) {
    logger.error('Failed to initialize WhatsApp client', { error: error.message });
  }

  server = app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`);
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');

      if (whatsappClient) {
        try {
          await whatsappClient.destroy();
          logger.info('WhatsApp client destroyed');
        } catch { /* ignore */ }
      }

      try {
        await database.pool.end();
        logger.info('Database pool closed');
      } catch { /* ignore */ }

      logger.info('Graceful shutdown completed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

start();
