import { describe, expect, test } from "vitest";

import { chunkFile } from "../src/chunking";
import {
  DEFAULT_FUZZY_MINIMUM_SCORE,
  scoreLexically,
  searchLexically,
} from "../src/lexical_search";
import { chunk, storeFile as file } from "./chunk_fixture";

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

const OPTIONS = { fuzzyMinimumScore: DEFAULT_FUZZY_MINIMUM_SCORE };

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

describe("contained_by, the reverse of contains", () => {
  test("a short chunk inside a long query matches", () => {
    // What contains cannot do. A full question passes over the short entries
    // that answer it, because no chunk holds the whole question.
    const scores = scoreLexically(
      "what is Frodo's neck measurement for a collar",
      "Neck: 7.5 inches",
    );
    expect(scores.contains).toBe(0);
    expect(scores.contained_by).toBe(0);
  });

  test("a chunk literally inside the query matches", () => {
    const scores = scoreLexically(
      "does the store say Neck: 7.5 inches anywhere",
      "Neck: 7.5 inches",
    );
    expect(scores.contained_by).toBe(1);
    expect(scores.contains).toBe(0);
  });

  test("the two directions are distinguishable", () => {
    // contains: the field holds the query. contained_by: the query holds the
    // field. Both are one relationship seen from opposite ends.
    const long = "Idin has a toy poodle named Frodo";
    expect(scoreLexically("toy poodle", long).contains).toBe(1);
    expect(scoreLexically("toy poodle", long).contained_by).toBe(0);
    expect(scoreLexically(long, "toy poodle").contained_by).toBe(1);
    expect(scoreLexically(long, "toy poodle").contains).toBe(0);
  });

  test("a short fragment matches, and is bounded by the cascade instead", () => {
    // No minimum length here. Filtering by size would delete candidates
    // before the cascade could rank them, which is the cut that destroys
    // recall — and it is unnecessary, because the cascade already sorts this
    // tier shortest-first and caps it by quota.
    expect(
      scoreLexically("a long question about the dog and its collar", "dog")
        .contained_by,
    ).toBe(1);
  });

  test("an empty field does not match everything", () => {
    // The one case worth excluding, and not on grounds of length: every
    // string contains the empty string, so without this a blank chunk would
    // match every query ever made.
    expect(scoreLexically("any query at all", "   ").contained_by).toBe(0);
  });
});

describe("every method is always scored", () => {
  test("all six appear even when only one matched", () => {
    // The learning loop needs the full feature vector per candidate, so
    // computing one method and discarding the rest would destroy the training
    // data before it is collected.
    const scores = scoreLexically("poodle", "Idin has a toy poodle");
    expect(Object.keys(scores).sort()).toEqual([
      "contained_by",
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
      searchLexically([chunk({ text: "poodle" })], "poodle", OPTIONS)[0]
        .bestMethod,
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

  test("every match is returned, uncapped and unsorted", () => {
    // Deliberately not ranked or cut here. Ordering and quotas belong to the
    // cascade, which fills each method's share from what earlier methods did
    // not claim — sorting by one best score would mix the methods back
    // together, and cutting to a limit would discard candidates the cascade
    // had not yet had a chance to consider.
    //
    // Recall is the goal: precision is recoverable by whoever reads the
    // results, and recall is not recoverable by anyone.
    const hits = searchLexically(CHUNKS, "Idin", OPTIONS);
    expect(hits.length).toBeGreaterThan(1);
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
