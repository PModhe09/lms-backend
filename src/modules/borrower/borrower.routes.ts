import { Router } from 'express';
import { Permission } from '../../domain/rbac.ts';
import { authenticate } from '../../middleware/authenticate.ts';
import { authorize } from '../../middleware/authorize.ts';
import { uploadSlip } from '../../middleware/upload.ts';
import type { BorrowerController } from './borrower.controller.ts';

export function borrowerRouter(c: BorrowerController): Router {
  const router = Router();
  router.use(authenticate, authorize(Permission.BORROWER_PORTAL));
  router.get('/profile', c.getProfile);
  router.put('/profile', c.submitProfile);
  router.post('/salary-slip', uploadSlip, c.uploadSlip);
  router.get('/loans', c.listLoans);
  router.post('/loans', c.apply);
  router.get('/loans/:id', c.getLoan);
  return router;
}
