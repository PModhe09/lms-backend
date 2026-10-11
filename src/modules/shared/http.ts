import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { NotFoundError } from '../../domain/errors.ts';

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), page: z.number(), limit: z.number(), total: z.number() });

export type Page<T> = { items: T[]; page: number; limit: number; total: number };

/** A malformed id cannot exist, so it is a 404 like any other missing resource (no id probing via 400 vs 404). */
export function parseObjectId(raw: unknown): string {
  if (typeof raw !== 'string' || !isValidObjectId(raw) || !/^[a-f0-9]{24}$/i.test(raw))
    throw new NotFoundError();
  return raw;
}

export const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) });

export const isoDate = z.iso.date();
