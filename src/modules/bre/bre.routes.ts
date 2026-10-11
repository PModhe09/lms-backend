import { Router } from 'express';
import { BRE_RULES } from '../../domain/bre/rules.ts';
import { Permission } from '../../domain/rbac.ts';
import { authenticate } from '../../middleware/authenticate.ts';
import { authorize } from '../../middleware/authorize.ts';

/** The client fetches the live rule set for instant hints. The server still decides (ADR 0004). */
export function breRouter(): Router {
  const router = Router();
  router.get('/rules', authenticate, authorize(Permission.BORROWER_PORTAL), (_req, res) => {
    res.json(BRE_RULES);
  });
  return router;
}
