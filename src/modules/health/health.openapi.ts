import { z } from 'zod';
import { registry } from '../../openapi/registry.ts';

const Health = z.object({ status: z.enum(['ok', 'degraded']), mongo: z.boolean() }).meta({ id: 'Health' });

registry.registerPath({
  method: 'get',
  path: '/healthz',
  tags: ['health'],
  summary: 'Liveness and Mongo reachability',
  responses: {
    200: { description: 'Healthy', content: { 'application/json': { schema: Health } } },
    503: { description: 'Mongo unreachable', content: { 'application/json': { schema: Health } } },
  },
});
