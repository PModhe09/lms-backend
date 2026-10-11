import jwt from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import { env } from '../config/env.ts';
import { ROLES, type Role } from '../domain/enums.ts';

export const SESSION_COOKIE = 'lms_token';

export type SessionUser = { id: string; role: Role };

export function signSession(user: SessionUser): string {
  return jwt.sign({ role: user.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
  });
}

/** Returns null for any invalid, expired or malformed token. Callers turn null into 401. */
export function verifySession(token: string): SessionUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub) return null;
    const role = payload.role as Role;
    if (!ROLES.includes(role)) return null;
    return { id: payload.sub, role };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
  maxAge: env.JWT_EXPIRES_IN_SECONDS * 1000,
});
