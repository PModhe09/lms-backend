import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

export const registry = new OpenAPIRegistry();

export const ErrorEnvelope = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
    requestId: z.string(),
  })
  .meta({ id: 'ErrorEnvelope' });

const DESCRIPTIONS: Record<number, string> = {
  400: 'Request does not match the schema',
  401: 'Not logged in',
  403: 'Role lacks permission',
  404: 'Not found',
  409: 'Conflicts with current state',
  422: 'Business rule violated',
};

export function errorResponses(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((s) => [
      s,
      { description: DESCRIPTIONS[s] ?? 'Error', content: { 'application/json': { schema: ErrorEnvelope } } },
    ]),
  );
}

export const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
