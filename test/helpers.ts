import request from 'supertest';
import { createApp } from '../src/app.ts';
import { InMemoryStorage } from '../src/infra/storage.ts';
import type { Role } from '../src/domain/enums.ts';
import { signSession, SESSION_COOKIE } from '../src/lib/session.ts';

export const storage = new InMemoryStorage();
export const app = createApp({ storage });
export const api = () => request(app);

/** Cookie header for a session, without going through login. */
export const sessionCookie = (role: Role, id = '000000000000000000000001') =>
  `${SESSION_COOKIE}=${signSession({ id, role })}`;

export const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024, 0x20)]);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(512),
]);

export const GOOD_PROFILE = {
  fullName: 'Asha Rao',
  pan: 'ABCDE1234F',
  dob: '1995-06-15',
  monthlySalaryPaise: 5_000_000,
  employmentMode: 'SALARIED',
};

let counter = 0;

/** Signs up a fresh borrower and returns their cookie. */
export async function newBorrower(): Promise<string> {
  counter += 1;
  const res = await api()
    .post('/api/auth/signup')
    .send({ email: `borrower${counter}-${Date.now()}@example.com`, password: 'password123' })
    .expect(201);
  return res.headers['set-cookie']![0]!.split(';')[0]!;
}

const uniquePan = () => `ABCDE${String(1000 + (counter % 9000)).padStart(4, '0')}F`;

export async function borrowerReadyToApply(): Promise<string> {
  const cookie = await newBorrower();
  await api()
    .put('/api/borrower/profile')
    .set('Cookie', cookie)
    .send({ ...GOOD_PROFILE, pan: uniquePan() })
    .expect(200);
  await api()
    .post('/api/borrower/salary-slip')
    .set('Cookie', cookie)
    .attach('file', PDF, 'slip.pdf')
    .expect(200);
  return cookie;
}

export async function appliedLoan(body = { principalPaise: 5_000_000, tenureDays: 30 }) {
  const cookie = await borrowerReadyToApply();
  const res = await api().post('/api/borrower/loans').set('Cookie', cookie).send(body).expect(201);
  return { cookie, loanId: res.body.id as string, loan: res.body };
}

export const ADMIN = () => sessionCookie('ADMIN', '0000000000000000000000a1');
export const SANCTION = () => sessionCookie('SANCTION', '0000000000000000000000a2');
export const DISBURSEMENT = () => sessionCookie('DISBURSEMENT', '0000000000000000000000a3');
export const COLLECTION = () => sessionCookie('COLLECTION', '0000000000000000000000a4');
export const SALES = () => sessionCookie('SALES', '0000000000000000000000a5');

export async function disbursedLoan(body?: { principalPaise: number; tenureDays: number }) {
  const applied = await appliedLoan(body);
  await api().post(`/api/ops/sanction/loans/${applied.loanId}/approve`).set('Cookie', SANCTION()).expect(200);
  await api()
    .post(`/api/ops/disbursement/loans/${applied.loanId}/disburse`)
    .set('Cookie', DISBURSEMENT())
    .expect(200);
  return applied;
}

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
