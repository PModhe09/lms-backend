import mongoose from 'mongoose';

export async function connectMongo(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  // Indexes are part of correctness here (unique email/UTR, one open loan), so build them before serving.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function pingMongo(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  try {
    await db.admin().ping();
    return true;
  } catch {
    return false;
  }
}

/** Mongo duplicate-key error (E11000). `keyPattern` tells which unique index fired. */
export function isDuplicateKeyError(
  err: unknown,
): err is { code: 11000; keyPattern?: Record<string, number> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}
