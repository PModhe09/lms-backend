import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/infra/models/user.model.ts';
import { api } from './helpers.ts';

const creds = { email: 'Asha@Example.com', password: 'correct-horse' };

describe('POST /api/auth/signup', () => {
  it('creates a BORROWER, sets an httpOnly cookie, and never returns the hash', async () => {
    const res = await api().post('/api/auth/signup').send(creds).expect(201);

    expect(res.body).toMatchObject({
      email: 'asha@example.com',
      role: 'BORROWER',
      onboardingStage: 'REGISTERED',
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^lms_token=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('ignores a role in the body', async () => {
    const res = await api()
      .post('/api/auth/signup')
      .send({ ...creds, role: 'ADMIN' })
      .expect(201);

    expect(res.body.role).toBe('BORROWER');
    expect((await UserModel.findOne({ email: 'asha@example.com' }))?.role).toBe('BORROWER');
  });

  it('rejects a duplicate email with 409 regardless of case', async () => {
    await api().post('/api/auth/signup').send(creds).expect(201);
    const res = await api()
      .post('/api/auth/signup')
      .send({ ...creds, email: 'ASHA@example.com' })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects a short password with 400 and the error envelope', async () => {
    const res = await api().post('/api/auth/signup').send({ email: 'a@b.co', password: 'short' }).expect(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' }, requestId: expect.any(String) });
  });
});

describe('POST /api/auth/login', () => {
  it('logs in and /me returns the user', async () => {
    await api().post('/api/auth/signup').send(creds).expect(201);
    const login = await api().post('/api/auth/login').send(creds).expect(200);
    const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;

    const me = await api().get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ email: 'asha@example.com', role: 'BORROWER' });
  });

  it('returns the same 401 for an unknown email and a wrong password', async () => {
    await api().post('/api/auth/signup').send(creds).expect(201);
    const unknown = await api()
      .post('/api/auth/login')
      .send({ ...creds, email: 'nobody@example.com' })
      .expect(401);
    const wrong = await api()
      .post('/api/auth/login')
      .send({ ...creds, password: 'wrong-password' })
      .expect(401);

    expect(unknown.body.error).toEqual(wrong.body.error);
  });
});

describe('session', () => {
  it('/me without a cookie is 401', async () => {
    const res = await api().get('/api/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('/me with a tampered token is 401', async () => {
    await api().get('/api/auth/me').set('Cookie', 'lms_token=abc.def.ghi').expect(401);
  });

  it('logout clears the cookie', async () => {
    const res = await api().post('/api/auth/logout').expect(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(/lms_token=;.*Expires=Thu, 01 Jan 1970/);
  });
});

describe('platform', () => {
  it('healthz is 200 when Mongo is up', async () => {
    await api().get('/api/healthz').expect(200, { status: 'ok', mongo: true });
  });

  it('unknown route is a 404 envelope with a request id header', async () => {
    const res = await api().get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('malformed JSON is 400, not 500', async () => {
    const res = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
