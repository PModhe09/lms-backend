import { z } from 'zod';

export const RuleDefDto = z
  .discriminatedUnion('type', [
    z.object({
      id: z.string(),
      type: z.literal('RANGE'),
      field: z.enum(['age', 'monthlySalary']),
      min: z.number().optional(),
      max: z.number().optional(),
      message: z.string(),
    }),
    z.object({
      id: z.string(),
      type: z.literal('REGEX'),
      field: z.literal('pan'),
      pattern: z.string(),
      message: z.string(),
    }),
    z.object({
      id: z.string(),
      type: z.literal('NOT_IN'),
      field: z.literal('employmentMode'),
      values: z.array(z.string()),
      message: z.string(),
    }),
  ])
  .meta({ id: 'RuleDef' });

export const RuleSetDto = z
  .object({ version: z.number(), rules: z.array(RuleDefDto) })
  .meta({ id: 'RuleSet' });
