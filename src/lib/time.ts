/** Business dates are calendar days in India, whatever the server's timezone. */
const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of the instant in Asia/Kolkata. */
export const istDate = (instant: Date): string => IST_DATE.format(instant);

/** Midnight IST of a `YYYY-MM-DD` date, as an instant. */
export const istMidnight = (date: string): Date => new Date(`${date}T00:00:00+05:30`);

/** Completed years between two `YYYY-MM-DD` dates. A birthday on `today` counts as completed. */
export function completedYears(dob: string, today: string): number {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
