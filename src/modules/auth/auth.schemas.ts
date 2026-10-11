import { z } from 'zod';
import { ONBOARDING_STAGES, ROLES } from '../../domain/enums.ts';

const Email = z
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());

/** `role` is not in this schema on purpose: public signup always creates a BORROWER, and unknown keys are stripped. */
export const SignupBody = z
  .object({
    email: Email,
    password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  })
  .meta({ id: 'SignupBody' });

export const LoginBody = z
  .object({
    email: Email,
    password: z.string().min(1).max(72),
  })
  .meta({ id: 'LoginBody' });

export const AuthUser = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.enum(ROLES),
    onboardingStage: z.enum(ONBOARDING_STAGES).optional(),
  })
  .meta({ id: 'AuthUser' });

export type SignupBody = z.infer<typeof SignupBody>;
export type LoginBody = z.infer<typeof LoginBody>;
export type AuthUser = z.infer<typeof AuthUser>;
