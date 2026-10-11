import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../src/domain/enums.ts';
import { api, sessionCookie } from './helpers.ts';

/**
 * Every ops route × every role. Only checks the authorization outcome: 403 when the role lacks
 * the permission, anything else (200/400/404/409) when it has it. This is the proof that hiding
 * menu items is not the only protection.
 */
const ID = '0123456789abcdef01234567';
const ROUTES: { method: 'get' | 'post'; path: string; allowed: Role[] }[] = [
  { method: 'get', path: '/api/ops/sales/leads', allowed: ['ADMIN', 'SALES'] },
  { method: 'get', path: '/api/ops/sanction/loans', allowed: ['ADMIN', 'SANCTION'] },
  { method: 'get', path: `/api/ops/sanction/loans/${ID}/salary-slip`, allowed: ['ADMIN', 'SANCTION'] },
  { method: 'post', path: `/api/ops/sanction/loans/${ID}/approve`, allowed: ['ADMIN', 'SANCTION'] },
  { method: 'post', path: `/api/ops/sanction/loans/${ID}/reject`, allowed: ['ADMIN', 'SANCTION'] },
  { method: 'get', path: '/api/ops/disbursement/loans', allowed: ['ADMIN', 'DISBURSEMENT'] },
  { method: 'post', path: `/api/ops/disbursement/loans/${ID}/disburse`, allowed: ['ADMIN', 'DISBURSEMENT'] },
  { method: 'get', path: '/api/ops/collection/loans', allowed: ['ADMIN', 'COLLECTION'] },
  { method: 'get', path: `/api/ops/collection/loans/${ID}/payments`, allowed: ['ADMIN', 'COLLECTION'] },
  { method: 'post', path: `/api/ops/collection/loans/${ID}/payments`, allowed: ['ADMIN', 'COLLECTION'] },
  {
    method: 'get',
    path: `/api/ops/loans/${ID}`,
    allowed: ['ADMIN', 'SANCTION', 'DISBURSEMENT', 'COLLECTION'],
  },
  { method: 'get', path: '/api/borrower/profile', allowed: ['BORROWER'] },
  { method: 'post', path: '/api/borrower/loans', allowed: ['BORROWER'] },
];

describe('RBAC matrix', () => {
  for (const route of ROUTES) {
    it(`${route.method.toUpperCase()} ${route.path} without a session → 401`, async () => {
      await api()[route.method](route.path).expect(401);
    });
    for (const role of ROLES) {
      const allowed = route.allowed.includes(role);
      it(`${route.method.toUpperCase()} ${route.path} as ${role} → ${allowed ? 'allowed' : '403'}`, async () => {
        const res = await api()[route.method](route.path).set('Cookie', sessionCookie(role)).send({});
        if (allowed) expect(res.status).not.toBe(403);
        else expect(res.status).toBe(403);
      });
    }
  }
});
