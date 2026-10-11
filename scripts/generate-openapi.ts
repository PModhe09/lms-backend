import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '../src/openapi/document.ts';

// Committed at the repo root. The frontend generates its API types from this file.
writeFileSync(
  new URL('../openapi.json', import.meta.url),
  JSON.stringify(buildOpenApiDocument(), null, 2) + '\n',
);
