import { describe, expect, test } from "vitest";

import { chunkFile } from "../src/chunking";
import {
  DEFAULT_FUZZY_MINIMUM_SCORE,
  scoreLexically,
  searchLexically,
} from "../src/lexical_search";
import type { StoreFile } from "../src/store_checks";

function file(path: string, text: string): StoreFile {
  return { path, text, bytes: text.length };
}

const FRODO = `# Frodo

Idin's toy poodle. Facts stated directly by Idin.

- Born 2013-05-06.
- Red, not light-brown.
- A toy poodle, so small.
`;

const CORE = `# Core

Identity. Only stated facts, never inferred.

## Money

- Sold a Vancouver condo. The proceeds are in cash.
`;

const CHUNKS = [
  ...chunkFile(file("ix/memory/facts/frodo.md", FRODO)),
  ...chunkFile(file("ix/memory/facts/core.md", CORE)),
];

const OPTIONS = {
  fuzzyMinimumScore: DEFAULT_FUZZY_MINIMUM_SCORE,
  limit: 10,
};

describe("the four anchored methods", () => {
  test("contains is named from the field's side", () => {
    // The field contains the query, which is the direction people mean by
    // default. The reverse is a different operation and is not implemented.
    const scores = scoreLexically("poodle", "Idin has a toy poodle");
    expect(scores.contains).toBe(1);
  });

  test("starts_with means the field starts with the query", () => {
    const scores = scoreLexically("Idin", "Idin has a toy poodle");
    expect(scores.starts_with).toBe(1);
    expect(scores.ends_with).toBe(0);
  });

  test("ends_with means the field ends with the query", () => {
    const scores = scoreLexically("poodle", "Idin has a toy poodle");
    expect(scores.ends_with).toBe(1);
  });

  test("exact means the whole field, not a part of it", () => {
    expect(scoreLexically("poodle", "poodle").exact).toBe(1);
    expect(scoreLexically("poodle", "a poodle").exact).toBe(0);
  });

  test("matching is case-insensitive", () => {
    expect(scoreLexically("POODLE", "a toy poodle").contains).toBe(1);
  });

  test("an empty query matches nothing rather than everything", () => {
    // A bug worth guarding: "" is a substring of every string, so a careless
    // implementation returns the entire store for an empty search.
    const scores = scoreLexically("", "Idin has a toy poodle");
    expect(scores.contains).toBe(0);
    expect(scores.fuzzy).toBe(0);
  });
});

describe("every method is always scored", () => {
  test("all five appear even when only one matched", () => {
    // The learning loop needs the full feature vector per candidate, so
    // computing one method and discarding the rest would destroy the training
    // data before it is collected.
    const scores = scoreLexically("poodle", "Idin has a toy poodle");
    expect(Object.keys(scores).sort()).toEqual([
      "contains",
      "ends_with",
      "exact",
      "fuzzy",
      "starts_with",
    ]);
  });

  test("a hit reports which method was strongest", () => {
    const hits = searchLexically(CHUNKS, "Vancouver condo", OPTIONS);
    expect(hits[0].bestMethod).toBe("contains");
  });

  test("the most specific method wins a tie", () => {
    // "poodle" against "poodle" satisfies all four anchors equally. Reporting
    // "contains" would be true but the least informative thing to say, so the
    // order of preference runs from most specific to least.
    const scores = scoreLexically("poodle", "poodle");
    expect(scores.exact).toBe(1);
    expect(scores.starts_with).toBe(1);
    expect(scores.contains).toBe(1);
    expect(
      searchLexically(
        [
          {
            path: "ix/memory/facts/x.md",
            ordinal: 0,
            headingPath: [],
            filePreamble: "",
            text: "poodle",
            superseded: [],
            containsSuperseded: false,
            isMessage: false,
            isDeep: false,
            startLine: 1,
            endLine: 1,
          },
        ],
        "poodle",
        OPTIONS,
      )[0].bestMethod,
    ).toBe("exact");
  });
});

describe("searching the store", () => {
  test("a plain word finds the chunk holding it", () => {
    const hits = searchLexically(CHUNKS, "poodle", OPTIONS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.path).toBe("ix/memory/facts/frodo.md");
  });

  test("a typo still finds it", () => {
    // Nobody types "poddle" on purpose, and a search that returns nothing
    // reads as "not in the store".
    const hits = searchLexically(CHUNKS, "poddle", OPTIONS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.text).toContain("poodle");
  });

  test("a heading in an ancestor is searchable", () => {
    // The chunk's body says nothing about money; its heading path does.
    const hits = searchLexically(CHUNKS, "Money", OPTIONS);
    expect(hits.some((hit) => hit.chunk.text.includes("Vancouver"))).toBe(true);
  });

  test("an unrelated query returns nothing", () => {
    // The property that makes an empty result meaningful: it must be possible
    // to genuinely find nothing, or every search "succeeds" and says nothing.
    expect(searchLexically(CHUNKS, "mortgage refinancing", OPTIONS)).toEqual(
      [],
    );
  });

  test("results are ordered best first", () => {
    const hits = searchLexically(CHUNKS, "poodle", OPTIONS);
    const scores = hits.map((hit) => hit.bestScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  test("the limit is respected", () => {
    const hits = searchLexically(CHUNKS, "Idin", {
      ...OPTIONS,
      limit: 1,
    });
    expect(hits).toHaveLength(1);
  });

  test("a hit says where it matched, for quoting back", () => {
    const hits = searchLexically(CHUNKS, "Vancouver", OPTIONS);
    expect(hits[0].matchedAt).toBeGreaterThanOrEqual(0);
  });

  test("a fuzzy-only hit has no position", () => {
    const hits = searchLexically(CHUNKS, "poddle", OPTIONS);
    expect(hits[0].matchedAt).toBeNull();
  });
});

describe("the fuzzy floor", () => {
  test("holds back noise", () => {
    const hits = searchLexically(CHUNKS, "zzzzqqqq", OPTIONS);
    expect(hits).toEqual([]);
  });

  test("but an anchored match is never held back by it", () => {
    // An exact substring is a match whatever the fuzzy score says.
    const hits = searchLexically(CHUNKS, "2013-05-06", OPTIONS);
    expect(hits.length).toBeGreaterThan(0);
  });
});
