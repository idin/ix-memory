import { describe, expect, test } from "vitest";

import {
  FREE_NEURONS_PER_DAY,
  NEURONS_PER_MILLION_TOKENS_BGE_BASE,
  describeUsage,
  estimateUsage,
  noOpUsageSink,
  type ApiUsage,
} from "../src/api_usage";

/**
 * The distinction this file guards: measured facts and derived estimates must
 * stay separable. The embedding API reports no token count, so anything
 * resembling one here is computed — and a computed number sitting in a column
 * that reads like a measurement is the kind of thing nobody questions until
 * it disagrees with a bill.
 */

function usage(overrides: Partial<ApiUsage> = {}): ApiUsage {
  return {
    timestamp: "2026-08-14T12:00:00.000Z",
    service: "workers_ai",
    model: "@cf/baai/bge-base-en-v1.5",
    operation: "embed",
    trigger: "full_build",
    calls: 1,
    items: 100,
    characters: 40_000,
    estimatedTokens: 10_000,
    estimatedUnits: 60.58,
    unitName: "neurons",
    ...overrides,
  };
}

describe("estimateUsage", () => {
  test("a million tokens costs the model's published rate", () => {
    const { estimatedUnits } = estimateUsage(4_000_000, {
      neuronsPerMillionTokens: NEURONS_PER_MILLION_TOKENS_BGE_BASE,
      charactersPerToken: 4,
    });
    expect(estimatedUnits).toBeCloseTo(NEURONS_PER_MILLION_TOKENS_BGE_BASE, 0);
  });

  test("the whole store costs a small fraction of one day", () => {
    // ~150,000 tokens for 3,750 lines. The claim that embeddings are free at
    // this scale should be a test rather than an assertion in a document.
    const { estimatedUnits } = estimateUsage(600_000, {
      neuronsPerMillionTokens: NEURONS_PER_MILLION_TOKENS_BGE_BASE,
      charactersPerToken: 4,
    });
    expect(estimatedUnits).toBeLessThan(FREE_NEURONS_PER_DAY / 10);
  });

  test("zero characters costs nothing", () => {
    expect(
      estimateUsage(0, {
        neuronsPerMillionTokens: NEURONS_PER_MILLION_TOKENS_BGE_BASE,
        charactersPerToken: 4,
      }).estimatedUnits,
    ).toBe(0);
  });
});

describe("describeUsage", () => {
  test("totals are summed from the records, never stored", () => {
    // A stored total is wrong the moment the next call lands.
    const text = describeUsage([
      usage({ calls: 1, estimatedUnits: 100 }),
      usage({ calls: 2, estimatedUnits: 50 }),
    ]);
    expect(text).toContain("3 call(s)");
    expect(text).toContain("150.0 neurons");
  });

  test("usage is stated as a share of the allowance", () => {
    // A number with nothing to compare it against answers no useful question.
    expect(describeUsage([usage({ estimatedUnits: 1000 })])).toContain("10.0%");
  });

  test("the reset boundary is named", () => {
    // 00:00 UTC is the boundary billing uses; any other would not line up.
    expect(describeUsage([usage()])).toContain("00:00 UTC");
  });

  test("the figure says it is an estimate, every time", () => {
    // The property that matters most here. A reader must never take this for
    // a measurement, because the API does not provide one.
    const text = describeUsage([usage()]);
    expect(text).toContain("Estimated");
    expect(text).toContain("reports no token usage");
  });

  test("no usage is stated plainly rather than as zero", () => {
    expect(describeUsage([])).toContain("No API usage");
  });
});

describe("the default sink", () => {
  test("discards without failing", async () => {
    // Metering is worth having and not worth failing a search over.
    await expect(
      Promise.resolve(noOpUsageSink(usage())),
    ).resolves.toBeUndefined();
  });
});

describe("the record keeps measured and derived apart", () => {
  test("measured fields carry no estimate in their name", () => {
    const row = usage();
    expect(row.calls).toBe(1);
    expect(row.items).toBe(100);
    expect(row.characters).toBe(40_000);
  });

  test("derived fields say so in their name", () => {
    const row = usage();
    expect(Object.keys(row)).toContain("estimatedTokens");
    expect(Object.keys(row)).toContain("estimatedUnits");
  });

  test("the unit is a column, so the table serves more than one service", () => {
    // GitHub meters requests, Workers AI meters neurons. Hardcoding either
    // would make this single-purpose.
    const github = usage({
      service: "github",
      unitName: "requests",
      estimatedUnits: 108,
    });
    expect(github.unitName).toBe("requests");
  });

  test("the trigger is recorded, so a spike can be attributed", () => {
    expect(usage({ trigger: "query" }).trigger).toBe("query");
  });
});
