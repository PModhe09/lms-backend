import { describe, expect, it } from 'vitest';
import { LoanModel } from '../src/infra/models/loan.model.ts';
import { UserModel } from '../src/infra/models/user.model.ts';
import {
  api,
  appliedLoan,
  borrowerReadyToApply,
  GOOD_PROFILE,
  newBorrower,
  PDF,
  PNG,
  SALES,
  storage,
} from './helpers.ts';

describe('personal details + BRE', () => {
  it('passes, stores the decision, and moves to DETAILS_SUBMITTED', async () => {
    const cookie = await newBorrower();
    const res = await api().put('/api/borrower/profile').set('Cookie', cookie).send(GOOD_PROFILE).expect(200);
    expect(res.body).toMatchObject({
      onboardingStage: 'DETAILS_SUBMITTED',
      profile: { pan: 'ABCDE1234F', dob: '1995-06-15' },
      breResult: { passed: true, failures: [], rulesVersion: 1 },
    });
  });

  it('fails with 422 listing every rule, stores the failure, and does not advance', async () => {
    const cookie = await newBorrower();
    const res = await api()
      .put('/api/borrower/profile')
      .set('Cookie', cookie)
      .send({ ...GOOD_PROFILE, monthlySalaryPaise: 2_499_900, employmentMode: 'UNEMPLOYED', pan: 'BAD' })
      .expect(422);
    expect(res.body.error.code).toBe('BRE_REJECTED');
    expect(res.body.error.details.map((d: { rule: string }) => d.rule)).toEqual([
      'SALARY',
      'PAN',
      'EMPLOYMENT',
    ]);

    const profile = await api().get('/api/borrower/profile').set('Cookie', cookie).expect(200);
    expect(profile.body).toMatchObject({ onboardingStage: 'BRE_REJECTED', breResult: { passed: false } });
  });

  it('lets a rejected borrower fix the details and pass', async () => {
    const cookie = await newBorrower();
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', cookie)
      .send({ ...GOOD_PROFILE, dob: '2010-01-01' })
      .expect(422);
    await api().put('/api/borrower/profile').set('Cookie', cookie).send(GOOD_PROFILE).expect(200);
  });

  it('rejects a PAN already used by another account with 409', async () => {
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', await newBorrower())
      .send(GOOD_PROFILE)
      .expect(200);
    const res = await api()
      .put('/api/borrower/profile')
      .set('Cookie', await newBorrower())
      .send({ ...GOOD_PROFILE, pan: 'abcde1234f' })
      .expect(409);
    expect(res.body.error.code).toBe('PAN_TAKEN');
  });

  it('a failed eligibility check does not claim the PAN', async () => {
    // Rejected attempt with a PAN (here an invalid one, plus an underage DOB).
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', await newBorrower())
      .send({ ...GOOD_PROFILE, pan: 'ABCD1234F', dob: '2012-01-01' })
      .expect(422);
    // Another account sending the same invalid PAN gets the rule failure, not PAN_TAKEN.
    const again = await api()
      .put('/api/borrower/profile')
      .set('Cookie', await newBorrower())
      .send({ ...GOOD_PROFILE, pan: 'ABCD1234F' })
      .expect(422);
    expect(again.body.error.details.map((d: { rule: string }) => d.rule)).toEqual(['PAN']);

    // A rejected applicant cannot block the real owner of a valid PAN either.
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', await newBorrower())
      .send({ ...GOOD_PROFILE, monthlySalaryPaise: 100 })
      .expect(422);
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', await newBorrower())
      .send(GOOD_PROFILE)
      .expect(200);
  });

  it('rejects malformed input with 400', async () => {
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', await newBorrower())
      .send({ ...GOOD_PROFILE, dob: '15/06/1995' })
      .expect(400);
  });

  it('is borrower-only', async () => {
    await api().get('/api/borrower/profile').set('Cookie', SALES()).expect(403);
    await api().get('/api/bre/rules').set('Cookie', SALES()).expect(403);
    await api().get('/api/borrower/profile').expect(401);
  });

  it('serves the rule set the server uses', async () => {
    const res = await api()
      .get('/api/bre/rules')
      .set('Cookie', await newBorrower())
      .expect(200);
    expect(res.body.version).toBe(1);
    expect(res.body.rules.map((r: { id: string }) => r.id)).toEqual(['AGE', 'SALARY', 'PAN', 'EMPLOYMENT']);
  });
});

