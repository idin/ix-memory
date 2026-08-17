import { describe, expect, test } from "vitest";

import {
  comparisonPath,
  looksTrivial,
  renderComparison,
  type Comparison,
} from "../src/comparisons";

/**
 * The point of storing a comparison is the part that normally goes missing:
 * which options were ruled out and why. The choice survives on its own; the
 * rejections do not, and they are the expensive half of the work.
 */

const WHEN = Date.parse("2026-08-13T12:00:00.000Z");

function comparison(overrides: Partial<Comparison> = {}): Comparison {
  return {
    subject: "air purifiers under $400",
    criteria: ["filter cost", "same brand as the others", "air quality monitor"],
    options: [
      {
        name: "Levoit Core 400S",
        attributes: { price: "$300", filters: "$45/year" },
      },
      {
        name: "Levoit S330",
        attributes: { price: "$450" },
        rejected_because: "Too expensive for the room it would go in.",
      },
      {
        name: "Coway Airmega",
        attributes: { price: "$380" },
        rejected_because:
          "Different brand, so a second filter subscription to track.",
      },
    ],
    chosen: "Levoit Core 400S",
    conclusion:
      "Cheapest filters of the three and the same brand as the existing "
      + "units, which matters more than the small difference in coverage.",
    ...overrides,
  };
}

describe("comparisonPath", () => {
  test("is dated, since a comparison is true of a moment", () => {
    expect(comparisonPath("air purifiers", WHEN)).toBe(
      "other-memory/comparisons/2026-08-13_air_purifiers.md",
    );
  });

  test("a subject with no usable characters is refused", () => {
    expect(() => comparisonPath("!!!", WHEN)).toThrow(/usable characters/);
  });

  test("an overlong subject throws rather than being cut", () => {
    expect(() => comparisonPath("word ".repeat(60), WHEN)).toThrow(/Shorten it/);
  });
});

describe("renderComparison", () => {
  test("the rejected options are as prominent as the choice", () => {
    // A format that buried them would lose them the same way not writing the
    // comparison down does.
    const text = renderComparison(comparison(), WHEN);
    expect(text).toContain("## Rejected, and why");
    expect(text).toContain("Levoit S330");
    expect(text).toContain("Too expensive");
  });

  test("the reasoning is stored, not only the winner", () => {
    const text = renderComparison(comparison(), WHEN);
    expect(text).toContain("## Conclusion");
    expect(text).toContain("Cheapest filters");
  });

  test("what would overturn it is kept when given", () => {
    const text = renderComparison(
      comparison({ would_change_if: "If the S330 dropped below $350." }),
      WHEN,
    );
    expect(text).toContain("What would change this");
  });

  test("a comparison with no winner is still a comparison", () => {
    const text = renderComparison(comparison({ chosen: null }), WHEN);
    expect(text).toContain("Nothing chosen");
  });

  test("the file says its figures are as of a date", () => {
    // Ratings and prices move. The reasoning is what is meant to survive.
    expect(renderComparison(comparison(), WHEN)).toContain("2026-08-13");
    expect(renderComparison(comparison(), WHEN)).toMatch(/moved since/);
  });

  test("the unresolved terms question is written down, not left implicit", () => {
    // Idin chose to store third-party fields and settle the terms question
    // later. A deferral nobody recorded is indistinguishable from one nobody
    // noticed.
    expect(renderComparison(comparison(), WHEN)).toContain("terms");
  });
});

describe("looksTrivial surfaces rather than refuses", () => {
  test("a two-option comparison is flagged", () => {
    const concern = looksTrivial(
      comparison({ options: comparison().options.slice(0, 2) }),
    );
    expect(concern).toContain("option(s) compared");
  });

  test("but it is still saved", () => {
    // The tool says so and lets Idin decide. A tool that declined would be
    // overruling the person who asked it to save.
    const concern = looksTrivial(
      comparison({ options: comparison().options.slice(0, 2) }),
    );
    expect(concern).toContain("Saved anyway");
  });

  test("a rejection with no reason is flagged, since that is the point", () => {
    const concern = looksTrivial(
      comparison({
        options: [
          { name: "A" },
          { name: "B" },
          { name: "C" },
          { name: "D" },
        ],
        chosen: "A",
      }),
    );
    expect(concern).toContain("no reason recorded");
  });

  test("a one-line conclusion is flagged", () => {
    expect(looksTrivial(comparison({ conclusion: "Went with A." }))).toContain(
      "very short",
    );
  });

  test("a full comparison passes without comment", () => {
    expect(looksTrivial(comparison())).toBeNull();
  });
});
