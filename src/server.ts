import mongoose from 'mongoose';
import { createApp } from './create-app.ts';
import { env } from './config/env.ts';
import { connectMongo } from './infra/mongo.ts';
import { createStorage } from './infra/storage.ts';
import { logger } from './lib/logger.ts';

/** Long-running process entry (Docker, `npm start`). Vercel uses src/index.ts instead. */
async function main() {
  await connectMongo(env.MONGO_URI);
  const storage = createStorage(env);
  if (env.S3_AUTO_CREATE_BUCKET) await storage.ensureBucket?.();

  const server = createApp({ storage }).listen(env.PORT, () =>
    logger.info({ port: env.PORT }, 'api listening'),
  );

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
