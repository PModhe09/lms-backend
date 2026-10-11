import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, NotFoundError, ValidationError } from '../domain/errors.ts';

export const notFound: RequestHandler = () => {
  throw new NotFoundError('Route not found');
};

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new ValidationError(err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  // body-parser: malformed JSON or body over the size limit.
  if (typeof err === 'object' && err !== null && 'type' in err) {
    if (err.type === 'entity.parse.failed') return new ValidationError(undefined, 'Malformed JSON body');
    if (err.type === 'entity.too.large')
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  }
  return null;
}

/** Single place that turns errors into the envelope from docs/design/04-api-contract.md. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  if (!appError) {
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Something went wrong' },
      requestId: req.id,
    });
    return;
  }
  if (appError.status >= 500) req.log.error({ err }, appError.message);
  res.status(appError.status).json({
    error: { code: appError.code, message: appError.message, details: appError.details },
    requestId: req.id,
  });
};
