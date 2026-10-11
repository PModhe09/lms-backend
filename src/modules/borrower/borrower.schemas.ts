import { z } from 'zod';
import { EMPLOYMENT_MODES, ONBOARDING_STAGES } from '../../domain/enums.ts';
import { LOAN_LIMITS } from '../../domain/money.ts';
import { BreResultDto, LoanDto, PaymentDto, SalarySlipDto } from '../loans/loan.dto.ts';
import { isoDate } from '../shared/http.ts';

/**
 * Shape checks only (400). Eligibility (age, salary, PAN format, employment) is the BRE's job (422),
 * so a well-formed but ineligible application is recorded with its reasons.
 */
export const ProfileBody = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    pan: z
      .string()
      .trim()
      .max(10)
      .transform((s) => s.toUpperCase()),
    dob: isoDate,
    monthlySalaryPaise: z.number().int().min(0).max(1_000_000_000),
    employmentMode: z.enum(EMPLOYMENT_MODES),
  })
  .meta({ id: 'ProfileBody' });

export const ProfileDto = z
  .object({
    onboardingStage: z.enum(ONBOARDING_STAGES),
    profile: z
      .object({
        fullName: z.string(),
        pan: z.string(),
        dob: z.iso.date(),
        monthlySalaryPaise: z.number(),
        employmentMode: z.enum(EMPLOYMENT_MODES),
      })
      .optional(),
    salarySlip: SalarySlipDto.optional(),
    breResult: BreResultDto.optional(),
  })
  .meta({ id: 'BorrowerProfile' });

/** Only principal and tenure. Interest and total are always computed by the server; extra keys are stripped. */
export const ApplyBody = z
  .object({
    principalPaise: z.number().int().min(LOAN_LIMITS.minPrincipalPaise).max(LOAN_LIMITS.maxPrincipalPaise),
    tenureDays: z.number().int().min(LOAN_LIMITS.minTenureDays).max(LOAN_LIMITS.maxTenureDays),
  })
  .meta({ id: 'ApplyBody' });

export const LoanWithPaymentsDto = LoanDto.extend({ payments: z.array(PaymentDto) }).meta({
  id: 'LoanWithPayments',
});

export type ProfileBody = z.infer<typeof ProfileBody>;
export type ProfileDto = z.infer<typeof ProfileDto>;
export type ApplyBody = z.infer<typeof ApplyBody>;

export const ConfirmSlipBody = z
  .object({
    key: z.string().min(1).max(200),
    originalName: z.string().trim().max(200).default('salary-slip'),
  })
  .meta({ id: 'ConfirmSlipBody' });

export const UploadOptionsDto = z
  .object({
    mode: z.enum(['direct', 'server']),
    maxBytes: z.number(),
    contentTypes: z.array(z.string()),
    keyPrefix: z.string(),
  })
  .meta({ id: 'UploadOptions' });
