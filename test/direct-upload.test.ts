import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/create-app.ts';
import { InMemoryStorage, type DirectUploadPolicy } from '../src/infra/storage.ts';
import { api, GOOD_PROFILE, newBorrower, PDF, PNG } from './helpers.ts';

/** In-memory store that also supports browser-to-storage uploads, like the Vercel Blob adapter. */
class DirectStorage extends InMemoryStorage {
  lastPolicy?: DirectUploadPolicy;
  directUpload = async (body: unknown, _req: unknown, policy: DirectUploadPolicy) => {
    this.lastPolicy = policy;
    policy.authorize((body as { payload: { pathname: string } }).payload.pathname);
    return { type: 'blob.generate-presigned-url', presignedUrlPayload: { url: 'memory://put' } };
  };
}
const storage = new DirectStorage();
const direct = () => request(createApp({ storage }));

async function eligibleBorrower(): Promise<{ cookie: string; id: string }> {
  const cookie = await newBorrower();
  await api()
    .put('/api/borrower/profile')
    .set('Cookie', cookie)
    .send({ ...GOOD_PROFILE, pan: `DRCTA${Math.floor(1000 + Math.random() * 8999)}Z` })
    .expect(200);
  const me = await api().get('/api/auth/me').set('Cookie', cookie);
  return { cookie, id: me.body.id };
}
const keyFor = (id: string, ext = 'pdf') => `slips/${id}/${randomUUID()}.${ext}`;
const presignBody = (pathname: string) => ({
  type: 'blob.generate-presigned-url',
  payload: { pathname, multipart: false, clientPayload: null },
});

describe('upload options', () => {
  it('server mode when storage cannot take browser uploads; presign then answers 409', async () => {
    const { cookie } = await eligibleBorrower();
    const opts = await api()
      .get('/api/borrower/salary-slip/upload-options')
      .set('Cookie', cookie)
      .expect(200);
    expect(opts.body).toMatchObject({ mode: 'server', maxBytes: 5 * 1024 * 1024 });
    const res = await api()
      .post('/api/borrower/salary-slip/presign')
      .set('Cookie', cookie)
      .send({})
      .expect(409);
    expect(res.body.error.code).toBe('DIRECT_UPLOAD_UNAVAILABLE');
  });

  it('direct mode advertises the caller’s own key prefix', async () => {
    const { cookie, id } = await eligibleBorrower();
    const opts = await direct()
      .get('/api/borrower/salary-slip/upload-options')
      .set('Cookie', cookie)
      .expect(200);
    expect(opts.body).toMatchObject({ mode: 'direct', keyPrefix: `slips/${id}/` });
  });
});

describe('presign', () => {
  it('issues a 5-minute, 5 MB, PDF/JPG/PNG-only URL for a path in the caller’s folder', async () => {
    const { cookie, id } = await eligibleBorrower();
    await direct()
      .post('/api/borrower/salary-slip/presign')
      .set('Cookie', cookie)
      .send(presignBody(keyFor(id)))
      .expect(200);
    expect(storage.lastPolicy).toMatchObject({
      maxBytes: 5 * 1024 * 1024,
      ttlSeconds: 300,
      contentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    });
  });

  it("refuses another user's folder and non-UUID names", async () => {
    const { cookie, id } = await eligibleBorrower();
    const other = await eligibleBorrower();
    for (const pathname of [
      keyFor(other.id),
      `slips/${id}/../../x.pdf`,
      `slips/${id}/slip.pdf`,
      keyFor(id, 'exe'),
    ]) {
      await direct()
        .post('/api/borrower/salary-slip/presign')
        .set('Cookie', cookie)
        .send(presignBody(pathname))
        .expect(422);
    }
  });

  it('refuses before eligibility has passed', async () => {
    const cookie = await newBorrower();
    const me = await api().get('/api/auth/me').set('Cookie', cookie);
    await direct()
      .post('/api/borrower/salary-slip/presign')
      .set('Cookie', cookie)
      .send(presignBody(keyFor(me.body.id)))
      .expect(409);
  });
});

describe('confirm', () => {
  it('records a stored file using its real type and size', async () => {
    const { cookie, id } = await eligibleBorrower();
    const key = keyFor(id); // named .pdf, but the bytes are a PNG
    await storage.put(key, PNG, 'application/pdf');
    const res = await direct()
      .post('/api/borrower/salary-slip/confirm')
      .set('Cookie', cookie)
      .send({ key, originalName: 'payslip-oct.pdf' })
      .expect(200);
    expect(res.body).toMatchObject({
      onboardingStage: 'SLIP_UPLOADED',
      salarySlip: { mime: 'image/png', size: PNG.length, originalName: 'payslip-oct.pdf' },
    });
  });

  it('deletes and refuses a file that is not PDF/JPG/PNG', async () => {
    const { cookie, id } = await eligibleBorrower();
    const key = keyFor(id);
    await storage.put(key, Buffer.from('MZ not a pdf'), 'application/pdf');
    const res = await direct()
      .post('/api/borrower/salary-slip/confirm')
      .set('Cookie', cookie)
      .send({ key })
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_FILE');
    expect(storage.objects.has(key)).toBe(false);
  });

  it('deletes and refuses a file over 5 MB', async () => {
    const { cookie, id } = await eligibleBorrower();
    const key = keyFor(id);
    await storage.put(key, Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'application/pdf');
    await direct().post('/api/borrower/salary-slip/confirm').set('Cookie', cookie).send({ key }).expect(422);
    expect(storage.objects.has(key)).toBe(false);
  });

  it("404 for a missing upload or another user's key", async () => {
    const { cookie, id } = await eligibleBorrower();
    const other = await eligibleBorrower();
    const theirs = keyFor(other.id);
    await storage.put(theirs, PDF, 'application/pdf');
    await direct()
      .post('/api/borrower/salary-slip/confirm')
      .set('Cookie', cookie)
      .send({ key: keyFor(id) })
      .expect(404);
    await direct()
      .post('/api/borrower/salary-slip/confirm')
      .set('Cookie', cookie)
      .send({ key: theirs })
      .expect(404);
    expect(storage.objects.has(theirs)).toBe(true);
  });

  it('a confirmed slip lets the borrower apply', async () => {
    const { cookie, id } = await eligibleBorrower();
    const key = keyFor(id);
    await storage.put(key, PDF, 'application/pdf');
    await direct().post('/api/borrower/salary-slip/confirm').set('Cookie', cookie).send({ key }).expect(200);
    await direct()
      .post('/api/borrower/loans')
      .set('Cookie', cookie)
      .send({ principalPaise: 5_000_000, tenureDays: 30 })
      .expect(201);
  });
});
