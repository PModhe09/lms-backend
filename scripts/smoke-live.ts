/**
 * Acceptance run against a deployed stack, through the web origin (same path a browser takes).
 *   BASE_URL=https://lms-web-five-nu.vercel.app npx tsx scripts/smoke-live.ts
 * Creates borrowers named smoke-<run>-*@lms.test; scripts/smoke-cleanup.ts removes them.
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const RUN = `smoke-${Date.now().toString(36)}`;
let n = 0;
const results: { name: string; ok: boolean; info?: string }[] = [];

type Res = { status: number; body: any; headers: Headers };
class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, raw?: RequestInit['body']): Promise<Res> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      redirect: 'manual',
    });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await r.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, body: parsed, headers: r.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b: unknown) => this.req('PUT', p, b);
  upload(p: string, buf: Buffer, name: string, type = 'application/octet-stream') {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(buf)], { type }), name);
    return this.req('POST', p, undefined, fd);
  }
}

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, info: (e as Error).message });
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}
function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const is = (r: Res, status: number, code?: string) => {
  expect(
    r.status === status,
    `expected ${status}${code ? ' ' + code : ''}, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
  );
  if (code) expect(r.body?.error?.code === code, `expected code ${code}, got ${r.body?.error?.code}`);
};

const IST = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const today = IST();
const yearsAgo = (y: number, dayShift = 0) => {
  const [Y, M, D] = today.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(Y - y, M - 1, D + dayShift));
  return d.toISOString().slice(0, 10);
};
const PDF = Buffer.from('%PDF-1.4\n% smoke slip\n');
/** A token claiming ADMIN with a bad signature; must be rejected everywhere. */
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FORGED_ADMIN = `lms_token=${b64({ alg: 'HS256' })}.${b64({ role: 'ADMIN', sub: 'x' })}.forged`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const panFor = (i: number) => `SMOKE${String((Date.now() + i * 7919) % 10000).padStart(4, '0')}Z`;
const profile = (i: number, patch: object = {}) => ({
  fullName: `Smoke Tester ${i}`,
  pan: panFor(i),
  dob: '1994-05-20',
  monthlySalaryPaise: 6_000_000,
  employmentMode: 'SALARIED',
  ...patch,
});

async function borrower(): Promise<Client> {
  n += 1;
  const c = new Client();
  const r = await c.post('/api/auth/signup', { email: `${RUN}-${n}@lms.test`, password: 'password123' });
  is(r, 201);
  return c;
}
async function ready(): Promise<Client> {
  const c = await borrower();
  is(await c.put('/api/borrower/profile', profile(n)), 200);
  is(await c.upload('/api/borrower/salary-slip', PDF, 'slip.pdf', 'application/pdf'), 200);
  return c;
}
async function applied(principalPaise = 5_000_000, tenureDays = 73) {
  const c = await ready();
  const r = await c.post('/api/borrower/loans', { principalPaise, tenureDays });
  is(r, 201);
  return { c, loan: r.body };
}
async function staff(email: string, password: string) {
  const c = new Client();
  is(await c.post('/api/auth/login', { email, password }), 200);
  return c;
}

