import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LOAN_STATUSES, OPEN_LOAN_STATUSES } from '../../domain/loan/status.ts';
import { SalarySlipSchema } from './user.model.ts';

const StatusChangeSchema = new Schema(
  {
    from: { type: String, enum: [...LOAN_STATUSES, null], default: null },
    to: { type: String, enum: LOAN_STATUSES, required: true },
    /** User id as a string, or 'SYSTEM' for automatic transitions. */
    by: { type: String, required: true },
    at: { type: Date, required: true },
    note: { type: String },
  },
  { _id: false },
);

const LoanSchema = new Schema(
  {
    borrowerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    principalPaise: { type: Number, required: true },
    tenureDays: { type: Number, required: true },
    rateBps: { type: Number, required: true },
    interestPaise: { type: Number, required: true },
    totalRepaymentPaise: { type: Number, required: true },
    amountPaidPaise: { type: Number, required: true, default: 0 },
    currency: { type: String, enum: ['INR'], required: true, default: 'INR' },
    status: { type: String, enum: LOAN_STATUSES, required: true },
    /** Snapshot of the slip at apply time; later uploads do not change what this loan was approved on. */
    salarySlip: { type: SalarySlipSchema, required: true },
    rejectionReason: { type: String },
    sanctionedAt: Date,
    sanctionedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    disbursedAt: Date,
    disbursedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    closedAt: Date,
    statusHistory: { type: [StatusChangeSchema], default: [] },
  },
  { timestamps: true },
);

LoanSchema.index({ status: 1, createdAt: -1 });
LoanSchema.index({ borrowerId: 1, createdAt: -1 });
// One open loan per borrower, enforced by the database rather than a read-then-write check.
LoanSchema.index(
  { borrowerId: 1 },
  {
    unique: true,
    name: 'one_open_loan_per_borrower',
    partialFilterExpression: { status: { $in: OPEN_LOAN_STATUSES } },
  },
);

export type Loan = InferSchemaType<typeof LoanSchema>;
export type LoanDocument = HydratedDocument<Loan>;
export const LoanModel = model('Loan', LoanSchema);
