import mongoose from 'mongoose';
import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { connectMongo } from './infra/mongo.ts';
import { logger } from './lib/logger.ts';

async function main() {
  await connectMongo(env.MONGO_URI);
  const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT }, 'api listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void mongoose.disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
