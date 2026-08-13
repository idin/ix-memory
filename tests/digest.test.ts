import { describe, expect, test } from "vitest";

import { digestedNote } from "../src/digest";
import {
  describeMisjudgementState,
  DIGEST_RECOMMENDED_AT,
  DIGESTED_MARKER,
} from "../src/misjudgements";

/**
 * The digest exists so the misjudgement log is a control loop rather than a
 * confessional. Most of what matters is that entries cannot quietly resurface
 * forever, and that a count nobody acts on does not become a number nobody
 * reads.
 */

describe("describeMisjudgementState", () => {
  test("says nothing when there is nothing undigested", () => {
    // A line on every tool response saying "0 undigested" is noise, and noise
    // is what gets skimmed past on the call where it mattered.
    expect(
      describeMisjudgementState({ total: 9, undigested: 0, recommendation: null }),
    ).toBeNull();
  });

  test("reports a small count without recommending anything", () => {
    const note = describeMisjudgementState({
      total: 3,
      undigested: 3,
      recommendation: null,
    });
    expect(note).toBe("3 undigested misjudgements.");
  });

  test("a single entry reads as singular", () => {
    const note = describeMisjudgementState({
      total: 1,
      undigested: 1,
      recommendation: null,
    });
    expect(note).toBe("1 undigested misjudgement.");
  });

  test("passes the recommendation through once the threshold is reached", () => {
    const note = describeMisjudgementState({
      total: 14,
      undigested: 14,
      recommendation: "14 undigested misjudgements. Worth a digest.",
    });
    expect(note).toContain("Worth a digest");
  });

  test("the threshold is high enough for a pattern to be distinguishable", () => {
    // Below roughly ten there is usually not enough repetition to tell a
    // pattern from a coincidence, which is the distinction a digest makes.
    expect(DIGEST_RECOMMENDED_AT).toBeGreaterThanOrEqual(5);
  });
});

describe("digestedNote", () => {
  test("an entry that produced nothing is still marked", () => {
    // Otherwise the same entries resurface at every future digest, the count
    // never falls, and a number that only grows stops being read.
    const note = digestedNote({ date: "2026-08-13", produced: [] });
    expect(note).toContain(DIGESTED_MARKER);
    expect(note).toContain("no rule emitted");
  });

  test("an entry that produced something names what it produced", () => {
    const note = digestedNote({
      date: "2026-08-13",
      produced: ["capture_rules/check_before_asserting.md"],
    });
    expect(note).toContain("capture_rules/check_before_asserting.md");
  });

  test("the note carries the date, so recurrence can be dated", () => {
    expect(digestedNote({ date: "2026-08-13", produced: [] })).toContain(
      "2026-08-13",
    );
  });

  test("a produced note says what a recurrence would mean", () => {
    // The single most useful signal in the log, and the easiest to miss: a
    // pattern appearing after a rule was written to prevent it means the rule
    // failed.
    const note = digestedNote({
      date: "2026-08-13",
      produced: ["some rule"],
    });
    expect(note).toContain("did not work");
  });

  test("both kinds of note carry the marker that counting relies on", () => {
    // The state lives in the files. An index would be a second thing to keep
    // true, and the first time it disagreed nobody would know which to believe.
    expect(digestedNote({ date: "2026-08-13", produced: [] })).toContain(
      DIGESTED_MARKER,
    );
    expect(digestedNote({ date: "2026-08-13", produced: ["x"] })).toContain(
      DIGESTED_MARKER,
    );
  });
});
