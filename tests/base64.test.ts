import { describe, expect, test } from "vitest";

import { decodeBase64, encodeBase64 } from "../src/base64";

/**
 * The bug this file exists to prevent: `atob` alone returns one character per
 * byte, so multi-byte UTF-8 comes back as mojibake. It looks like it works,
 * because ASCII round-trips fine, and this store is mostly ASCII — apart from
 * the em-dashes and typographic quotes that run through nearly every file.
 *
 * A search index built on a bad decode would silently fail to match any word
 * next to one of those characters, and nothing would report an error.
 */

describe("decodeBase64", () => {
  test("plain ASCII survives", () => {
    expect(decodeBase64(btoa("Idin has a dog."))).toBe("Idin has a dog.");
  });

  test("the line breaks GitHub inserts are ignored", () => {
    // The contents API wraps base64 at 60 characters. Feeding that to atob
    // without stripping the newlines throws.
    const encoded = encodeBase64("a".repeat(200));
    const wrapped = encoded.replace(/(.{60})/g, "$1\n");
    expect(decodeBase64(wrapped)).toBe("a".repeat(200));
  });

  test.each([
    ["em-dash", "Born 1980-07-02 — superseded 2026-08-10"],
    ["typographic quotes", "pronounced “eye-din”"],
    ["accented characters", "a café in Montréal"],
    ["minus sign", "TD Prime − 0.550%"],
    ["emoji", "✅ done"],
  ])("%s survives a round trip", (_name, text) => {
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  test("a real store line with an em-dash decodes intact", () => {
    // Taken from instructions/the_layout.md, which is full of these.
    const line =
      "~~`todos/open/`, `todos/done/`~~ — superseded 2026-08-13 by "
      + "`future/todos/`";
    expect(decodeBase64(encodeBase64(line))).toBe(line);
  });

  test("a bare atob would have corrupted these, which is the point", () => {
    // Proving the bug is real rather than theoretical: the naive decode and
    // the correct one disagree, and the naive one is wrong.
    const text = "superseded — 2026";
    const naive = atob(encodeBase64(text));
    expect(naive).not.toBe(text);
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});
