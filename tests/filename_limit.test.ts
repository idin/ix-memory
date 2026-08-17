import { describe, expect, test } from "vitest";

import {
  assertFilenameFits,
  MAXIMUM_FILENAME_LENGTH,
} from "../src/filename_limit";
import { buildMessageFilename } from "../src/messages";
import { pathForTopic } from "../src/topics";

/**
 * The limit exists to stop names being silently cut, so most of what matters
 * here is what happens at the boundary rather than the number itself.
 */

const AT_THE_LIMIT = "a".repeat(MAXIMUM_FILENAME_LENGTH);
const OVER_THE_LIMIT = "a".repeat(MAXIMUM_FILENAME_LENGTH + 1);

describe("assertFilenameFits", () => {
  test("a name at the limit is allowed", () => {
    expect(assertFilenameFits(AT_THE_LIMIT, "test")).toBe(AT_THE_LIMIT);
  });

  test("a name over the limit throws rather than being trimmed", () => {
    expect(() => assertFilenameFits(OVER_THE_LIMIT, "test")).toThrow();
  });

  test("the error says how long it was, and how long is allowed", () => {
    // A message saying only "too long" leaves the caller guessing at how much
    // to cut.
    expect(() => assertFilenameFits(OVER_THE_LIMIT, "test")).toThrow(
      new RegExp(`${MAXIMUM_FILENAME_LENGTH + 1}.*${MAXIMUM_FILENAME_LENGTH}`),
    );
  });

  test("the error names what the caller was doing", () => {
    expect(() => assertFilenameFits(OVER_THE_LIMIT, "A subject of \"rivers\"")).toThrow(
      /A subject of "rivers"/,
    );
  });

  test("the error quotes the name, so it can be shortened deliberately", () => {
    expect(() => assertFilenameFits(OVER_THE_LIMIT, "test")).toThrow(/The name was:/);
  });
});

describe("message filenames are no longer truncated", () => {
  const now = Date.parse("2026-02-03T09:14:22.000Z");

  test("a long subject survives whole", () => {
    // The old behaviour sliced the slug at 48 characters. Four files in the
    // memory repo carry names cut exactly there, mid-word.
    const subject =
      "drive writes are blocked because the service account has no storage quota";
    const filename = buildMessageFilename("kip", subject, now);

    expect(filename).toContain("service_account_has_no_storage_quota");
    expect(filename.length).toBeLessThanOrEqual(MAXIMUM_FILENAME_LENGTH);
  });

  test("a subject too long to fit throws rather than being cut", () => {
    expect(() => buildMessageFilename("kip", "word ".repeat(60), now)).toThrow(
      /Shorten it/,
    );
  });

  test("the timestamp and sender count against the limit", () => {
    // They spend roughly 32 characters before the subject gets a look in.
    // Measuring only the slug means the real budget is whatever is left, which
    // nothing was checking.
    const justOverOnceThePrefixCounts = "a".repeat(MAXIMUM_FILENAME_LENGTH - 20);
    expect(() =>
      buildMessageFilename("kip", justOverOnceThePrefixCounts, now),
    ).toThrow();
  });
});

describe("created files are subject to the same limit", () => {
  const now = Date.parse("2026-02-03T09:14:22.000Z");

  test("an ordinary subject is unaffected", () => {
    expect(pathForTopic("fact", "kitchen appliances", now)).toBe(
      "other-memory/facts/kitchen_appliances.md",
    );
  });

  test("a subject too long to fit throws", () => {
    expect(() => pathForTopic("fact", "word ".repeat(60), now)).toThrow(
      /Shorten it/,
    );
  });

  test("directories do not count against the filename", () => {
    // A subject with slashes becomes folders. Those are part of the path, not
    // of the name that has to fit, so a deep subject is not penalised.
    const deep = `${"a/".repeat(20)}kitchen`;
    expect(() => pathForTopic("fact", deep, now)).not.toThrow();
  });

  test("the date counts against a dated filename", () => {
    const nearTheLimit = "a".repeat(MAXIMUM_FILENAME_LENGTH - 5);
    expect(() => pathForTopic("todo", nearTheLimit, now)).toThrow();
  });
});
