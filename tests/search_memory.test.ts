import { describe, expect, test } from "vitest";

import {
  PARTIAL_INDEX_PREFIX,
  buildProgress,
} from "../src/search_memory";

/**
 * `buildProgress` is the one piece of the alarm-driven build that is pure —
 * everything else in this file talks to GitHub through `currentChunks`, so
 * it is covered by the integration suite instead, where a real repository
 * makes the network calls truthful rather than mocked.
 *
 * What this decides is exactly what an alarm needs to know: keep
 * rescheduling itself, or stop. Getting it wrong either way is a real
 * failure — stopping early leaves an index permanently partial with nothing
 * left to notice; never stopping leaves a Durable Object alarm scheduling
 * itself forever after the work is actually done.
 */

describe("deciding whether a batch finished the build", () => {
  test("up_to_date is complete, with no reason", () => {
    expect(
      buildProgress({ mode: "up_to_date", reason: "should be ignored" }),
    ).toEqual({ complete: true, reason: null });
  });

  test("a null reason on a non-up_to_date mode is complete", () => {
    // The shape currentChunks returns once a full or incremental build has
    // just finished this round: mode stays "full"/"incremental", but
    // reason is null because there is nothing left to report.
    expect(buildProgress({ mode: "full", reason: null })).toEqual({
      complete: true,
      reason: null,
    });
  });

  test("an informational reason without the partial prefix is complete", () => {
    // "Index complete: N files." is non-null but not a caveat — it must not
    // be read as "keep going".
    const reason = "Index complete: 114 files.";
    expect(buildProgress({ mode: "full", reason })).toEqual({
      complete: true,
      reason,
    });
  });

  test("a PARTIAL INDEX reason on full mode means keep going", () => {
    const reason = `${PARTIAL_INDEX_PREFIX}Indexed 12 of 114 files so far.`;
    expect(buildProgress({ mode: "full", reason })).toEqual({
      complete: false,
      reason,
    });
  });

  test("a PARTIAL INDEX reason on incremental mode also means keep going", () => {
    // The bug this exists to close: an incomplete incremental build used to
    // report no caveat at all, because the surfacing logic only checked
    // mode === "full". buildProgress must not repeat that mistake.
    const reason = `${PARTIAL_INDEX_PREFIX}3 changed file(s) still to index.`;
    expect(buildProgress({ mode: "incremental", reason })).toEqual({
      complete: false,
      reason,
    });
  });
});
