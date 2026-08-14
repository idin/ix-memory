import { describe, expect, test } from "vitest";

import {
  RECIPROCAL_RANK_CONSTANT,
  fuseByReciprocalRank,
} from "../src/hybrid_search";
import type { SemanticHit } from "../src/embeddings";
import type { LexicalHit } from "../src/lexical_search";
import { chunk } from "./chunk_fixture";

/**
 * The property that justifies choosing rank fusion over a weighted sum:
 * Jaro-Winkler and cosine similarity are not commensurate. Cosine sits around
 * 0.6 to 1.0 for any two English sentences because the embedding space is
 * anisotropic, so `0.5 * lexical + 0.5 * cosine` lets an irrelevant chunk at
 * 0.72 outrank a genuine near-miss at 0.85 — a wrong ranking that looks
 * perfectly reasonable.
 */

const OPTIONS = {
  reciprocalRankConstant: RECIPROCAL_RANK_CONSTANT,
  limit: 10,
};

function lexical(ordinal: number, best = 1): LexicalHit {
  return {
    chunk: chunk({ ordinal, text: `lexical ${ordinal}` }),
    scores: {
      exact: 0,
      starts_with: 0,
      ends_with: 0,
      contains: best,
      fuzzy: best,
    },
    bestMethod: "contains",
    bestScore: best,
    matchedAt: 0,
  };
}

function semantic(ordinal: number, similarity: number): SemanticHit {
  return {
    chunk: chunk({ ordinal, text: `lexical ${ordinal}` }),
    similarity,
  };
}

describe("fusing two rankings", () => {
  test("a chunk found by both outranks one found by either", () => {
    // The whole point of fusing: agreement between independent retrievers is
    // evidence neither provides alone.
    const fused = fuseByReciprocalRank(
      [lexical(1), lexical(2)],
      [semantic(2, 0.9), semantic(3, 0.8)],
      OPTIONS,
    );
    expect(fused[0].chunk.ordinal).toBe(2);
  });

  test("only ranks matter, never raw scores", () => {
    // The property that makes incommensurate scales safe to combine. The same
    // ordering with scores scaled by 100 must fuse identically.
    const small = fuseByReciprocalRank(
      [lexical(1, 0.9), lexical(2, 0.8)],
      [semantic(1, 0.71), semantic(2, 0.70)],
      OPTIONS,
    );
    const large = fuseByReciprocalRank(
      [lexical(1, 0.009), lexical(2, 0.008)],
      [semantic(1, 0.99), semantic(2, 0.02)],
      OPTIONS,
    );
    expect(large.map((r) => r.chunk.ordinal)).toEqual(
      small.map((r) => r.chunk.ordinal),
    );
  });

  test("agreement further down can outrank one retriever's best", () => {
    // What the damping constant is for. At k = 0 rank 1 scores 1.0 and rank 2
    // scores 0.5, so a single retriever's top hit could never be displaced.
    const fused = fuseByReciprocalRank(
      [lexical(1), lexical(2), lexical(3)],
      [semantic(3, 0.9), semantic(4, 0.8)],
      OPTIONS,
    );
    expect(fused[0].chunk.ordinal).toBe(3);
  });

  test("a chunk found by one retriever still appears", () => {
    const fused = fuseByReciprocalRank([lexical(1)], [semantic(2, 0.9)], OPTIONS);
    expect(fused).toHaveLength(2);
  });

  test("results are ordered by fused score", () => {
    const fused = fuseByReciprocalRank(
      [lexical(1), lexical(2), lexical(3)],
      [semantic(3, 0.9)],
      OPTIONS,
    );
    const scores = fused.map((result) => result.fusedScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  test("ties break deterministically", () => {
    // Ties are common — anything found by one retriever at the same rank
    // scores identically — and results that shuffle between identical
    // searches are their own small bug.
    const once = fuseByReciprocalRank([], [semantic(1, 0.9), semantic(2, 0.9)], OPTIONS);
    const twice = fuseByReciprocalRank([], [semantic(1, 0.9), semantic(2, 0.9)], OPTIONS);
    expect(twice.map((r) => r.chunk.ordinal)).toEqual(
      once.map((r) => r.chunk.ordinal),
    );
  });

  test("the limit is respected", () => {
    const fused = fuseByReciprocalRank(
      [lexical(1), lexical(2), lexical(3)],
      [],
      { ...OPTIONS, limit: 2 },
    );
    expect(fused).toHaveLength(2);
  });

  test("two empty rankings fuse to nothing", () => {
    expect(fuseByReciprocalRank([], [], OPTIONS)).toEqual([]);
  });
});

describe("every score is carried through", () => {
  test("lexical scores survive fusion", () => {
    // The learning loop trains on the full feature vector, so discarding
    // component scores at fusion time would destroy the training data before
    // it is collected.
    const [result] = fuseByReciprocalRank([lexical(1)], [], OPTIONS);
    expect(result.features.contains).toBe(1);
    expect(result.features.fuzzy).toBe(1);
  });

  test("the cosine score survives fusion", () => {
    const [result] = fuseByReciprocalRank([], [semantic(1, 0.83)], OPTIONS);
    expect(result.features.cosine).toBeCloseTo(0.83, 5);
  });

  test("both ranks are recorded", () => {
    const [result] = fuseByReciprocalRank(
      [lexical(1)],
      [semantic(1, 0.9)],
      OPTIONS,
    );
    expect(result.features.lexicalRank).toBe(1);
    expect(result.features.semanticRank).toBe(1);
  });

  test("an absent retriever leaves null, not zero", () => {
    // Null means "did not appear"; zero would mean "scored nothing", and a
    // model trained on the two conflated would learn the wrong thing.
    const [result] = fuseByReciprocalRank([lexical(1)], [], OPTIONS);
    expect(result.features.cosine).toBeNull();
    expect(result.features.semanticRank).toBeNull();
  });

  test("what matched is named", () => {
    const [result] = fuseByReciprocalRank([lexical(1)], [], OPTIONS);
    expect(result.matchedBy).toContain("contains");
  });

  test("a semantic-only hit is marked as such", () => {
    // Worth flagging to a reader: the query's words appear nowhere in the
    // chunk, so looking for them will not find them.
    const [result] = fuseByReciprocalRank([], [semantic(1, 0.9)], OPTIONS);
    expect(result.semanticOnly).toBe(true);
    expect(result.matchedBy).toEqual([]);
  });

  test("a hit found by both is not semantic-only", () => {
    const [result] = fuseByReciprocalRank(
      [lexical(1)],
      [semantic(1, 0.9)],
      OPTIONS,
    );
    expect(result.semanticOnly).toBe(false);
  });
});
