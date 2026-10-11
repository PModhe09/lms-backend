import { describe, expect, it } from 'vitest';
import { deriveFacts, evaluate, type Application } from '../src/domain/bre/evaluate.ts';
import { BRE_RULES } from '../src/domain/bre/rules.ts';
import { completedYears, istDate } from '../src/lib/time.ts';

const TODAY = '2026-10-10';
const base: Application = {
  pan: 'ABCDE1234F',
  dob: '1995-06-15',
  monthlySalaryPaise: 5_000_000,
  employmentMode: 'SALARIED',
};
const run = (patch: Partial<Application>) =>
  evaluate(BRE_RULES, deriveFacts({ ...base, ...patch }, TODAY), new Date());
const failed = (patch: Partial<Application>) => run(patch).failures.map((f) => f.rule);

describe('age (completed years, inclusive 23..50)', () => {
  it.each([
    ['2003-10-10', 23, []], // 23rd birthday today: passes
    ['2003-10-11', 22, ['AGE']], // turns 23 tomorrow: fails
    ['1976-10-10', 50, []],
    ['1976-10-11', 49, []], // turns 50 tomorrow
    ['1975-10-10', 51, ['AGE']], // 51st birthday today: fails
  ])('dob %s → age %i', (dob, age, failures) => {
    expect(completedYears(dob, TODAY)).toBe(age);
    expect(failed({ dob })).toEqual(failures);
  });

  it('uses the India calendar day, not UTC', () => {
    // 20:00 UTC on 9 Oct is already 10 Oct in India.
    expect(istDate(new Date('2026-10-09T20:00:00Z'))).toBe('2026-10-10');
  });
});

describe('salary (≥ ₹25,000)', () => {
  it.each([
    [2_499_900, ['SALARY']],
    [2_500_000, []],
  ])('%i paise', (monthlySalaryPaise, failures) => {
    expect(failed({ monthlySalaryPaise })).toEqual(failures);
  });
});

describe('PAN format', () => {
  it.each([
    ['ABCDE1234F', []],
    ['abcde1234f', []], // uppercased before checking
    ['ABCD1234F', ['PAN']],
    ['ABCDE12345', ['PAN']],
    ['ABCDE1234FG', ['PAN']],
  ])('%s', (pan, failures) => {
    expect(failed({ pan })).toEqual(failures);
  });
});

describe('employment', () => {
  it.each([
    ['SALARIED', []],
    ['SELF_EMPLOYED', []],
    ['UNEMPLOYED', ['EMPLOYMENT']],
  ] as const)('%s', (employmentMode, failures) => {
    expect(failed({ employmentMode })).toEqual(failures);
  });
});

it('returns every failure at once with the rules version', () => {
  const decision = run({
    dob: '2010-01-01',
    monthlySalaryPaise: 0,
    pan: 'bad',
    employmentMode: 'UNEMPLOYED',
  });
  expect(decision.passed).toBe(false);
  expect(decision.failures.map((f) => f.rule)).toEqual(['AGE', 'SALARY', 'PAN', 'EMPLOYMENT']);
  expect(decision.rulesVersion).toBe(BRE_RULES.version);
});
