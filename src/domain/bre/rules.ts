import { EmploymentMode } from '../enums.ts';

/**
 * Eligibility rules as data. The evaluator knows rule *types*; values live here.
 * Changing a threshold = edit this object and bump `version`. See docs/design/adr/0004.
 */
export type RuleDef =
  | { id: string; type: 'RANGE'; field: 'age' | 'monthlySalary'; min?: number; max?: number; message: string }
  | { id: string; type: 'REGEX'; field: 'pan'; pattern: string; message: string }
  | { id: string; type: 'NOT_IN'; field: 'employmentMode'; values: string[]; message: string };

export type RuleSet = { version: number; rules: RuleDef[] };

export const BRE_RULES: RuleSet = {
  version: 1,
  rules: [
    { id: 'AGE', type: 'RANGE', field: 'age', min: 23, max: 50, message: 'Age must be between 23 and 50' },
    {
      id: 'SALARY',
      type: 'RANGE',
      field: 'monthlySalary',
      min: 25_000,
      message: 'Monthly salary must be at least ₹25,000',
    },
    {
      id: 'PAN',
      type: 'REGEX',
      field: 'pan',
      pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$',
      message: 'PAN format is invalid',
    },
    {
      id: 'EMPLOYMENT',
      type: 'NOT_IN',
      field: 'employmentMode',
      values: [EmploymentMode.UNEMPLOYED],
      message: 'Unemployed applicants are not eligible',
    },
  ],
};
