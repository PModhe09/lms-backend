import { describe, expect, it } from 'vitest';
import {
  ADMIN,
  api,
  appliedLoan,
  COLLECTION,
  disbursedLoan,
  DISBURSEMENT,
  newBorrower,
  SALES,
  SANCTION,
  today,
} from './helpers.ts';

describe('sanction', () => {
  it('lists APPLIED loans with the borrower, and approves', async () => {
    const { loanId } = await appliedLoan();
    const queue = await api().get('/api/ops/sanction/loans').set('Cookie', SANCTION()).expect(200);
    expect(queue.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(queue.body.items[0]).toMatchObject({ id: loanId, borrower: { fullName: 'Asha Rao' } });

    const res = await api()
      .post(`/api/ops/sanction/loans/${loanId}/approve`)
      .set('Cookie', SANCTION())
      .expect(200);
    expect(res.body.status).toBe('SANCTIONED');
    expect(res.body.statusHistory.map((h: { to: string }) => h.to)).toEqual(['APPLIED', 'SANCTIONED']);
  });

  it('second decision on the same loan is 409', async () => {
    const { loanId } = await appliedLoan();
    await api().post(`/api/ops/sanction/loans/${loanId}/approve`).set('Cookie', SANCTION()).expect(200);
    const res = await api()
      .post(`/api/ops/sanction/loans/${loanId}/reject`)
      .set('Cookie', SANCTION())
      .send({ reason: 'late' })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('concurrent approve and reject: exactly one wins', async () => {
    const { loanId } = await appliedLoan();
    const [a, b] = await Promise.all([
      api().post(`/api/ops/sanction/loans/${loanId}/approve`).set('Cookie', SANCTION()),
      api().post(`/api/ops/sanction/loans/${loanId}/reject`).set('Cookie', ADMIN()).send({ reason: 'x' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('reject needs a reason, records it, and lets the borrower reapply', async () => {
    const { loanId, cookie } = await appliedLoan();
    await api()
      .post(`/api/ops/sanction/loans/${loanId}/reject`)
      .set('Cookie', SANCTION())
      .send({})
      .expect(400);
    const res = await api()
      .post(`/api/ops/sanction/loans/${loanId}/reject`)
      .set('Cookie', SANCTION())
      .send({ reason: 'Salary slip unreadable' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Salary slip unreadable' });

    expect((await api().get('/api/borrower/profile').set('Cookie', cookie)).body.onboardingStage).toBe(
      'SLIP_UPLOADED',
    );
    await api()
      .post('/api/borrower/loans')
      .set('Cookie', cookie)
      .send({ principalPaise: 6_000_000, tenureDays: 60 })
      .expect(201);
  });

  it('serves a presigned slip URL', async () => {
    const { loanId } = await appliedLoan();
    const res = await api()
      .get(`/api/ops/sanction/loans/${loanId}/salary-slip`)
      .set('Cookie', SANCTION())
      .expect(200);
    expect(res.body).toMatchObject({
      url: expect.stringMatching(/^memory:\/\/slips\//),
      expiresInSeconds: 300,
    });
  });

  it('unknown loan is 404', async () => {
    await api()
      .post('/api/ops/sanction/loans/0123456789abcdef01234567/approve')
      .set('Cookie', SANCTION())
      .expect(404);
  });
});

describe('disbursement', () => {
  it('disburses a sanctioned loan; refuses an APPLIED one', async () => {
    const { loanId } = await appliedLoan();
    await api()
      .post(`/api/ops/disbursement/loans/${loanId}/disburse`)
      .set('Cookie', DISBURSEMENT())
      .expect(409);
    await api().post(`/api/ops/sanction/loans/${loanId}/approve`).set('Cookie', SANCTION()).expect(200);
    const queue = await api().get('/api/ops/disbursement/loans').set('Cookie', DISBURSEMENT()).expect(200);
    expect(queue.body.items.map((l: { id: string }) => l.id)).toEqual([loanId]);
    const res = await api()
      .post(`/api/ops/disbursement/loans/${loanId}/disburse`)
      .set('Cookie', DISBURSEMENT())
      .expect(200);
    expect(res.body).toMatchObject({ status: 'DISBURSED', disbursedAt: expect.any(String) });
  });
});

describe('collection', () => {
  const pay = (loanId: string, body: object) =>
    api().post(`/api/ops/collection/loans/${loanId}/payments`).set('Cookie', COLLECTION()).send(body);

  it('partial then final payment closes the loan and frees the borrower', async () => {
    // ₹50,000 for 73 days → interest ₹1,200 exactly → total 5,120,000 paise
    const { loanId, cookie } = await disbursedLoan({ principalPaise: 5_000_000, tenureDays: 73 });
    const first = await pay(loanId, { utr: 'UTR000001', amountPaise: 2_000_000, paidAt: today() }).expect(
      201,
    );
    expect(first.body.loan).toMatchObject({
      status: 'DISBURSED',
      amountPaidPaise: 2_000_000,
      outstandingPaise: 3_120_000,
    });

    const last = await pay(loanId, { utr: 'UTR000002', amountPaise: 3_120_000, paidAt: today() }).expect(201);
    expect(last.body.loan).toMatchObject({ status: 'CLOSED', outstandingPaise: 0 });
    expect(last.body.loan.statusHistory.at(-1)).toMatchObject({
      from: 'DISBURSED',
      to: 'CLOSED',
      by: 'SYSTEM',
    });

    const history = await api()
      .get(`/api/ops/collection/loans/${loanId}/payments`)
      .set('Cookie', COLLECTION())
      .expect(200);
    expect(history.body.map((p: { utr: string }) => p.utr)).toEqual(['UTR000001', 'UTR000002']);
    expect((await api().get('/api/borrower/profile').set('Cookie', cookie)).body.onboardingStage).toBe(
      'SLIP_UPLOADED',
    );
  });

  it('rejects overpayment, bad dates, duplicate UTR (even on another loan), and non-disbursed loans', async () => {
    const a = await disbursedLoan();
    const b = await disbursedLoan();
    const total = a.loan.totalRepaymentPaise as number;

    expect(
      (await pay(a.loanId, { utr: 'UTRX00001', amountPaise: total + 1, paidAt: today() })).body.error.code,
    ).toBe('OVERPAYMENT');
    expect(
      (await pay(a.loanId, { utr: 'UTRX00001', amountPaise: 100, paidAt: '2000-01-01' })).body.error.code,
    ).toBe('INVALID_PAYMENT_DATE');
    expect((await pay(a.loanId, { utr: 'UTRX00001', amountPaise: 100, paidAt: '2999-01-01' })).status).toBe(
      422,
    );

    await pay(a.loanId, { utr: 'utrx00001', amountPaise: 100, paidAt: today() }).expect(201);
    const dup = await pay(b.loanId, { utr: 'UTRX00001', amountPaise: 100, paidAt: today() }).expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_UTR');

    const applied = await appliedLoan();
    await pay(applied.loanId, { utr: 'UTRX00002', amountPaise: 100, paidAt: today() }).expect(409);
  });

  it('two concurrent payments that together overpay: one succeeds, one gets 422', async () => {
    const { loanId, loan } = await disbursedLoan();
    const outstanding = loan.totalRepaymentPaise as number;
    const amount = Math.ceil(outstanding * 0.6);
    const results = await Promise.all([
      pay(loanId, { utr: 'RACE00001', amountPaise: amount, paidAt: today() }),
      pay(loanId, { utr: 'RACE00002', amountPaise: amount, paidAt: today() }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const detail = await api().get(`/api/ops/loans/${loanId}`).set('Cookie', COLLECTION()).expect(200);
    expect(detail.body.amountPaidPaise).toBe(amount);
    expect(detail.body.payments).toHaveLength(1);
  });
});

describe('sales leads', () => {
  it('lists borrowers who have not applied, with their stage and BRE failures', async () => {
    const fresh = await newBorrower();
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', fresh)
      .send({
        fullName: 'Too Young',
        pan: 'QWERT1234Y',
        dob: '2010-01-01',
        monthlySalaryPaise: 5_000_000,
        employmentMode: 'SALARIED',
      })
      .expect(422);
    await appliedLoan(); // applied borrowers are not leads

    const res = await api().get('/api/ops/sales/leads').set('Cookie', SALES()).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      fullName: 'Too Young',
      onboardingStage: 'BRE_REJECTED',
      breResult: { passed: false, failures: [{ rule: 'AGE' }] },
      registeredAt: expect.any(String),
    });

    const filtered = await api()
      .get('/api/ops/sales/leads?stage=REGISTERED')
      .set('Cookie', SALES())
      .expect(200);
    expect(filtered.body.total).toBe(0);
  });
});
