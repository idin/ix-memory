/**
 * Ages are computed, never stored.
 *
 * A stored age is wrong within a year and there is nothing in the file to say
 * so. A stored birth date is never wrong. So memory holds the date, and this
 * derives the rest.
 *
 * How an age is phrased is decided here rather than by whoever is reading the
 * file, so two answers about the same subject always agree.
 */

/**
 * A birth or creation date, as precisely as it is known. Recording `2013`
 * when only the year is known is honest; guessing a day is not.
 */
export type PartialDate = {
  year: number;
  /** 1-12. Absent when only the year is known. */
  month?: number;
  /** 1-31. Absent unless the exact day is known. */
  day?: number;
};

/**
 * Below this, an age reads in years and months, because the months still
 * carry information. Above it, months are noise. Six years is where "five
 * years and three months" starts sounding like a parent describing a child.
 */
const MONTHS_MATTER_BELOW_YEARS = 6;

/** Parse `2013-05-06`, `2013-05` or `2013`. Rejects anything else. */
export function parsePartialDate(value: string): PartialDate {
  const trimmed = value.trim();

  const full = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) {
    const [, year, month, day] = full;
    const parsed = {
      year: Number(year),
      month: Number(month),
      day: Number(day),
    };
    assertRealDate(parsed, trimmed);
    return parsed;
  }

  const yearMonth = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    const [, year, month] = yearMonth;
    const parsed = { year: Number(year), month: Number(month) };
    assertRealDate(parsed, trimmed);
    return parsed;
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) {
    return { year: Number(yearOnly[1]) };
  }

  throw new Error(
    `Not a date this understands: "${value}". Use YYYY-MM-DD, YYYY-MM or YYYY.`,
  );
}

function assertRealDate(date: PartialDate, original: string): void {
  if (date.month !== undefined && (date.month < 1 || date.month > 12)) {
    throw new Error(`Month out of range in "${original}".`);
  }
  if (date.day !== undefined) {
    const monthLength = new Date(
      Date.UTC(date.year, (date.month ?? 1), 0),
    ).getUTCDate();
    if (date.day < 1 || date.day > monthLength) {
      throw new Error(`Day out of range in "${original}".`);
    }
  }
}

export type Age = {
  years: number;
  months: number;
  /** True when the date was partial, so the age is approximate. */
  approximate: boolean;
};

/**
 * Age at `asOf`, in whole years and the remaining whole months.
 *
 * A missing month or day is treated as the start of the period, which
 * systematically rounds an unknown-precision age *up* rather than guessing a
 * midpoint. Callers are told it is approximate so they can say so.
 */
export function ageAt(birth: PartialDate, asOf: Date): Age {
  const approximate = birth.month === undefined || birth.day === undefined;

  const birthYear = birth.year;
  const birthMonth = (birth.month ?? 1) - 1;
  const birthDay = birth.day ?? 1;

  let years = asOf.getUTCFullYear() - birthYear;
  let months = asOf.getUTCMonth() - birthMonth;

  if (asOf.getUTCDate() < birthDay) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) {
    throw new Error("That date is in the future.");
  }

  return { years, months, approximate };
}

/**
 * An age as a phrase. Years and months while the months still say something,
 * years alone after that.
 */
export function describeAge(birth: PartialDate, asOf: Date): string {
  const age = ageAt(birth, asOf);
  const about = age.approximate ? "about " : "";

  if (age.years === 0) {
    return `${about}${plural(age.months, "month")}`;
  }
  if (age.years < MONTHS_MATTER_BELOW_YEARS && age.months > 0) {
    return `${about}${plural(age.years, "year")} and ${plural(age.months, "month")}`;
  }
  return `${about}${plural(age.years, "year")}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
