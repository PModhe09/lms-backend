import express from 'express';
import { env } from './config/env.ts';
import { createApp } from './create-app.ts';
import { connectMongo } from './infra/mongo.ts';
import { createStorage } from './infra/storage.ts';

/**
 * Vercel Functions entry: the platform imports the default-exported Express app.
 * The Mongo connection is opened once per function instance and reused across requests.
 */
let connecting: Promise<void> | undefined;
const ready = () =>
  (connecting ??= connectMongo(env.MONGO_URI).catch((err: unknown) => {
    connecting = undefined; // let the next request retry
    throw err;
  }));

const app = express();
app.use(async (_req, _res, next) => {
  await ready();
  next();
});
app.use(createApp({ storage: createStorage(env) }));

export default app;
