import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** Append-only ledger entry. There is no update or delete path anywhere in the API. */
const PaymentSchema = new Schema(
  {
    loanId: { type: Schema.Types.ObjectId, ref: 'Loan', required: true },
    utr: { type: String, required: true, trim: true, uppercase: true },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ['INR'], required: true, default: 'INR' },
    paidAt: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

PaymentSchema.index({ utr: 1 }, { unique: true });
PaymentSchema.index({ loanId: 1, paidAt: 1 });

export type Payment = InferSchemaType<typeof PaymentSchema>;
export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentModel = model('Payment', PaymentSchema);