async function main() {
  console.log(`Live acceptance against ${BASE} (run ${RUN})\n`);
  const S = {
    admin: await staff('admin@lms.dev', 'Admin@123'),
    sales: await staff('sales@lms.dev', 'Sales@123'),
    sanction: await staff('sanction@lms.dev', 'Sanction@123'),
    disbursement: await staff('disbursement@lms.dev', 'Disburse@123'),
    collection: await staff('collection@lms.dev', 'Collect@123'),
    borrower: await staff('borrower@lms.dev', 'Borrower@123'),
  };

  console.log('Platform');
  await check('health is ok with Mongo reachable', async () => {
    const r = await new Client().get('/api/healthz');
    is(r, 200);
    expect(r.body.mongo === true, 'mongo not reachable');
  });
  await check('security headers present (helmet) and no x-powered-by', async () => {
    const r = await new Client().get('/api/healthz');
    expect(r.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
    expect(!r.headers.get('x-powered-by')?.includes('Express'), 'x-powered-by leaks Express');
  });
  await check('unknown route → 404 envelope with requestId', async () => {
    const r = await new Client().get('/api/nope');
    is(r, 404, 'NOT_FOUND');
    expect(typeof r.body.requestId === 'string', 'no requestId');
  });
  await check('OpenAPI document served', async () => {
    const r = await new Client().get('/api/openapi.json');
    is(r, 200);
    expect(r.body.openapi?.startsWith('3.1'), 'not openapi 3.1');
  });

  console.log('\nAuth');
  await check(
    'signup creates BORROWER even when body says ADMIN; cookie is HttpOnly, Secure, SameSite=Lax',
    async () => {
      const c = new Client();
      const r = await c.post('/api/auth/signup', {
        email: `${RUN}-admin-try@lms.test`,
        password: 'password123',
        role: 'ADMIN',
      });
      is(r, 201);
      expect(r.body.role === 'BORROWER', `role ${r.body.role}`);
      const cookie = r.headers.getSetCookie().join(';');
      expect(
        /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Lax/i.test(cookie),
        `cookie flags: ${cookie}`,
      );
    },
  );
  await check('duplicate email (any case) → 409 EMAIL_TAKEN', async () => {
    const r = await new Client().post('/api/auth/signup', {
      email: `${RUN}-ADMIN-TRY@lms.test`,
      password: 'password123',
    });
    is(r, 409, 'EMAIL_TAKEN');
  });
  await check('short password → 400 VALIDATION_ERROR', async () => {
    is(
      await new Client().post('/api/auth/signup', { email: `${RUN}-short@lms.test`, password: 'short' }),
      400,
      'VALIDATION_ERROR',
    );
  });
  await check('wrong password and unknown email → identical 401', async () => {
    const a = await new Client().post('/api/auth/login', { email: 'admin@lms.dev', password: 'nope-nope' });
    const b = await new Client().post('/api/auth/login', { email: 'nobody@lms.test', password: 'nope-nope' });
    is(a, 401);
    is(b, 401);
    expect(JSON.stringify(a.body.error) === JSON.stringify(b.body.error), 'bodies differ');
  });
  await check('/me without cookie → 401, with forged token → 401', async () => {
    is(await new Client().get('/api/auth/me'), 401, 'UNAUTHENTICATED');
    const f = new Client();
    f.cookie = FORGED_ADMIN;
    is(await f.get('/api/auth/me'), 401);
    is(await f.get('/api/ops/sanction/loans'), 401);
  });
  await check('every seeded role logs in with the right role', async () => {
    for (const [k, c] of Object.entries(S)) {
      const r = await c.get('/api/auth/me');
      is(r, 200);
      expect(r.body.role === k.toUpperCase(), `${k} has role ${r.body.role}`);
    }
  });
  await check('logout clears the session', async () => {
    const c = await borrower();
    is(await c.post('/api/auth/logout'), 204);
    is(await c.get('/api/auth/me'), 401);
  });

  console.log('\nPersonal details + BRE');
  const bre = async (patch: object) => {
    const c = await borrower();
    return c.put('/api/borrower/profile', profile(n, patch));
  };
  const failedRules = (r: Res) => (r.body?.error?.details ?? []).map((d: any) => d.rule).join(',');
  await check('valid details → 200 DETAILS_SUBMITTED, decision stored with rules v1', async () => {
    const r = await bre({});
    is(r, 200);
    expect(
      r.body.onboardingStage === 'DETAILS_SUBMITTED' &&
        r.body.breResult.passed &&
        r.body.breResult.rulesVersion === 1,
      JSON.stringify(r.body),
    );
  });
  await check('age exactly 23 today passes; turning 23 tomorrow fails AGE', async () => {
    is(await bre({ dob: yearsAgo(23) }), 200);
    const r = await bre({ dob: yearsAgo(23, 1) });
    is(r, 422, 'BRE_REJECTED');
    expect(failedRules(r) === 'AGE', failedRules(r));
  });
  await check('age 50 passes; 51st birthday today fails AGE', async () => {
    is(await bre({ dob: yearsAgo(50, 1) }), 200);
    const r = await bre({ dob: yearsAgo(51) });
    is(r, 422, 'BRE_REJECTED');
    expect(failedRules(r) === 'AGE', failedRules(r));
  });
  await check('salary ₹24,999 fails SALARY; ₹25,000 passes', async () => {
    const r = await bre({ monthlySalaryPaise: 2_499_900 });
    is(r, 422);
    expect(failedRules(r) === 'SALARY', failedRules(r));
    is(await bre({ monthlySalaryPaise: 2_500_000 }), 200);
  });
  await check('bad PAN fails PAN; lowercase valid PAN is accepted and uppercased', async () => {
    const r = await bre({ pan: 'ABCD1234F' });
    expect(failedRules(r) === 'PAN', failedRules(r));
    const ok = await bre({ pan: `smoka${String(Date.now() % 10000).padStart(4, '0')}z` });
    is(ok, 200);
    expect(/^SMOKA\d{4}Z$/.test(ok.body.profile.pan), ok.body.profile.pan);
  });
  await check('UNEMPLOYED fails EMPLOYMENT; SELF_EMPLOYED passes', async () => {
    const r = await bre({ employmentMode: 'UNEMPLOYED' });
    expect(failedRules(r) === 'EMPLOYMENT', failedRules(r));
    is(await bre({ employmentMode: 'SELF_EMPLOYED' }), 200);
  });
  await check(
    'all rules failing → all four reported at once; stage BRE_REJECTED; retry with fixed data passes',
    async () => {
      const c = await borrower();
      const r = await c.put(
        '/api/borrower/profile',
        profile(n, { dob: yearsAgo(10), monthlySalaryPaise: 100, pan: 'X', employmentMode: 'UNEMPLOYED' }),
      );
      is(r, 422);
      expect(failedRules(r) === 'AGE,SALARY,PAN,EMPLOYMENT', failedRules(r));
      expect(
        (await c.get('/api/borrower/profile')).body.onboardingStage === 'BRE_REJECTED',
        'stage not BRE_REJECTED',
      );
      is(await c.put('/api/borrower/profile', profile(n)), 200);
    },
  );
  await check('PAN already used by another account → 409 PAN_TAKEN', async () => {
    const pan = panFor(999);
    is(await (await borrower()).put('/api/borrower/profile', profile(n, { pan })), 200);
    is(await (await borrower()).put('/api/borrower/profile', profile(n, { pan })), 409, 'PAN_TAKEN');
  });
  await check('malformed input (bad date, missing field) → 400', async () => {
    const c = await borrower();
    is(await c.put('/api/borrower/profile', profile(n, { dob: '20/05/1994' })), 400, 'VALIDATION_ERROR');
    is(await c.put('/api/borrower/profile', { fullName: 'x' }), 400);
  });
  await check('GET /bre/rules: borrower 200 with 4 rules; staff 403; anonymous 401', async () => {
    const r = await S.borrower.get('/api/bre/rules');
    is(r, 200);
    expect(r.body.rules.length === 4, 'rule count');
    is(await S.admin.get('/api/bre/rules'), 403);
    is(await new Client().get('/api/bre/rules'), 401);
  });

  console.log('\nSalary slip upload');
  await check('upload before passing BRE → 409', async () => {
    is(await (await borrower()).upload('/api/borrower/salary-slip', PDF, 'slip.pdf'), 409);
  });
  await check('PDF accepted → SLIP_UPLOADED; PNG named .pdf stored as image/png', async () => {
    const c = await borrower();
    is(await c.put('/api/borrower/profile', profile(n)), 200);
    const r = await c.upload('/api/borrower/salary-slip', PNG, 'tricky.pdf', 'application/pdf');
    is(r, 200);
    expect(
      r.body.salarySlip.mime === 'image/png' && r.body.onboardingStage === 'SLIP_UPLOADED',
      JSON.stringify(r.body.salarySlip),
    );
  });
  await check('executable renamed to .pdf → 422 INVALID_FILE', async () => {
    const c = await borrower();
    is(await c.put('/api/borrower/profile', profile(n)), 200);
    is(
      await c.upload(
        '/api/borrower/salary-slip',
        Buffer.from('MZ\x90\x00 not a pdf'),
        'slip.pdf',
        'application/pdf',
      ),
      422,
      'INVALID_FILE',
    );
  });
  await check('upload with no file → 422 INVALID_FILE', async () => {
    const c = await borrower();
    is(await c.put('/api/borrower/profile', profile(n)), 200);
    is(await c.req('POST', '/api/borrower/salary-slip', undefined, new FormData()), 422, 'INVALID_FILE');
  });
  await check('4 MB slip accepted end-to-end on the live platform', async () => {
    const c = await borrower();
    is(await c.put('/api/borrower/profile', profile(n)), 200);
    const big = Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]);
    is(await c.upload('/api/borrower/salary-slip', big, 'big.pdf', 'application/pdf'), 200);
  });
  await check('slip over 5 MB is refused (413 by platform or 422 by API)', async () => {
    const c = await borrower();
    is(await c.put('/api/borrower/profile', profile(n)), 200);
    const huge = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const r = await c.upload('/api/borrower/salary-slip', huge, 'huge.pdf', 'application/pdf');
    expect(r.status === 413 || r.status === 422, `got ${r.status}`);
  });

  const opts = await (await borrower()).get('/api/borrower/salary-slip/upload-options');
  if (opts.body?.mode === 'direct') {
    const { uploadPresigned } = await import('@vercel/blob/client');
    const directUpload = async (c: Client, key: string, buf: Buffer) =>
      uploadPresigned(key, new Blob([new Uint8Array(buf)], { type: 'application/pdf' }), {
        access: 'private',
        contentType: 'application/pdf',
        handleUploadUrl: `${BASE}/api/borrower/salary-slip/presign`,
        headers: { cookie: c.cookie },
      });
    const prefixOf = async (c: Client) =>
      (await c.get('/api/borrower/salary-slip/upload-options')).body.keyPrefix as string;
    const presign = (c: Client, pathname: string) =>
      c.post('/api/borrower/salary-slip/presign', {
        type: 'blob.generate-presigned-url',
        payload: { pathname, multipart: false, clientPayload: null },
      });

    await check(
      'direct upload: 4.9 MB slip goes browser → storage, confirm records it, staff can view it',
      async () => {
        const { c } = { c: await borrower() };
        is(await c.put('/api/borrower/profile', profile(n)), 200);
        const key = `${await prefixOf(c)}${crypto.randomUUID()}.pdf`;
        await directUpload(c, key, Buffer.concat([PDF, Buffer.alloc(Math.floor(4.9 * 1024 * 1024))]));
        const r = await c.post('/api/borrower/salary-slip/confirm', { key, originalName: 'big.pdf' });
        is(r, 200);
        expect(
          r.body.salarySlip.size > 4.8 * 1024 * 1024 && r.body.onboardingStage === 'SLIP_UPLOADED',
          JSON.stringify(r.body.salarySlip),
        );
        const loan = await c.post('/api/borrower/loans', { principalPaise: 5_000_000, tenureDays: 30 });
        is(loan, 201);
        const view = await S.sanction.get(`/api/ops/sanction/loans/${loan.body.id}/salary-slip`);
        const file = await fetch(view.body.url);
        expect(
          file.status === 200 && Number(file.headers.get('content-length')) > 4.8 * 1024 * 1024,
          `view ${file.status}`,
        );
      },
    );
    await check('direct upload: storage refuses more than 5 MB even with a valid presigned URL', async () => {
      const c = await borrower();
      is(await c.put('/api/borrower/profile', profile(n)), 200);
      const key = `${await prefixOf(c)}${crypto.randomUUID()}.pdf`;
      let refused = false;
      try {
        await directUpload(c, key, Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 + 10)]));
      } catch {
        refused = true;
      }
      expect(refused, 'oversized direct upload was accepted by storage');
      is(await c.post('/api/borrower/salary-slip/confirm', { key }), 404);
    });
    await check('direct upload: non-PDF/JPG/PNG bytes are deleted on confirm (422)', async () => {
      const c = await borrower();
      is(await c.put('/api/borrower/profile', profile(n)), 200);
      const key = `${await prefixOf(c)}${crypto.randomUUID()}.pdf`;
      await directUpload(c, key, Buffer.from('MZ\x90 not really a pdf'));
      is(await c.post('/api/borrower/salary-slip/confirm', { key }), 422, 'INVALID_FILE');
      is(await c.post('/api/borrower/salary-slip/confirm', { key }), 404); // gone
    });
    await check(
      "direct upload: presign refuses other users' folders, odd names, and before eligibility",
      async () => {
        const a = await borrower();
        is(await a.put('/api/borrower/profile', profile(n)), 200);
        const b = await borrower();
        is(await b.put('/api/borrower/profile', profile(n)), 200);
        is(await presign(a, `${await prefixOf(b)}${crypto.randomUUID()}.pdf`), 422);
        is(await presign(a, `${await prefixOf(a)}../x.pdf`), 422);
        is(await presign(a, `${await prefixOf(a)}slip.pdf`), 422);
        const fresh = await borrower();
        is(await presign(fresh, `${await prefixOf(fresh)}${crypto.randomUUID()}.pdf`), 409);
        is(
          await a.post('/api/borrower/salary-slip/presign', { type: 'blob.upload-completed', payload: {} }),
          400,
        );
        is(
          await a.post('/api/borrower/salary-slip/confirm', {
            key: `${await prefixOf(b)}${crypto.randomUUID()}.pdf`,
          }),
          404,
        );
      },
    );
  }

  console.log('\nApply');
  await check('apply before slip → 409 STAGE_INVALID', async () => {
    const c = await borrower();
    is(await c.put('/api/borrower/profile', profile(n)), 200);
    is(
      await c.post('/api/borrower/loans', { principalPaise: 5_000_000, tenureDays: 30 }),
      409,
      'STAGE_INVALID',
    );
  });
  await check('out-of-range amount/tenure → 400 (₹49,999, ₹5,00,001, 29 d, 366 d)', async () => {
    const c = await ready();
    for (const b of [
      { principalPaise: 4_999_900, tenureDays: 30 },
      { principalPaise: 50_000_100, tenureDays: 30 },
      { principalPaise: 5_000_000, tenureDays: 29 },
      { principalPaise: 5_000_000, tenureDays: 366 },
    ])
      is(await c.post('/api/borrower/loans', b), 400);
  });
  await check('server computes SI and ignores client-sent totals (₹50,000 × 30 d → ₹493.15)', async () => {
    const c = await ready();
    const r = await c.post('/api/borrower/loans', {
      principalPaise: 5_000_000,
      tenureDays: 30,
      interestPaise: 0,
      totalRepaymentPaise: 1,
    });
    is(r, 201);
    expect(
      r.body.interestPaise === 49_315 && r.body.totalRepaymentPaise === 5_049_315 && r.body.rateBps === 1200,
      JSON.stringify(r.body),
    );
  });
  await check('max loan ₹5,00,000 × 365 d → interest exactly ₹60,000', async () => {
    const c = await ready();
    const r = await c.post('/api/borrower/loans', { principalPaise: 50_000_000, tenureDays: 365 });
    is(r, 201);
    expect(r.body.interestPaise === 6_000_000, String(r.body.interestPaise));
  });
  await check('second apply while one is open → 409 OPEN_LOAN_EXISTS; details locked → 409', async () => {
    const { c } = await applied();
    is(
      await c.post('/api/borrower/loans', { principalPaise: 5_000_000, tenureDays: 30 }),
      409,
      'OPEN_LOAN_EXISTS',
    );
    is(await c.put('/api/borrower/profile', profile(n)), 409, 'LOAN_IN_PROGRESS');
  });
  await check('two simultaneous applies → exactly one 201', async () => {
    const c = await ready();
    const rs = await Promise.all(
      [1, 2].map(() => c.post('/api/borrower/loans', { principalPaise: 6_000_000, tenureDays: 60 })),
    );
    const codes = rs.map((r) => r.status).sort();
    expect(codes[0] === 201 && codes[1] === 409, `got ${codes}`);
  });
  await check(
    "another borrower's loan → 404; malformed id → 404; own loan → 200 without borrower PII",
    async () => {
      const { c, loan } = await applied();
      is(await (await borrower()).get(`/api/borrower/loans/${loan.id}`), 404, 'NOT_FOUND');
      is(await c.get('/api/borrower/loans/not-an-id'), 404);
      const own = await c.get(`/api/borrower/loans/${loan.id}`);
      is(own, 200);
      expect(!own.body.borrower && Array.isArray(own.body.payments), 'unexpected shape');
    },
  );

  console.log('\nSanction');
  await check('queue lists APPLIED loans with borrower; approve → SANCTIONED with history', async () => {
    const { loan } = await applied();
    const q = await S.sanction.get('/api/ops/sanction/loans?limit=100');
    is(q, 200);
    expect(
      q.body.items.some((l: any) => l.id === loan.id && l.borrower?.fullName),
      'loan not in queue',
    );
    const r = await S.sanction.post(`/api/ops/sanction/loans/${loan.id}/approve`);
    is(r, 200);
    expect(r.body.status === 'SANCTIONED' && r.body.statusHistory.length === 2, r.body.status);
  });
  await check('deciding twice → 409 INVALID_STATE', async () => {
    const { loan } = await applied();
    is(await S.sanction.post(`/api/ops/sanction/loans/${loan.id}/approve`), 200);
    is(
      await S.sanction.post(`/api/ops/sanction/loans/${loan.id}/reject`, { reason: 'late' }),
      409,
      'INVALID_STATE',
    );
  });
  await check('simultaneous approve (Sanction) + reject (Admin) → one 200, one 409', async () => {
    const { loan } = await applied();
    const rs = await Promise.all([
      S.sanction.post(`/api/ops/sanction/loans/${loan.id}/approve`),
      S.admin.post(`/api/ops/sanction/loans/${loan.id}/reject`, { reason: 'race' }),
    ]);
    const codes = rs.map((r) => r.status).sort();
    expect(codes[0] === 200 && codes[1] === 409, `got ${codes}`);
  });
  await check(
    'reject needs a reason (400); with reason → REJECTED; borrower sees it and can reapply',
    async () => {
      const { c, loan } = await applied();
      is(await S.sanction.post(`/api/ops/sanction/loans/${loan.id}/reject`, { reason: '   ' }), 400);
      const r = await S.sanction.post(`/api/ops/sanction/loans/${loan.id}/reject`, {
        reason: 'Slip unreadable',
      });
      is(r, 200);
      const mine = await c.get(`/api/borrower/loans/${loan.id}`);
      expect(
        mine.body.status === 'REJECTED' && mine.body.rejectionReason === 'Slip unreadable',
        JSON.stringify(mine.body).slice(0, 120),
      );
      is(await c.post('/api/borrower/loans', { principalPaise: 7_000_000, tenureDays: 45 }), 201);
    },
  );
  await check('slip view: presigned URL serves the file; unsigned URL is refused', async () => {
    const { loan } = await applied();
    const r = await S.sanction.get(`/api/ops/sanction/loans/${loan.id}/salary-slip`);
    is(r, 200);
    expect(r.body.expiresInSeconds === 300, 'ttl');
    const file = await fetch(r.body.url);
    expect(file.status === 200 && (await file.text()).startsWith('%PDF'), `signed GET ${file.status}`);
    const bare = await fetch(r.body.url.split('?')[0]);
    expect(bare.status === 403 || bare.status === 401 || bare.status === 404, `unsigned GET ${bare.status}`);
  });
  await check('unknown loan id → 404', async () => {
    is(await S.sanction.post('/api/ops/sanction/loans/0123456789abcdef01234567/approve'), 404);
  });

  console.log('\nDisbursement');
  await check(
    'disbursing an APPLIED loan → 409; SANCTIONED loan appears in queue and disburses',
    async () => {
      const { loan } = await applied();
      is(await S.disbursement.post(`/api/ops/disbursement/loans/${loan.id}/disburse`), 409, 'INVALID_STATE');
      is(await S.sanction.post(`/api/ops/sanction/loans/${loan.id}/approve`), 200);
      const q = await S.disbursement.get('/api/ops/disbursement/loans?limit=100');
      expect(
        q.body.items.some((l: any) => l.id === loan.id),
        'not in disbursement queue',
      );
      const r = await S.disbursement.post(`/api/ops/disbursement/loans/${loan.id}/disburse`);
      is(r, 200);
      expect(r.body.status === 'DISBURSED' && r.body.disbursedAt, r.body.status);
    },
  );

  console.log('\nCollection');
  const disbursed = async (principal = 5_000_000, days = 73) => {
    const a = await applied(principal, days);
    is(await S.sanction.post(`/api/ops/sanction/loans/${a.loan.id}/approve`), 200);
    is(await S.disbursement.post(`/api/ops/disbursement/loans/${a.loan.id}/disburse`), 200);
    return a;
  };
  const pay = (id: string, body: object) =>
    S.collection.post(`/api/ops/collection/loans/${id}/payments`, body);
  const utr = () => `SMK${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e6)}`;
  await check('payment on a non-disbursed loan → 409', async () => {
    const { loan } = await applied();
    is(await pay(loan.id, { utr: utr(), amountPaise: 100, paidAt: today }), 409);
  });
  await check(
    'overpayment → 422 OVERPAYMENT; date before disbursal / in future → 422 INVALID_PAYMENT_DATE; bad UTR → 400',
    async () => {
      const { loan } = await disbursed();
      is(
        await pay(loan.id, { utr: utr(), amountPaise: loan.totalRepaymentPaise + 1, paidAt: today }),
        422,
        'OVERPAYMENT',
      );
      is(
        await pay(loan.id, { utr: utr(), amountPaise: 100, paidAt: '2020-01-01' }),
        422,
        'INVALID_PAYMENT_DATE',
      );
      is(
        await pay(loan.id, { utr: utr(), amountPaise: 100, paidAt: '2999-01-01' }),
        422,
        'INVALID_PAYMENT_DATE',
      );
      is(await pay(loan.id, { utr: 'bad utr!', amountPaise: 100, paidAt: today }), 400);
      is(await pay(loan.id, { utr: utr(), amountPaise: 0, paidAt: today }), 400);
    },
  );
  await check(
    'partial payment reduces outstanding; final payment auto-closes (by SYSTEM); borrower can reapply',
    async () => {
      const { c, loan } = await disbursed(5_000_000, 73); // interest ₹1,200 exactly → total ₹51,200
      const first = await pay(loan.id, { utr: utr(), amountPaise: 2_000_000, paidAt: today });
      is(first, 201);
      expect(
        first.body.loan.outstandingPaise === 3_120_000 && first.body.loan.status === 'DISBURSED',
        JSON.stringify(first.body.loan).slice(0, 150),
      );
      const last = await pay(loan.id, { utr: utr(), amountPaise: 3_120_000, paidAt: today });
      is(last, 201);
      const h = last.body.loan.statusHistory.at(-1);
      expect(last.body.loan.status === 'CLOSED' && h.by === 'SYSTEM', `${last.body.loan.status} by ${h.by}`);
      const mine = await c.get(`/api/borrower/loans/${loan.id}`);
      expect(mine.body.status === 'CLOSED' && mine.body.payments.length === 2, 'borrower view');
      is(await c.post('/api/borrower/loans', { principalPaise: 5_000_000, tenureDays: 30 }), 201);
    },
  );
  await check('payment on a CLOSED loan → 409', async () => {
    const { loan } = await disbursed();
    is(await pay(loan.id, { utr: utr(), amountPaise: loan.totalRepaymentPaise, paidAt: today }), 201);
    is(await pay(loan.id, { utr: utr(), amountPaise: 100, paidAt: today }), 409);
  });
  await check('same UTR on a different loan → 409 DUPLICATE_UTR (case-insensitive)', async () => {
    const a = await disbursed();
    const b = await disbursed();
    const u = utr();
    is(await pay(a.loan.id, { utr: u, amountPaise: 100, paidAt: today }), 201);
    is(await pay(b.loan.id, { utr: u.toLowerCase(), amountPaise: 100, paidAt: today }), 409, 'DUPLICATE_UTR');
  });
  await check('two simultaneous 60% payments → one 201, one 422; ledger and loan agree', async () => {
    const { loan } = await disbursed();
    const amount = Math.ceil(loan.totalRepaymentPaise * 0.6);
    const rs = await Promise.all([
      pay(loan.id, { utr: utr(), amountPaise: amount, paidAt: today }),
      pay(loan.id, { utr: utr(), amountPaise: amount, paidAt: today }),
    ]);
    const codes = rs.map((r) => r.status).sort();
    expect(codes[0] === 201 && codes[1] === 422, `got ${codes}`);
    const d = await S.collection.get(`/api/ops/loans/${loan.id}`);
    expect(
      d.body.amountPaidPaise === amount && d.body.payments.length === 1,
      `paid ${d.body.amountPaidPaise}, ${d.body.payments.length} payments`,
    );
  });

  console.log('\nSales leads');
  await check(
    'leads exclude applied borrowers, include BRE failures with reasons, stage filter works',
    async () => {
      const c = await borrower();
      await c.put('/api/borrower/profile', profile(n, { monthlySalaryPaise: 100 }));
      const me = (await c.get('/api/auth/me')).body.id;
      const { c: appliedClient } = await applied();
      const appliedId = (await appliedClient.get('/api/auth/me')).body.id;
      const all = await S.sales.get('/api/ops/sales/leads?stage=BRE_REJECTED&limit=100');
      is(all, 200);
      const lead = all.body.items.find((l: any) => l.id === me);
      expect(lead && lead.breResult.failures[0].rule === 'SALARY', 'rejected lead missing or no reason');
      const any = await S.sales.get('/api/ops/sales/leads?limit=100');
      expect(!any.body.items.some((l: any) => l.id === appliedId), 'applied borrower listed as lead');
      is(await S.sales.get('/api/ops/sales/leads?stage=APPLIED'), 400);
    },
  );

  console.log('\nRBAC matrix (every ops route × every role)');
  const ID = '0123456789abcdef01234567';
  const routes: [string, string, string[]][] = [
    ['GET', '/api/ops/sales/leads', ['admin', 'sales']],
    ['GET', '/api/ops/sanction/loans', ['admin', 'sanction']],
    ['GET', `/api/ops/sanction/loans/${ID}/salary-slip`, ['admin', 'sanction']],
    ['POST', `/api/ops/sanction/loans/${ID}/approve`, ['admin', 'sanction']],
    ['POST', `/api/ops/sanction/loans/${ID}/reject`, ['admin', 'sanction']],
    ['GET', '/api/ops/disbursement/loans', ['admin', 'disbursement']],
    ['POST', `/api/ops/disbursement/loans/${ID}/disburse`, ['admin', 'disbursement']],
    ['GET', '/api/ops/collection/loans', ['admin', 'collection']],
    ['GET', `/api/ops/collection/loans/${ID}/payments`, ['admin', 'collection']],
    ['POST', `/api/ops/collection/loans/${ID}/payments`, ['admin', 'collection']],
    ['GET', `/api/ops/loans/${ID}`, ['admin', 'sanction', 'disbursement', 'collection']],
    ['GET', '/api/borrower/profile', ['borrower']],
    ['POST', '/api/borrower/loans', ['borrower']],
  ];
  for (const [method, path, allowed] of routes) {
    await check(`${method} ${path.replace(ID, ':id')} → allowed only for ${allowed.join('/')}`, async () => {
      is(await new Client().req(method, path, method === 'POST' ? {} : undefined), 401);
      for (const [role, c] of Object.entries(S)) {
        const r = await c.req(method, path, method === 'POST' ? {} : undefined);
        if (allowed.includes(role)) expect(r.status !== 403 && r.status !== 401, `${role} got ${r.status}`);
        else expect(r.status === 403, `${role} got ${r.status}, expected 403`);
      }
    });
  }

  console.log('\nWeb route guards (proxy.ts)');
  const page = async (c: Client, path: string) => {
    const r = await fetch(`${BASE}${path}`, {
      headers: c.cookie ? { cookie: c.cookie } : {},
      redirect: 'manual',
    });
    return { status: r.status, location: r.headers.get('location') ?? '' };
  };
  await check('anonymous → /login?next=…; forged token → /login', async () => {
    const r = await page(new Client(), '/dashboard/sanction');
    expect(r.status === 307 && r.location.includes('/login?next=%2Fdashboard%2Fsanction'), JSON.stringify(r));
    const f = new Client();
    f.cookie = FORGED_ADMIN;
    expect((await page(f, '/dashboard')).location.includes('/login'), 'forged token not redirected');
  });
  await check('borrower on /dashboard → /apply; staff on /apply → /dashboard', async () => {
    expect((await page(S.borrower, '/dashboard')).location.endsWith('/apply'), 'borrower');
    expect((await page(S.sales, '/apply')).location.endsWith('/dashboard'), 'staff');
  });
  await check('each executive is sent to /403 from other modules, admin opens all', async () => {
    const mods = ['sales', 'sanction', 'disbursement', 'collection'];
    for (const role of mods) {
      for (const m of mods) {
        const r = await page(S[role as keyof typeof S], `/dashboard/${m}`);
        if (m === role) expect(r.status === 200, `${role} on ${m}: ${r.status}`);
        else expect(r.location.endsWith('/403'), `${role} on ${m}: ${r.status} ${r.location}`);
      }
      expect((await page(S.admin, `/dashboard/${role}`)).status === 200, `admin on ${role}`);
    }
  });
  await check('logged-in user on /login → their home', async () => {
    expect((await page(S.collection, '/login')).location.endsWith('/dashboard'), 'staff');
    expect((await page(S.borrower, '/login')).location.endsWith('/apply'), 'borrower');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Run id: ${RUN}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
