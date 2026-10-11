import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/** One in-memory replica set for the whole run. Replica set, not standalone, because payments use transactions. */
export default async function setup(project: TestProject) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
