import { Router } from 'express';
import { LoanStatus } from '../../domain/loan/status.ts';
import { Permission } from '../../domain/rbac.ts';
import { authenticate } from '../../middleware/authenticate.ts';
import { authorize, authorizeAny } from '../../middleware/authorize.ts';
import type { OpsController } from './ops.controller.ts';

/**
 * One router per module, each guarded at router level, so a route added later cannot forget its check.
 * Write actions add their own, stricter permission on top of the module's read permission.
 */
export function opsRouter(c: OpsController): Router {
  const sales = Router().use(authorize(Permission.LEADS_READ));
  sales.get('/leads', c.leads);

  const sanction = Router().use(authorize(Permission.SANCTION_READ));
  sanction.get('/loans', c.queue(LoanStatus.APPLIED));
  sanction.get('/loans/:id/salary-slip', c.slipUrl);
  sanction.post('/loans/:id/approve', authorize(Permission.SANCTION_DECIDE), c.approve);
  sanction.post('/loans/:id/reject', authorize(Permission.SANCTION_DECIDE), c.reject);

  const disbursement = Router().use(authorize(Permission.DISBURSEMENT_READ));
  disbursement.get('/loans', c.queue(LoanStatus.SANCTIONED));
  disbursement.post('/loans/:id/disburse', authorize(Permission.DISBURSEMENT_EXECUTE), c.disburse);

  const collection = Router().use(authorize(Permission.COLLECTION_READ));
  collection.get('/loans', c.queue(LoanStatus.DISBURSED));
  collection.get('/loans/:id/payments', c.payments);
  collection.post('/loans/:id/payments', authorize(Permission.COLLECTION_RECORD), c.recordPayment);

  const ops = Router().use(authenticate);
  ops.use('/sales', sales);
  ops.use('/sanction', sanction);
  ops.use('/disbursement', disbursement);
  ops.use('/collection', collection);
  ops.get(
    '/loans/:id',
    authorizeAny(Permission.SANCTION_READ, Permission.DISBURSEMENT_READ, Permission.COLLECTION_READ),
    c.detail,
  );
  return ops;
}
