import { describe, expect, test } from "vitest";

import { cascadeResults, summariseTiers } from "../src/search_cascade";
import type { SemanticHit } from "../src/embeddings";
import type { LexicalHit } from "../src/lexical_search";
import { chunk } from "./chunk_fixture";

/**
 * The cascade replaced a fused ranking, and the reason is worth stating
 * because it is not a detail of implementation.
 *
 * Ranking optimises for putting the best result first. That is the wrong
 * problem here: precision can be recovered by whoever reads the results —
 * a wrong result costs a moment's reading — while recall cannot be recovered
 * by anyone, because nothing downstream can retrieve what was never returned.
 *
 * So there is no cross-method score. Each method fills its own quota from
 * what earlier methods did not claim, and a chunk appears once, at the
 * strongest method that found it.
 */

const QUOTAS = {
  startsWith: 2,
  endsWith: 2,
  contains: 3,
  containedBy: 2,
  fuzzy: 2,
  cosine: 3,
};

function hit(
  ordinal: number,
  scores: Partial<LexicalHit["scores"]>,
  text = `chunk ${ordinal}`,
): LexicalHit {
  const full = {
    exact: 0,
    starts_with: 0,
    ends_with: 0,
    contains: 0,
    contained_by: 0,
    fuzzy: 0,
    ...scores,
  };
  return {
    chunk: chunk({ ordinal, text }),
    scores: full,
    bestMethod: "contains",
    bestScore: 1,
    matchedAt: null,
  };
}

function semantic(ordinal: number, similarity: number): SemanticHit {
  return { chunk: chunk({ ordinal, text: `chunk ${ordinal}` }), similarity };
}

describe("a chunk is claimed once, by its strongest method", () => {
  test("a chunk matching several tiers appears in the strongest", () => {
    // "poodle" against "poodle" satisfies exact, starts_with, ends_with and
    // contains. Returning it four times would waste three quotas on one
    // chunk, which is the opposite of covering more of the store.
    const results = cascadeResults(
      [hit(0, { exact: 1, starts_with: 1, ends_with: 1, contains: 1 })],
      [],
      QUOTAS,
    );
    expect(results).toHaveLength(1);
    expect(results[0].tier).toBe("exact");
  });

  test("a later tier does not re-return an earlier tier's chunk", () => {
    const results = cascadeResults(
      [
        hit(0, { starts_with: 1, contains: 1 }),
        hit(1, { contains: 1 }),
      ],
      [],
      QUOTAS,
    );
    expect(results.map((one) => one.tier)).toEqual(["starts_with", "contains"]);
  });

  test("a chunk found both lexically and semantically appears once", () => {
    const results = cascadeResults(
      [hit(0, { contains: 1 })],
      [semantic(0, 0.9)],
      QUOTAS,
    );
    expect(results).toHaveLength(1);
    expect(results[0].tier).toBe("contains");
    // The semantic score is still recorded — it is evidence, not noise.
    expect(results[0].features.cosine).toBe(0.9);
  });
});

describe("exact matches are never capped", () => {
  test("every exact match is returned, past any quota", () => {
    // A chunk whose whole text is the query is as good as a match gets.
    // Capping would discard the best results to make room for worse ones.
    const exacts = Array.from({ length: 12 }, (_unused, index) =>
      hit(index, { exact: 1, contains: 1 }),
    );
    const results = cascadeResults(exacts, [], QUOTAS);
    expect(results).toHaveLength(12);
    expect(results.every((one) => one.tier === "exact")).toBe(true);
  });
});

describe("quotas bound every other tier", () => {
  test("each tier contributes at most its quota", () => {
    const many = (score: keyof LexicalHit["scores"], count: number) =>
      Array.from({ length: count }, (_unused, index) =>
        hit(index + count * 100, { [score]: 1 }),
      );

    const results = cascadeResults(
      [
        ...many("starts_with", 10),
        ...many("ends_with", 10),
        ...many("contains", 10),
      ],
      [],
      QUOTAS,
    );

    const counts = Object.fromEntries(
      summariseTiers(results).map((entry) => [entry.tier, entry.count]),
    );
    expect(counts.starts_with).toBe(QUOTAS.startsWith);
    expect(counts.ends_with).toBe(QUOTAS.endsWith);
    expect(counts.contains).toBe(QUOTAS.contains);
  });

  test("semantic results fill their own quota", () => {
    const results = cascadeResults(
      [],
      Array.from({ length: 10 }, (_unused, index) =>
        semantic(index, 0.9 - index / 100),
      ),
      QUOTAS,
    );
    expect(results).toHaveLength(QUOTAS.cosine);
    expect(results.every((one) => one.tier === "cosine")).toBe(true);
  });
});

