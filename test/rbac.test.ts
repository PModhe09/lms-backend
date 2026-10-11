import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Role, ROLES } from '../src/domain/enums.ts';
import { Permission, ROLE_PERMISSIONS } from '../src/domain/rbac.ts';
import { authenticate } from '../src/middleware/authenticate.ts';
import { authorize } from '../src/middleware/authorize.ts';
import { errorHandler } from '../src/middleware/error-handler.ts';
import { requestLogger } from '../src/middleware/request-logger.ts';
import { sessionCookie } from './helpers.ts';

const probe = express()
  .use(requestLogger)
  .use(cookieParser())
  .get('/decide', authenticate, authorize(Permission.SANCTION_DECIDE), (_req, res) => {
    res.json({ ok: true });
  })
  .use(errorHandler);

describe('authenticate + authorize', () => {
  it('401 without a session', async () => {
    await request(probe).get('/decide').expect(401);
  });

  it.each(ROLES)('%s gets 200 only if it holds SANCTION_DECIDE', async (role) => {
    const expected = ROLE_PERMISSIONS[role].includes(Permission.SANCTION_DECIDE) ? 200 : 403;
    await request(probe).get('/decide').set('Cookie', sessionCookie(role)).expect(expected);
  });
});

describe('ROLE_PERMISSIONS', () => {
  it('admin holds every ops permission but not the borrower portal', () => {
    const ops = Object.values(Permission).filter((p) => p !== Permission.BORROWER_PORTAL);
    expect([...ROLE_PERMISSIONS[Role.ADMIN]].sort()).toEqual(ops.sort());
  });
});
