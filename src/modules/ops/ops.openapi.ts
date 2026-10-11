import { z } from 'zod';
import { LoanWithPaymentsDto } from '../borrower/borrower.schemas.ts';
import { LoanDto, PaymentDto } from '../loans/loan.dto.ts';
import { errorResponses, json, registry } from '../../openapi/registry.ts';
import { PageQuery } from '../shared/http.ts';
import {
  LeadPage,
  LeadsQuery,
  LoanPage,
  PaymentResult,
  RecordPaymentBody,
  RejectBody,
  SlipUrl,
} from './ops.schemas.ts';

const id = z.object({ id: z.string() });
const reg = (
  method: 'get' | 'post',
  path: string,
  tag: string,
  summary: string,
  ok: { status: number; schema: z.ZodType },
  extra: { body?: z.ZodType; query?: z.ZodObject; params?: boolean; errors?: number[] } = {},
) =>
  registry.registerPath({
    method,
    path,
    tags: [tag],
    summary,
    request: {
      ...(extra.body && { body: json(extra.body) }),
      ...(extra.query && { query: extra.query }),
      ...(extra.params && { params: id }),
    },
    responses: {
      [ok.status]: { description: 'OK', ...json(ok.schema) },
      ...errorResponses(401, 403, ...(extra.errors ?? [])),
    },
  });

reg(
  'get',
  '/ops/sales/leads',
  'sales',
  'Borrowers who have not applied',
  { status: 200, schema: LeadPage },
  { query: LeadsQuery },
);

reg(
  'get',
  '/ops/sanction/loans',
  'sanction',
  'Loans awaiting a decision (APPLIED)',
  { status: 200, schema: LoanPage },
  { query: PageQuery },
);
reg(
  'get',
  '/ops/sanction/loans/{id}/salary-slip',
  'sanction',
  'Presigned 5-minute URL for the slip',
  { status: 200, schema: SlipUrl },
  { params: true, errors: [404] },
);
reg(
  'post',
  '/ops/sanction/loans/{id}/approve',
  'sanction',
  'APPLIED → SANCTIONED',
  { status: 200, schema: LoanWithPaymentsDto },
  { params: true, errors: [404, 409] },
);
reg(
  'post',
  '/ops/sanction/loans/{id}/reject',
  'sanction',
  'APPLIED → REJECTED with a reason',
  { status: 200, schema: LoanWithPaymentsDto },
  { params: true, body: RejectBody, errors: [400, 404, 409] },
);

reg(
  'get',
  '/ops/disbursement/loans',
  'disbursement',
  'Loans awaiting disbursement (SANCTIONED)',
  { status: 200, schema: LoanPage },
  { query: PageQuery },
);
reg(
  'post',
  '/ops/disbursement/loans/{id}/disburse',
  'disbursement',
  'SANCTIONED → DISBURSED',
  { status: 200, schema: LoanWithPaymentsDto },
  { params: true, errors: [404, 409] },
);

reg(
  'get',
  '/ops/collection/loans',
  'collection',
  'Active loans (DISBURSED) with outstanding',
  { status: 200, schema: LoanPage },
  { query: PageQuery },
);
reg(
  'get',
  '/ops/collection/loans/{id}/payments',
  'collection',
  'Payment history',
  { status: 200, schema: z.array(PaymentDto) },
  { params: true, errors: [404] },
);
reg(
  'post',
  '/ops/collection/loans/{id}/payments',
  'collection',
  'Record a payment; closes the loan when fully paid',
  { status: 201, schema: PaymentResult },
  { params: true, body: RecordPaymentBody, errors: [400, 404, 409, 422] },
);

reg(
  'get',
  '/ops/loans/{id}',
  'ops',
  'Loan detail with borrower, BRE result, history and payments',
  { status: 200, schema: LoanWithPaymentsDto },
  { params: true, errors: [404] },
);

export { LoanDto };
