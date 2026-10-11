import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { EMPLOYMENT_MODES, ONBOARDING_STAGES, ROLES } from '../../domain/enums.ts';

const BorrowerProfileSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    pan: { type: String, required: true, uppercase: true },
    dob: { type: Date, required: true },
    monthlySalaryPaise: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR', required: true },
    employmentMode: { type: String, enum: EMPLOYMENT_MODES, required: true },
  },
  { _id: false },
);

export const SalarySlipSchema = new Schema(
  {
    key: { type: String, required: true },
    mime: { type: String, enum: ['application/pdf', 'image/jpeg', 'image/png'], required: true },
    size: { type: Number, required: true },
    originalName: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const BreResultSchema = new Schema(
  {
    passed: { type: Boolean, required: true },
    failures: [
      { _id: false, rule: { type: String, required: true }, message: { type: String, required: true } },
    ],
    rulesVersion: { type: Number, required: true },
    facts: { type: Schema.Types.Mixed, required: true },
    evaluatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    /** Borrowers only. Drives the portal stepper and the Sales leads list. */
    onboardingStage: { type: String, enum: ONBOARDING_STAGES },
    borrowerProfile: { type: BorrowerProfileSchema },
    salarySlip: { type: SalarySlipSchema },
    breResult: { type: BreResultSchema },
  },
  { timestamps: true },
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ 'borrowerProfile.pan': 1 }, { unique: true, sparse: true });
UserSchema.index({ role: 1, onboardingStage: 1, createdAt: -1 });

export type User = InferSchemaType<typeof UserSchema>;
export type UserDocument = HydratedDocument<User>;
export const UserModel = model('User', UserSchema);
