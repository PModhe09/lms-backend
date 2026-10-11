import type { Request, Response } from 'express';
import { parse } from '../../lib/parse.ts';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../../lib/session.ts';
import { LoginBody, SignupBody, type AuthUser } from './auth.schemas.ts';
import type { AuthService } from './auth.service.ts';

export class AuthController {
  constructor(private readonly auth: AuthService) {}

  signup = async (req: Request, res: Response) => {
    const user = await this.auth.signup(parse(SignupBody, req.body));
    this.startSession(res, user);
    res.status(201).json(user);
  };

  login = async (req: Request, res: Response) => {
    const user = await this.auth.login(parse(LoginBody, req.body));
    this.startSession(res, user);
    res.json(user);
  };

  logout = (_req: Request, res: Response) => {
    const { maxAge: _maxAge, ...options } = sessionCookieOptions();
    res.clearCookie(SESSION_COOKIE, options);
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    res.json(await this.auth.me(req.user!.id));
  };

  private startSession(res: Response, user: AuthUser) {
    res.cookie(SESSION_COOKIE, signSession({ id: user.id, role: user.role }), sessionCookieOptions());
  }
}
