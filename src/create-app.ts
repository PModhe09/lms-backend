import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { ObjectStorage } from './infra/storage.ts';
import { systemClock, type Clock } from './lib/time.ts';
import { errorHandler, notFound } from './middleware/error-handler.ts';
import { requestLogger } from './middleware/request-logger.ts';
import { AuthController } from './modules/auth/auth.controller.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { AuthService } from './modules/auth/auth.service.ts';
import { BorrowerController } from './modules/borrower/borrower.controller.ts';
import { borrowerRouter } from './modules/borrower/borrower.routes.ts';
import { BorrowerService } from './modules/borrower/borrower.service.ts';
import { breRouter } from './modules/bre/bre.routes.ts';
import { healthRouter } from './modules/health/health.routes.ts';
import { LoanRepository } from './modules/loans/loan.repository.ts';
import { OpsController } from './modules/ops/ops.controller.ts';
import { opsRouter } from './modules/ops/ops.routes.ts';
import { OpsService } from './modules/ops/ops.service.ts';
import { UserRepository } from './modules/users/user.repository.ts';
import { buildOpenApiDocument } from './openapi/document.ts';

export type AppDeps = { storage: ObjectStorage; clock?: Clock };

/** Composition root: wires repositories → services → controllers → routers. No `listen` here, so tests import it. */
export function createApp({ storage, clock = systemClock }: AppDeps): Express {
  const users = new UserRepository();
  const loans = new LoanRepository();
  const auth = new AuthController(new AuthService(users));
  const borrower = new BorrowerController(new BorrowerService(users, loans, storage, clock));
  const ops = new OpsController(new OpsService(users, loans, storage, clock));
  const openApi = buildOpenApiDocument();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the Next.js rewrite / platform load balancer

  app.use(requestLogger);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(healthRouter());
  api.get('/openapi.json', (_req, res) => res.json(openApi));
  api.use('/auth', authRouter(auth));
  api.use('/bre', breRouter());
  api.use('/borrower', borrowerRouter(borrower));
  api.use('/ops', opsRouter(ops));
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
