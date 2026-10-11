export const Role = {
  ADMIN: 'ADMIN',
  SALES: 'SALES',
  SANCTION: 'SANCTION',
  DISBURSEMENT: 'DISBURSEMENT',
  COLLECTION: 'COLLECTION',
  BORROWER: 'BORROWER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

export const OnboardingStage = {
  REGISTERED: 'REGISTERED',
  BRE_REJECTED: 'BRE_REJECTED',
  DETAILS_SUBMITTED: 'DETAILS_SUBMITTED',
  SLIP_UPLOADED: 'SLIP_UPLOADED',
  APPLIED: 'APPLIED',
} as const;
export type OnboardingStage = (typeof OnboardingStage)[keyof typeof OnboardingStage];
export const ONBOARDING_STAGES = Object.values(OnboardingStage);

export const EmploymentMode = {
  SALARIED: 'SALARIED',
  SELF_EMPLOYED: 'SELF_EMPLOYED',
  UNEMPLOYED: 'UNEMPLOYED',
} as const;
export type EmploymentMode = (typeof EmploymentMode)[keyof typeof EmploymentMode];
export const EMPLOYMENT_MODES = Object.values(EmploymentMode);
