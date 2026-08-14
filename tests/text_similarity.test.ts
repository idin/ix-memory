import { describe, expect, test } from "vitest";

import {
  bestTokenAlignment,
  jaroSimilarity,
  jaroWinklerSimilarity,
  tokenSetRatio,
  tokenSortRatio,
  tokenize,
} from "../src/text_similarity";

/**
 * The published vectors below are the point of this file. They come from
 * outside this codebase, so they check the implementation against the
 * algorithm as specified rather than against what I expected it to do — a
 * distinction that matters, since a subtly wrong transposition count still
 * produces plausible-looking numbers.
 */

describe("jaroSimilarity", () => {
  test("MARTHA/MARHTA scores 0.9444, the canonical worked example", () => {
    // Six matches, one transposition pair:
    // (6/6 + 6/6 + 5/6) / 3 = 0.9444
    expect(jaroSimilarity("MARTHA", "MARHTA")).toBeCloseTo(0.9444, 4);
  });

  test("identical strings score 1", () => {
    expect(jaroSimilarity("Frodo", "Frodo")).toBe(1);
  });

  test("strings with nothing in common score 0", () => {
    expect(jaroSimilarity("abc", "xyz")).toBe(0);
  });

  test("an empty string scores 0 rather than throwing", () => {
    expect(jaroSimilarity("", "anything")).toBe(0);
  });

  test("transpositions are counted, or MARTHA would score 1", () => {
    // Without the transposition term the first two terms alone give 1.0,
    // making an anagram indistinguishable from an exact match.
    expect(jaroSimilarity("MARTHA", "MARHTA")).toBeLessThan(1);
  });
});

describe("jaroWinklerSimilarity", () => {
  test.each([
    ["MARTHA", "MARHTA", 0.961],
    ["DIXON", "DICKSONX", 0.813],
    ["DWAYNE", "DUANE", 0.84],
  ])("%s/%s scores %f", (first, second, expected) => {
    expect(jaroWinklerSimilarity(first, second)).toBeCloseTo(expected, 3);
  });

  test("never exceeds 1, which is why the scale is 0.1 and not more", () => {
    // At a scale of 0.25 with a four-character cap, anything sharing four
    // leading characters would return exactly 1.0; above that it would exceed
    // 1 and stop being a similarity.
    for (const pair of [
      ["identical", "identical"],
      ["prefixed", "prefixedxxxxxx"],
      ["abcd", "abcd"],
    ]) {
      expect(jaroWinklerSimilarity(pair[0], pair[1])).toBeLessThanOrEqual(1);
    }
  });

  test("a shared prefix beats the same difference later on", () => {
    // The whole reason this algorithm is here: an error at the start costs
    // more than the same error in the middle.
    const startsWrong = jaroWinklerSimilarity("Xeborah", "Deborah");
    const endsWrong = jaroWinklerSimilarity("DeboraX", "Deborah");
    expect(endsWrong).toBeGreaterThan(startsWrong);
  });

  test("the bonus cannot rescue an unrelated pair", () => {
    // Proportional to (1 - jaro), so a bad match stays bad.
    expect(jaroWinklerSimilarity("cat", "carburettor")).toBeLessThan(0.75);
  });
});

describe("tokenize", () => {
  test("punctuation and case are removed", () => {
    expect(tokenize("Drive, 455 Beach!")).toEqual(["drive", "455", "beach"]);
  });

  test("diacritics are folded so an unaccented query still matches", () => {
    expect(tokenize("café Montréal")).toEqual(["cafe", "montreal"]);
  });

  test("empty text produces no tokens", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("word order", () => {
  const REORDERED = ["455 Beach Drive", "Drive, 455 Beach"] as const;

  test("the sort ratio sees the same address", () => {
    // Idin's objection, encoded: a sentence is not one long string.
    expect(tokenSortRatio(REORDERED[0], REORDERED[1])).toBeGreaterThan(0.95);
  });

  test("raw character comparison does not", () => {
    // The contrast that justifies tokenizing at all.
    expect(jaroWinklerSimilarity(REORDERED[0], REORDERED[1])).toBeLessThan(
      tokenSortRatio(REORDERED[0], REORDERED[1]),
    );
  });

  test("token alignment also sees it", () => {
    expect(bestTokenAlignment(REORDERED[0], REORDERED[1])).toBeGreaterThan(
      0.95,
    );
  });
});

describe("tokenSetRatio", () => {
  test("a subset scores 1, the documented behaviour", () => {
    expect(tokenSetRatio("fuzzy was a bear", "fuzzy fuzzy was a bear")).toBe(1);
  });

  test("which is forgiving, and that is a known weakness", () => {
    // A short query against a long chunk scores perfectly on set overlap.
    // Recorded as a test so the behaviour is deliberate rather than a
    // surprise when results look too generous.
    expect(
      tokenSetRatio("dog", "Idin has a dog and three televisions and a car"),
    ).toBe(1);
  });

  test("disagreement does reduce it", () => {
    expect(tokenSetRatio("red poodle", "blue mastiff")).toBeLessThan(0.8);
  });
});

describe("bestTokenAlignment", () => {
  test("a query token matching one field token scores high", () => {
    expect(bestTokenAlignment("poodle", "Idin has a toy poodle named Frodo"))
      .toBe(1);
  });

  test("a typo in the middle of a word still matches", () => {
    // The prefix weighting doing its job inside the token.
    expect(
      bestTokenAlignment("poddle", "Idin has a toy poodle named Frodo"),
    ).toBeGreaterThan(0.9);
  });

  test("a wrong first letter costs more than a wrong last", () => {
    const firstWrong = bestTokenAlignment("xoodle", "poodle");
    const lastWrong = bestTokenAlignment("poodlx", "poodle");
    expect(lastWrong).toBeGreaterThan(firstWrong);
  });

  test("averaging over query tokens, not field tokens", () => {
    // Dividing by the field's length would drive every score to zero for a
    // chunk of any real size, making fuzzy matching useless where it matters.
    const short = bestTokenAlignment("poodle", "a poodle");
    const long = bestTokenAlignment(
      "poodle",
      `a poodle ${"and other words ".repeat(40)}`,
    );
    expect(long).toBeCloseTo(short, 5);
  });

  test("an unrelated query scores low", () => {
    expect(
      bestTokenAlignment("mortgage refinancing", "Idin has a toy poodle"),
    ).toBeLessThan(0.6);
  });

  test("empty input scores 0 rather than throwing", () => {
    expect(bestTokenAlignment("", "anything")).toBe(0);
    expect(bestTokenAlignment("anything", "")).toBe(0);
  });
});
