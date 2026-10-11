import type { RequestHandler } from 'express';
import { UnauthenticatedError } from '../domain/errors.ts';
import { SESSION_COOKIE, verifySession } from '../lib/session.ts';

/** 401 unless the request carries a valid session cookie. Sets `req.user`. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const user = typeof token === 'string' ? verifySession(token) : null;
  if (!user) throw new UnauthenticatedError();
  req.user = user;
  next();
};
