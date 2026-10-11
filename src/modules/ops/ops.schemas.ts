import { z } from 'zod';
import { OnboardingStage } from '../../domain/enums.ts';
import { BorrowerSummaryDto, LoanDto, PaymentDto } from '../loans/loan.dto.ts';
import { isoDate, PageQuery, pageOf } from '../shared/http.ts';

export const RejectBody = z
  .object({ reason: z.string().trim().min(1, 'A reason is required').max(500) })
  .meta({ id: 'RejectBody' });

export const RecordPaymentBody = z
  .object({
    utr: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,30}$/, 'UTR must be 6–30 letters or digits')
      .transform((s) => s.toUpperCase()),
    amountPaise: z.number().int().positive(),
    paidAt: isoDate,
  })
  .meta({ id: 'RecordPaymentBody' });

const LEAD_STAGES = Object.values(OnboardingStage).filter((s) => s !== OnboardingStage.APPLIED) as [
  string,
  ...string[],
];
export const LeadsQuery = PageQuery.extend({ stage: z.enum(LEAD_STAGES).optional() });

export const LeadDto = BorrowerSummaryDto.extend({ registeredAt: z.iso.datetime() }).meta({ id: 'Lead' });

export const LoanPage = pageOf(LoanDto).meta({ id: 'LoanPage' });
export const LeadPage = pageOf(LeadDto).meta({ id: 'LeadPage' });
export const PaymentResult = z.object({ payment: PaymentDto, loan: LoanDto }).meta({ id: 'PaymentResult' });
export const SlipUrl = z.object({ url: z.url(), expiresInSeconds: z.number() }).meta({ id: 'SlipUrl' });

export type RecordPaymentBody = z.infer<typeof RecordPaymentBody>;
export type LeadDto = z.infer<typeof LeadDto>;
