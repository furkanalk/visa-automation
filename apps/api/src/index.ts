import { createApp } from './app.js';
import { closeDb } from '@visa-automation/db';
import { closeQueue } from './queue/producer.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const app = await createApp();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    
    await app.close();
    await closeQueue();
    await closeDb();
    
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`API server listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
