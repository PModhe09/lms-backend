import type { SessionUser } from '../lib/session.ts';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate`. Present on every route behind it. */
      user?: SessionUser;
    }
  }
}

export {};
