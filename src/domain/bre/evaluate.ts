import type { EmploymentMode } from '../enums.ts';
import { completedYears } from '../../lib/time.ts';
import type { RuleDef, RuleSet } from './rules.ts';

/** What the borrower declared. Salary in paise, dates as `YYYY-MM-DD`. */
export type Application = {
  pan: string;
  dob: string;
  monthlySalaryPaise: number;
  employmentMode: EmploymentMode;
};

/** Derived values the rules run against. Salary in whole rupees, as the rules are written. */
export type Facts = { age: number; monthlySalary: number; pan: string; employmentMode: string };

export type BreFailure = { rule: string; message: string };
export type BreDecision = {
  passed: boolean;
  failures: BreFailure[];
  rulesVersion: number;
  facts: Facts;
  evaluatedAt: Date;
};

export function deriveFacts(app: Application, today: string): Facts {
  return {
    age: completedYears(app.dob, today),
    monthlySalary: app.monthlySalaryPaise / 100,
    pan: app.pan.trim().toUpperCase(),
    employmentMode: app.employmentMode,
  };
}

const evaluators: { [T in RuleDef['type']]: (rule: Extract<RuleDef, { type: T }>, facts: Facts) => boolean } =
  {
    RANGE: (r, f) =>
      (r.min === undefined || f[r.field] >= r.min) && (r.max === undefined || f[r.field] <= r.max),
    REGEX: (r, f) => new RegExp(r.pattern).test(f[r.field]),
    NOT_IN: (r, f) => !r.values.includes(f[r.field]),
  };

function passes(rule: RuleDef, facts: Facts): boolean {
  // The mapped type above guarantees each evaluator gets its own rule shape.
  return (evaluators[rule.type] as (r: RuleDef, f: Facts) => boolean)(rule, facts);
}

/** Runs every rule and returns all failures together, so the borrower can fix everything in one go. */
export function evaluate(ruleSet: RuleSet, facts: Facts, evaluatedAt: Date): BreDecision {
  const failures = ruleSet.rules
    .filter((rule) => !passes(rule, facts))
    .map((rule) => ({ rule: rule.id, message: rule.message }));
  return { passed: failures.length === 0, failures, rulesVersion: ruleSet.version, facts, evaluatedAt };
}
