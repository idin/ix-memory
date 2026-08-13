import { describe, expect, test } from "vitest";

import { buildMessageFilename, parseMessageFilename } from "../src/messages";

/**
 * Filenames are constructed by the server, never supplied by a caller. That
 * is deliberate: an agent choosing filenames produces drift, because the next
 * agent will choose differently. These tests are what keeps the convention
 * real rather than aspirational.
 *
 * Shape: <iso-timestamp>_<sender>_<subject-slug>.md
 * Hyphens appear only inside the timestamp; everything else is snake_case.
 */

const WHEN = Date.UTC(2026, 7, 9, 21, 4, 59, 953);

describe("buildMessageFilename", () => {
  test("is timestamp, sender and slug joined by underscores", () => {
    expect(buildMessageFilename("ada", "Open structural issues", WHEN)).toBe(
      "2026-08-09T21-04-59-953Z_ada_open_structural_issues.md",
    );
  });

  test("hyphens appear only inside the timestamp", () => {
    const name = buildMessageFilename("ada", "Re: the drive tool", WHEN);
    const [stamp, ...rest] = name.split("_");
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    expect(rest.join("_")).not.toContain("-");
  });

  test("punctuation in the subject collapses to single underscores", () => {
    expect(buildMessageFilename("kip", "Re: it works!! (finally)", WHEN)).toBe(
      "2026-08-09T21-04-59-953Z_kip_re_it_works_finally.md",
    );
  });

  test("a long subject is kept whole, not truncated", () => {
    // This asserted a slice at 48 characters until 2026-08-13. That was the
    // bug: four files in the memory repo carry names cut exactly there.
    const name = buildMessageFilename("kip", "a".repeat(80), WHEN);
    expect(name.endsWith("_.md")).toBe(false);
    expect(name).toMatch(/_a{80}\.md$/);
  });

  test("a subject of only punctuation still yields a usable name", () => {
    expect(buildMessageFilename("kip", "!!!", WHEN)).toBe(
      "2026-08-09T21-04-59-953Z_kip_message.md",
    );
  });

  test("uppercase and accents are normalized away", () => {
    expect(buildMessageFilename("ada", "CAFÉ Notes", WHEN)).toBe(
      "2026-08-09T21-04-59-953Z_ada_caf_notes.md",
    );
  });
});

describe("parseMessageFilename round-trips what buildMessageFilename writes", () => {
  test("recovers sender and readable subject", () => {
    const name = buildMessageFilename("ada", "Open structural issues", WHEN);
    const parsed = parseMessageFilename(name);
    expect(parsed.sender).toBe("ada");
    expect(parsed.subject).toBe("open structural issues");
  });

  test("recovers the timestamp as a real ISO instant", () => {
    const name = buildMessageFilename("kip", "Anything", WHEN);
    expect(parseMessageFilename(name).sentAt).toBe("2026-08-09T21:04:59.953Z");
    expect(new Date(parseMessageFilename(name).sentAt).getTime()).toBe(WHEN);
  });

  test("a multi-word subject survives the round trip", () => {
    const subject = "binary upload confirmed working";
    const name = buildMessageFilename("ada", subject, WHEN);
    expect(parseMessageFilename(name).subject).toBe(subject);
  });

  test("an unrecognizable filename does not throw", () => {
    // Hand-created files should degrade rather than break the inbox listing.
    const parsed = parseMessageFilename("not-a-real-message.md");
    expect(parsed.sender).toBeDefined();
    expect(parsed.subject).toBeDefined();
  });
});
