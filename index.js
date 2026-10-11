// Vercel Functions entry. Vercel detects an Express app here and imports its default export.
// The app itself is TypeScript, compiled by `npm run build` (tsc) into dist/; see src/index.ts.
import 'express';

export { default } from './dist/index.js';
