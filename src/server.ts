import mongoose from 'mongoose';
import { createApp } from './create-app.ts';
import { env } from './config/env.ts';
import { connectMongo } from './infra/mongo.ts';
import { createStorage } from './infra/storage.ts';
import { logger } from './lib/logger.ts';

/** Long-running process entry (Docker, `npm start`). Vercel uses src/index.ts instead. */
/** Local storage can report healthy a moment before its S3 port accepts connections. */
async function retry(fn: () => Promise<void>, what: string, attempts = 10, delayMs = 2000): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn({ err, attempt: i }, `${what} not ready, retrying`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  await connectMongo(env.MONGO_URI);
  const storage = createStorage(env);
  if (env.S3_AUTO_CREATE_BUCKET) await retry(() => storage.ensureBucket?.() ?? Promise.resolve(), 'storage');

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
