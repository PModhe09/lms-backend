import { Router } from 'express';
import { pingMongo } from '../../infra/mongo.ts';

export function healthRouter(): Router {
  const router = Router();
  router.get('/healthz', async (_req, res) => {
    const mongo = await pingMongo();
    res.status(mongo ? 200 : 503).json({ status: mongo ? 'ok' : 'degraded', mongo });
  });
  return router;
}
