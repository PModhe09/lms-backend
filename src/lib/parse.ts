import type { z } from 'zod';
import { ValidationError } from '../domain/errors.ts';

/**
 * Validates untrusted input at the controller boundary and returns it typed.
 * Unknown keys are stripped by the schemas, so a client cannot smuggle fields like `role` or `totalRepaymentPaise`.
 */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
