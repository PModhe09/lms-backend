import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long', // gitleaks:allow (test-only value)
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  // A fresh database per test file, on the shared replica set.
  MONGO_URI: inject('mongoUri').replace(/\/(\?|$)/, `/lms-test-${randomUUID()}$1`),
});

beforeAll(async () => {
  const { connectMongo } = await import('../src/infra/mongo.ts');
  // Register every model before syncing indexes.
  await import('../src/app.ts');
  await connectMongo(process.env.MONGO_URI!);
});

beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