describe('salary slip upload', () => {
  async function eligible() {
    const cookie = await newBorrower();
    await api()
      .put('/api/borrower/profile')
      .set('Cookie', cookie)
      .send({ ...GOOD_PROFILE, pan: `ZZZZZ${Math.floor(1000 + Math.random() * 8999)}Z` })
      .expect(200);
    return cookie;
  }

  it('stores the file under a server key with the sniffed type', async () => {
    const cookie = await eligible();
    // A PNG named .pdf is stored as PNG: the bytes decide, not the name.
    const res = await api()
      .post('/api/borrower/salary-slip')
      .set('Cookie', cookie)
      .attach('file', PNG, 'slip.pdf');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ onboardingStage: 'SLIP_UPLOADED', salarySlip: { mime: 'image/png' } });
    const user = await UserModel.findOne({ 'salarySlip.mime': 'image/png' });
    expect(user!.salarySlip!.key).toMatch(/^slips\/[a-f0-9]{24}\/[\w-]+\.png$/);
    expect(storage.objects.has(user!.salarySlip!.key)).toBe(true);
  });

  it('rejects a non-PDF/JPG/PNG file with 422', async () => {
    const res = await api()
      .post('/api/borrower/salary-slip')
      .set('Cookie', await eligible())
      .attach('file', Buffer.from('MZ\x90\x00 executable'), 'slip.pdf')
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_FILE');
  });

  it('rejects a file over 5 MB with 422', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(5 * 1024 * 1024)]);
    const res = await api()
      .post('/api/borrower/salary-slip')
      .set('Cookie', await eligible())
      .attach('file', big, 'big.pdf')
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_FILE');
  });

  it('refuses an upload before the BRE has passed', async () => {
    await api()
      .post('/api/borrower/salary-slip')
      .set('Cookie', await newBorrower())
      .attach('file', PDF, 'slip.pdf')
      .expect(409);
  });
});

describe('apply', () => {
  it('computes interest and total on the server and ignores client-sent totals', async () => {
    const cookie = await borrowerReadyToApply();
    const res = await api()
      .post('/api/borrower/loans')
      .set('Cookie', cookie)
      .send({ principalPaise: 5_000_000, tenureDays: 30, totalRepaymentPaise: 1, interestPaise: 0 })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'APPLIED',
      rateBps: 1200,
      interestPaise: 49_315,
      totalRepaymentPaise: 5_049_315,
      outstandingPaise: 5_049_315,
      currency: 'INR',
    });
    expect((await api().get('/api/borrower/profile').set('Cookie', cookie)).body.onboardingStage).toBe(
      'APPLIED',
    );
  });

  it.each([
    { principalPaise: 4_999_900, tenureDays: 30 },
    { principalPaise: 50_000_100, tenureDays: 30 },
    { principalPaise: 5_000_000, tenureDays: 29 },
    { principalPaise: 5_000_000, tenureDays: 366 },
  ])('rejects out-of-range %o with 400', async (body) => {
    await api()
      .post('/api/borrower/loans')
      .set('Cookie', await borrowerReadyToApply())
      .send(body)
      .expect(400);
  });

  it('allows only one open loan, even for concurrent requests', async () => {
    const cookie = await borrowerReadyToApply();
    const body = { principalPaise: 10_000_000, tenureDays: 90 };
    const results = await Promise.all([
      api().post('/api/borrower/loans').set('Cookie', cookie).send(body),
      api().post('/api/borrower/loans').set('Cookie', cookie).send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await LoanModel.countDocuments()).toBe(1);
  });

  it('refuses to apply before the slip is uploaded', async () => {
    const cookie = await newBorrower();
    await api().put('/api/borrower/profile').set('Cookie', cookie).send(GOOD_PROFILE).expect(200);
    const res = await api()
      .post('/api/borrower/loans')
      .set('Cookie', cookie)
      .send({ principalPaise: 5_000_000, tenureDays: 30 })
      .expect(409);
    expect(res.body.error.code).toBe('STAGE_INVALID');
  });

  it("returns 404 for another borrower's loan and for malformed ids", async () => {
    const { loanId } = await appliedLoan();
    const other = await newBorrower();
    await api().get(`/api/borrower/loans/${loanId}`).set('Cookie', other).expect(404);
    await api().get('/api/borrower/loans/not-an-id').set('Cookie', other).expect(404);
  });

  it('lists own loans and shows detail with payments', async () => {
    const { cookie, loanId } = await appliedLoan();
    const list = await api().get('/api/borrower/loans').set('Cookie', cookie).expect(200);
    expect(list.body.map((l: { id: string }) => l.id)).toEqual([loanId]);
    const detail = await api().get(`/api/borrower/loans/${loanId}`).set('Cookie', cookie).expect(200);
    expect(detail.body).toMatchObject({ id: loanId, payments: [] });
    expect(detail.body).not.toHaveProperty('borrower');
  });
});
