import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger.ts';

const SAFE_ID = /^[\w-]{8,64}$/;

/** Assigns `req.id` (reuses a sane incoming `X-Request-Id`), echoes it back, and logs each request with it. */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  // Log only what helps debugging. Headers carry cookies, platform OIDC tokens and proxy signatures.
  serializers: {
    req: (req: { id: string; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
  autoLogging: { ignore: (req) => req.url === '/api/healthz' },
});
