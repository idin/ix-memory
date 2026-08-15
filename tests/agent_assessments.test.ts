import { describe, expect, test } from "vitest";

import {
  applyAssessments,
  describeAssessments,
  noOpRelevanceSink,
  recordCandidates,
  type CandidateRecord,
} from "../src/agent_assessments";
import type { SearchFeatures } from "../src/search_cascade";

/**
 * The invariant these tests exist for: nothing can be recorded as irrelevant
 * without an explicit judgment.
 *
 * If a reader stops at the third result, results four onward were not judged —
 * nobody looked at them. Recording them as negatives stores a guess as a fact,
 * and teaches any model trained on it that low-ranked results are bad, which
 * is the very prior the model was supposed to test rather than inherit.
 */

const FEATURES: SearchFeatures = {
  exact: 0,
  startsWith: 0,
  endsWith: 0,
  contains: 1,
  containedBy: 0,
  fuzzy: 0.9,
  cosine: 0.81,
};

function candidates(count: number): CandidateRecord[] {
  return recordCandidates(
    "poodle",
    "idin",
    Array.from({ length: count }, (_unused, index) => ({
      path: `ix/memory/facts/file_${index}.md`,
      ordinal: 0,
      chunkLength: 120,
      features: FEATURES,
      cosineSimilarityRank: index + 1,
      fuzzyRank: null,
    })),
    Date.parse("2026-08-15T12:00:00.000Z"),
  );
}

describe("recording candidates", () => {
  test("everything starts unjudged", () => {
    expect(candidates(5).every((one) => one.agentAssessment === "unassessed")).toBe(true);
  });

  test("each method's own rank is recorded, not a combined one", () => {
    // Only fuzzy and cosine produce an ordering. The anchored methods are
    // binary, so a rank there would describe the cascade's tier order rather
    // than anything about the match.
    expect(candidates(3).map((one) => one.cosineSimilarityRank)).toEqual([
      1, 2, 3,
    ]);
    expect(candidates(3).every((one) => one.fuzzyRank === null)).toBe(true);
  });

  test("chunk length is recorded, since it orders the anchored tiers", () => {
    // Stored as a feature rather than bookkeeping: without it nothing can
    // check whether ordering by length was the right call.
    expect(candidates(1)[0].chunkLength).toBe(120);
  });

  test("nothing is marked as assessed until something assesses it", () => {
    expect(candidates(3).every((one) => one.assessedBy === null)).toBe(true);
  });

  test("the query is stored, not only the scores", () => {
    // Without it a row is frozen at whatever features existed the day it was
    // written, and cannot be recomputed when a new one is added.
    expect(candidates(1)[0].query).toBe("poodle");
  });

  test("every component score is kept", () => {
    // Storing only the fused rank would discard what a model needs to learn
    // from — the fused score is the thing being replaced, not the input.
    const [record] = candidates(1);
    expect(record.features.cosine).toBe(0.81);
    expect(record.features.fuzzy).toBe(0.9);
    expect(record.features.contains).toBe(1);
  });

  test("who searched is recorded", () => {
    // Whether judgments generalise across people is a question the data can
    // answer later, and discarding the identity makes it unanswerable.
    expect(candidates(1)[0].login).toBe("idin");
  });

  test("no path produces a negative assessment", () => {
    // The invariant, stated directly: this function cannot emit "irrelevant".
    expect(
      candidates(20).some((one) => one.agentAssessment === "irrelevant"),
    ).toBe(false);
  });
});

describe("applying judgments", () => {
  test("named results are labelled", () => {
    const assessed = applyAssessments(
      candidates(4),
      [{ path: "ix/memory/facts/file_0.md", ordinal: 0 }],
      [{ path: "ix/memory/facts/file_1.md", ordinal: 0 }],
      "ada",
    );
    expect(assessed[0].agentAssessment).toBe("relevant");
    expect(assessed[1].agentAssessment).toBe("irrelevant");
  });

  test("unmentioned results stay unjudged, not irrelevant", () => {
    // The failure this whole design guards against.
    const assessed = applyAssessments(
      candidates(5),
      [{ path: "ix/memory/facts/file_0.md", ordinal: 0 }],
      [],
      "ada",
    );
    expect(assessed.slice(1).every((one) => one.agentAssessment === "unassessed")).toBe(true);
  });

  test("judging nothing leaves everything unjudged", () => {
    expect(
      applyAssessments(candidates(3), [], [], "ada").every(
        (one) => one.agentAssessment === "unassessed",
      ),
    ).toBe(true);
  });

  test("a chunk is identified by path and ordinal together", () => {
    // Two chunks of one file are different candidates, and judging one must
    // not label the other.
    const records = recordCandidates(
      "poodle",
      null,
      [
        {
          path: "ix/memory/facts/core.md",
          ordinal: 0,
          chunkLength: 120,
          features: FEATURES,
          cosineSimilarityRank: 1,
          fuzzyRank: null,
        },
        {
          path: "ix/memory/facts/core.md",
          ordinal: 3,
          chunkLength: 90,
          features: FEATURES,
          cosineSimilarityRank: 2,
          fuzzyRank: null,
        },
      ],
      0,
    );
    const assessed = applyAssessments(
      records,
      [{ path: "ix/memory/facts/core.md", ordinal: 3 }],
      [],
      "ada",
    );
    expect(assessed[0].agentAssessment).toBe("unassessed");
    expect(assessed[1].agentAssessment).toBe("relevant");
  });

  test("the original records are not mutated", () => {
    const records = candidates(2);
    applyAssessments(records, [{ path: "ix/memory/facts/file_0.md", ordinal: 0 }], [], "ada");
    expect(records[0].agentAssessment).toBe("unassessed");
  });
});

describe("describing what was recorded", () => {
  test("counts each state separately", () => {
    const assessed = applyAssessments(
      candidates(4),
      [{ path: "ix/memory/facts/file_0.md", ordinal: 0 }],
      [{ path: "ix/memory/facts/file_1.md", ordinal: 0 }],
      "ada",
    );
    const text = describeAssessments(assessed);
    expect(text).toContain("1 relevant");
    expect(text).toContain("1 irrelevant");
    expect(text).toContain("2 left unassessed");
  });

  test("says why unjudged is not a rejection", () => {
    const assessed = applyAssessments(
      candidates(3),
      [{ path: "ix/memory/facts/file_0.md", ordinal: 0 }],
      [],
      "ada",
    );
    expect(describeAssessments(assessed)).toContain("nobody looked");
  });

  test("judging nothing asks for the rejections too", () => {
    // A dataset of only good matches cannot teach anything to tell them
    // apart, which is the point people skip.
    const text = describeAssessments(candidates(3));
    expect(text).toContain("rejections matter");
  });
});

describe("the default sink", () => {
  test("discards without failing", async () => {
    await expect(
      Promise.resolve(noOpRelevanceSink(candidates(2))),
    ).resolves.toBeUndefined();
  });
});
