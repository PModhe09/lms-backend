import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `fn` in a Mongo transaction. The driver retries the whole callback on transient errors
 * (e.g. WriteConflict when two requests update the same loan), so `fn` must re-read what it checks.
 */
export function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(fn);
}
