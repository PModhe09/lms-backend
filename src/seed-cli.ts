import mongoose from 'mongoose';
import { env } from './config/env.ts';
import { connectMongo } from './infra/mongo.ts';
import { logger } from './lib/logger.ts';
import { SEED_USERS, seedUsers } from './seed.ts';

await connectMongo(env.MONGO_URI);
await seedUsers();
logger.info({ users: SEED_USERS.map((u) => u.email) }, 'seed complete');
await mongoose.disconnect();