describe("anchored tiers prefer shorter chunks", () => {
  test("a one-line fact comes before a paragraph containing the same query", () => {
    // The query is most of a short chunk and a fraction of a long one, so
    // length says which is the better match without needing a model to judge.
    const results = cascadeResults(
      [
        hit(0, { contains: 1 }, "a".repeat(400)),
        hit(1, { contains: 1 }, "short"),
        hit(2, { contains: 1 }, "a".repeat(200)),
      ],
      [],
      { ...QUOTAS, contains: 3 },
    );
    expect(results.map((one) => one.chunk.text.length)).toEqual([5, 200, 400]);
  });

  test("when the quota bites, the shortest survive", () => {
    const results = cascadeResults(
      [
        hit(0, { contains: 1 }, "a".repeat(400)),
        hit(1, { contains: 1 }, "short"),
        hit(2, { contains: 1 }, "medium text"),
      ],
      [],
      { ...QUOTAS, contains: 2 },
    );
    expect(results.map((one) => one.chunk.text)).toEqual([
      "short",
      "medium text",
    ]);
  });
});

describe("fuzzy and semantic order by score", () => {
  test("fuzzy takes its highest scorers", () => {
    const results = cascadeResults(
      [
        hit(0, { fuzzy: 0.75 }),
        hit(1, { fuzzy: 0.95 }),
        hit(2, { fuzzy: 0.85 }),
      ],
      [],
      { ...QUOTAS, fuzzy: 2 },
    );
    expect(results.map((one) => one.features.fuzzy)).toEqual([0.95, 0.85]);
  });

  test("semantic takes its closest, in the order given", () => {
    const results = cascadeResults(
      [],
      [semantic(0, 0.9), semantic(1, 0.8), semantic(2, 0.7)],
      { ...QUOTAS, cosine: 2 },
    );
    expect(results.map((one) => one.features.cosine)).toEqual([0.9, 0.8]);
  });
});

describe("what a result carries", () => {
  test("every score is kept, not only the claiming tier's", () => {
    // The learning loop trains on the full feature vector, so discarding the
    // others would destroy the training data before it is collected.
    const results = cascadeResults(
      [hit(0, { contains: 1, fuzzy: 0.87 })],
      [semantic(0, 0.62)],
      QUOTAS,
    );
    expect(results[0].features).toEqual({
      exact: 0,
      startsWith: 0,
      endsWith: 0,
      contains: 1,
      containedBy: 0,
      fuzzy: 0.87,
      cosine: 0.62,
    });
  });

  test("a semantic-only chunk has no lexical scores rather than fake ones", () => {
    const results = cascadeResults([], [semantic(0, 0.7)], QUOTAS);
    expect(results[0].features.contains).toBe(0);
    expect(results[0].features.cosine).toBe(0.7);
    expect(results[0].matchedBy).toEqual(["cosine"]);
  });

  test("a chunk with no semantic score has null, not zero", () => {
    // Null means the retriever did not see it; zero would mean it scored
    // nothing, and a model trained on the two conflated learns the wrong
    // thing.
    const results = cascadeResults([hit(0, { contains: 1 })], [], QUOTAS);
    expect(results[0].features.cosine).toBeNull();
  });

  test("everything that matched is named, not only the claiming tier", () => {
    const results = cascadeResults(
      [hit(0, { starts_with: 1, contains: 1, fuzzy: 0.9 })],
      [semantic(0, 0.8)],
      QUOTAS,
    );
    expect(results[0].tier).toBe("starts_with");
    expect(results[0].matchedBy).toEqual([
      "starts_with",
      "contains",
      "fuzzy",
      "cosine",
    ]);
  });
});

describe("recall over precision", () => {
  test("a weak semantic match is still returned", () => {
    // The whole point. A result that turns out to be useless costs a moment
    // of reading; one that was never returned cannot be recovered at all.
    const results = cascadeResults([], [semantic(0, 0.45)], QUOTAS);
    expect(results).toHaveLength(1);
  });

  test("nothing matching returns nothing", () => {
    // An empty result has to remain possible, or the absence of a fact can
    // never be established.
    expect(cascadeResults([], [], QUOTAS)).toEqual([]);
  });
});
