import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.ts';
import type { AuthController } from './auth.controller.ts';

export function authRouter(controller: AuthController): Router {
  const router = Router();
  router.post('/signup', controller.signup);
  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  router.get('/me', authenticate, controller.me);
  return router;
}
