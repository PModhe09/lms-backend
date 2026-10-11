import request from 'supertest';
import { createApp } from '../src/app.ts';
import type { Role } from '../src/domain/enums.ts';
import { signSession, SESSION_COOKIE } from '../src/lib/session.ts';

export const app = createApp();
export const api = () => request(app);

/** Cookie header for a session, without going through login. */
export const sessionCookie = (role: Role, id = '000000000000000000000001') =>
  `${SESSION_COOKIE}=${signSession({ id, role })}`;
