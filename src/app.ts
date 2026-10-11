import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler, notFound } from './middleware/error-handler.ts';
import { requestLogger } from './middleware/request-logger.ts';
import { AuthController } from './modules/auth/auth.controller.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { AuthService } from './modules/auth/auth.service.ts';
import { UserRepository } from './modules/auth/user.repository.ts';
import { healthRouter } from './modules/health/health.routes.ts';
import { buildOpenApiDocument } from './openapi/document.ts';

/** Composition root: wires repositories → services → controllers → routers. No `listen` here, so tests import it. */
export function createApp(): Express {
  const users = new UserRepository();
  const auth = new AuthController(new AuthService(users));
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
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
