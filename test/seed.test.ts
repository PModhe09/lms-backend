import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/infra/models/user.model.ts';
import { SEED_USERS, seedUsers } from '../src/seed.ts';
import { api } from './helpers.ts';

describe('seedUsers', () => {
  it('is idempotent and every seeded user can log in with its role', async () => {
    await seedUsers();
    await seedUsers();
    expect(await UserModel.countDocuments()).toBe(SEED_USERS.length);

    for (const { email, password, role } of SEED_USERS) {
      const res = await api().post('/api/auth/login').send({ email, password }).expect(200);
      expect(res.body.role).toBe(role);
    }
  });
});
