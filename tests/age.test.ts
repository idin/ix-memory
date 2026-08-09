import { describe, expect, test } from "vitest";

import { ageAt, describeAge, parsePartialDate } from "../src/age";

/**
 * These tests are what make "never store an age" safe to rely on. If the
 * computation is wrong, storing the date is worse than storing the age,
 * because nobody checks a number that looks derived.
 */

const NOW = new Date("2026-08-09T12:00:00Z");

describe("parsePartialDate", () => {
  test("reads a full date", () => {
    expect(parsePartialDate("2013-05-06")).toEqual({
      year: 2013,
      month: 5,
      day: 6,
    });
  });

  test("reads a year and month", () => {
    expect(parsePartialDate("2013-05")).toEqual({ year: 2013, month: 5 });
  });

  test("reads a year alone", () => {
    expect(parsePartialDate("2013")).toEqual({ year: 2013 });
  });

  test("tolerates surrounding whitespace", () => {
    expect(parsePartialDate("  2013-05-06  ")).toEqual({
      year: 2013,
      month: 5,
      day: 6,
    });
  });

  test.each([
    ["a written month", "May 2013"],
    ["day-first", "06-05-2013"],
    ["a two-digit year", "13-05-06"],
    ["month out of range", "2013-13-01"],
    ["day out of range", "2013-02-30"],
    ["empty", ""],
    ["not a date", "sometime in 2013"],
  ])("rejects %s: %s", (_name, value) => {
    expect(() => parsePartialDate(value)).toThrow();
  });

  test("accepts a leap day in a leap year", () => {
    expect(() => parsePartialDate("2024-02-29")).not.toThrow();
  });

  test("rejects a leap day in a non-leap year", () => {
    expect(() => parsePartialDate("2023-02-29")).toThrow();
  });
});

describe("ageAt", () => {
  test("Frodo, born 2013-05-06, is 13 years and 3 months in August 2026", () => {
    expect(ageAt(parsePartialDate("2013-05-06"), NOW)).toEqual({
      years: 13,
      months: 3,
      approximate: false,
    });
  });

  test("the day before a birthday is still the younger year", () => {
    const age = ageAt(parsePartialDate("2013-08-10"), NOW);
    expect(age.years).toBe(12);
    expect(age.months).toBe(11);
  });

  test("on the birthday itself the year ticks over", () => {
    expect(ageAt(parsePartialDate("2013-08-09"), NOW).years).toBe(13);
  });

  test("a newborn is zero years and zero months", () => {
    expect(ageAt(parsePartialDate("2026-08-09"), NOW)).toEqual({
      years: 0,
      months: 0,
      approximate: false,
    });
  });

  test("a partial date is flagged approximate", () => {
    expect(ageAt(parsePartialDate("2013"), NOW).approximate).toBe(true);
    expect(ageAt(parsePartialDate("2013-05"), NOW).approximate).toBe(true);
    expect(ageAt(parsePartialDate("2013-05-06"), NOW).approximate).toBe(false);
  });

  test("a future date throws rather than returning a negative age", () => {
    expect(() => ageAt(parsePartialDate("2030-01-01"), NOW)).toThrow(/future/);
  });

  test("months never exceed eleven", () => {
    // Every day of one year, to catch borrow-arithmetic mistakes.
    for (let offset = 0; offset < 365; offset += 1) {
      const birth = new Date(Date.UTC(2020, 0, 1 + offset));
      const iso = birth.toISOString().slice(0, 10);
      const age = ageAt(parsePartialDate(iso), NOW);
      expect(age.months).toBeGreaterThanOrEqual(0);
      expect(age.months).toBeLessThanOrEqual(11);
    }
  });
});

describe("describeAge decides the phrasing, not the caller", () => {
  test("under six years, months are included", () => {
    expect(describeAge(parsePartialDate("2022-05-09"), NOW)).toBe(
      "4 years and 3 months",
    );
  });

  test("six years and over, months are dropped", () => {
    expect(describeAge(parsePartialDate("2020-05-09"), NOW)).toBe("6 years");
  });

  test("Frodo reads as years alone", () => {
    expect(describeAge(parsePartialDate("2013-05-06"), NOW)).toBe("13 years");
  });

  test("under a year reads in months", () => {
    expect(describeAge(parsePartialDate("2026-02-09"), NOW)).toBe("6 months");
  });

  test("exact months are dropped when zero", () => {
    expect(describeAge(parsePartialDate("2022-08-09"), NOW)).toBe("4 years");
  });

  test("singulars are not pluralized", () => {
    expect(describeAge(parsePartialDate("2025-07-09"), NOW)).toBe(
      "1 year and 1 month",
    );
  });

  test("a partial date says so", () => {
    expect(describeAge(parsePartialDate("2013"), NOW)).toMatch(/^about /);
  });

  test("a full date does not hedge", () => {
    expect(describeAge(parsePartialDate("2013-05-06"), NOW)).not.toMatch(
      /^about /,
    );
  });
});
