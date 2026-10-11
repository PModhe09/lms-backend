/**
 * Every error the API means to return is an AppError. The error handler maps it to
 * `{ error: { code, message, details }, requestId }`. Anything else is a bug and becomes a 500.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400: the request does not match the schema. */
export class ValidationError extends AppError {
  constructor(details?: unknown, message = 'Request validation failed') {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

/** 401: no session, or the session is invalid or expired. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

/** 403: logged in, but the role lacks the permission. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(403, 'FORBIDDEN', message);
  }
}

/** 404: not found, or exists but the caller may not know it exists. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

/** 409: conflicts with current state (duplicate key, stale status, open loan exists). */
export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}

/** 422: well-formed, but a business rule says no. */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, code, message, details);
  }
}
