import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.ts';
// Each module registers its paths on import.
import '../modules/auth/auth.openapi.ts';
import '../modules/health/health.openapi.ts';

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'LMS API',
      version: '0.1.0',
      description: 'Loan Management System. All money fields are integer paise.',
    },
    servers: [{ url: '/api' }],
  });
}
