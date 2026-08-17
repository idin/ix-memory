import { describe, expect, test } from "vitest";

import { chunkFile } from "../src/chunking";
import {
  MAXIMUM_SIBLINGS_PER_HIT,
  attachSiblings,
  siblingsFor,
} from "../src/sibling_chunks";
import { chunk, storeFile } from "./chunk_fixture";

/**
 * The case this exists for, in Idin's words: half a meaning in one chunk and
 * half in the next, with the split hiding both.
 *
 * Worth stating why embedding similarity is not the mechanism. "The mortgage
 * was refinanced in 2020" and "It went from Scotia to TD Bank" are about one
 * subject while sharing almost no vocabulary, so their vectors can sit far
 * apart — a similarity threshold would miss exactly this pair while linking
 * unrelated bullets that happen to share dates and amounts. Dependency is
 * textual, so it is detected textually.
 */

const OPTIONS = { maximum: MAXIMUM_SIBLINGS_PER_HIT };

function pair(): ReturnType<typeof chunk>[] {
  return [
    chunk({
      ordinal: 0,
      headingPath: ["455 Beach", "Refinance"],
      text: "The mortgage was refinanced in 2020.",
    }),
    chunk({
      ordinal: 1,
      headingPath: ["455 Beach", "Refinance"],
      text: "It went from Scotia to TD Bank.",
      dependsOnPrevious: true,
    }),
  ];
}

describe("detecting a dependent chunk", () => {
  test("a chunk opening with a pronoun is flagged", () => {
    const chunks = chunkFile(
      storeFile(
        "other-memory/facts/home/455_beach.md",
        "# 455 Beach\n\nProvenance.\n\n## Refinance\n\nThe mortgage was "
          + "refinanced in 2020.\n\n## Transfer\n\nIt went from Scotia to TD "
          + "Bank.\n",
      ),
    );
    const dependent = chunks.find((one) => one.text.startsWith("It went"));
    expect(dependent?.dependsOnPrevious).toBe(true);
  });

  test("a self-contained chunk is not", () => {
    const chunks = chunkFile(
      storeFile(
        "other-memory/facts/home/455_beach.md",
        "# 455 Beach\n\nProvenance.\n\n## Refinance\n\nThe mortgage was "
          + "refinanced in 2020.\n\n## Rate\n\nThe rate is TD Bank Prime "
          + "minus 0.550%.\n",
      ),
    );
    const independent = chunks.find((one) => one.text.includes("Prime"));
    expect(independent?.dependsOnPrevious).toBe(false);
  });

  test("the first chunk of a file is never dependent", () => {
    // A pronoun in the opening chunk refers to the title or to nothing, and
    // either way there is no earlier sibling to fetch.
    const chunks = chunkFile(
      storeFile("other-memory/facts/x.md", "# Thing\n\nIt is what it is.\n"),
    );
    expect(chunks[0].dependsOnPrevious).toBe(false);
  });

  test.each([
    ["It went from Scotia to TD Bank."],
    ["- This was corrected in 2026."],
    ["They are both in the office."],
    ["The above supersedes the note."],
    ["Both of these were sold."],
  ])("%s is recognised as dependent", (text) => {
    expect(
      siblingsFor(
        chunk({ ordinal: 1, text, dependsOnPrevious: true }),
        [chunk({ ordinal: 0 }), chunk({ ordinal: 1, text, dependsOnPrevious: true })],
        OPTIONS,
      ),
    ).toHaveLength(1);
  });
});

describe("siblingsFor", () => {
  test("a dependent chunk pulls in the one that names its subject", () => {
    const chunks = pair();
    const siblings = siblingsFor(chunks[1], chunks, OPTIONS);
    expect(siblings).toHaveLength(1);
    expect(siblings[0].text).toContain("mortgage was refinanced");
  });

  test("an independent chunk pulls in nothing", () => {
    // Both neighbours must stand alone. In `pair()` the second chunk depends
    // on the first, so the first correctly brings it forward — that is the
    // forward case, tested below.
    const chunks = [
      chunk({ ordinal: 0, text: "The mortgage was refinanced in 2020." }),
      chunk({ ordinal: 1, text: "The rate is TD Bank Prime minus 0.550%." }),
    ];
    expect(siblingsFor(chunks[0], chunks, OPTIONS)).toEqual([]);
  });

  test("a chain resolves back to the chunk that names the subject", () => {
    // "It ... They ... " — stopping one short would return a chunk whose
    // subject is still a pronoun.
    const chunks = [
      chunk({ ordinal: 0, text: "The mortgage was refinanced in 2020." }),
      chunk({ ordinal: 1, text: "It moved to TD Bank.", dependsOnPrevious: true }),
      chunk({ ordinal: 2, text: "They set the rate then.", dependsOnPrevious: true }),
    ];
    const siblings = siblingsFor(chunks[2], chunks, OPTIONS);
    expect(siblings.map((one) => one.text).join(" ")).toContain(
      "mortgage was refinanced",
    );
  });

  test("the chain stops at a section boundary", () => {
    // A different heading is a different subject; walking past it would
    // attach unrelated text.
    const chunks = [
      chunk({ ordinal: 0, headingPath: ["A"], text: "About the roof." }),
      chunk({
        ordinal: 1,
        headingPath: ["B"],
        text: "It was replaced in 2019.",
        dependsOnPrevious: true,
      }),
    ];
    expect(siblingsFor(chunks[1], chunks, OPTIONS)).toEqual([]);
  });

  test("a chunk whose successor depends on it brings that successor", () => {
    // Returning the first alone would tell the reader the mortgage was
    // refinanced and hide that it changed banks.
    const chunks = pair();
    const chunksWithForward = [
      chunks[0],
      { ...chunks[1], dependsOnPrevious: true },
    ];
    const siblings = siblingsFor(chunksWithForward[0], chunksWithForward, {
      maximum: 2,
    });
    expect(siblings.map((one) => one.text)).toContain(
      "It went from Scotia to TD Bank.",
    );
  });

  test("never more than the maximum", () => {
    const chunks = Array.from({ length: 8 }, (_unused, index) =>
      chunk({
        ordinal: index,
        text: index === 0 ? "The mortgage." : "It changed again.",
        dependsOnPrevious: index > 0,
      }),
    );
    expect(siblingsFor(chunks[7], chunks, { maximum: 2 })).toHaveLength(2);
  });

  test("chunks from other files are never siblings", () => {
    const chunks = [
      chunk({ path: "other-memory/facts/a.md", ordinal: 0 }),
      chunk({
        path: "other-memory/facts/b.md",
        ordinal: 1,
        text: "It is unrelated.",
        dependsOnPrevious: true,
      }),
    ];
    expect(siblingsFor(chunks[1], chunks, OPTIONS)).toEqual([]);
  });
});

describe("attachSiblings", () => {
  test("hits keep their order and count", () => {
    // Expansion runs after ranking, so it must not reorder or drop anything.
    const chunks = pair();
    const hits = [{ chunk: chunks[1] }, { chunk: chunks[0] }];
    const expanded = attachSiblings(hits, chunks, OPTIONS);
    expect(expanded).toHaveLength(2);
    expect(expanded[0].chunk.ordinal).toBe(1);
  });

  test("a sibling already returned as a hit is not attached twice", () => {
    const chunks = pair();
    const hits = [{ chunk: chunks[0] }, { chunk: chunks[1] }];
    const expanded = attachSiblings(hits, chunks, OPTIONS);
    expect(expanded.flatMap((hit) => hit.siblings)).toEqual([]);
  });

  test("a hit needing nothing gets nothing", () => {
    // Neither neighbour depends on the other, so neither is attached. The
    // point of the flag is that expansion is the exception, not the default —
    // otherwise every result drags its whole section into context.
    const chunks = [
      chunk({ ordinal: 0, text: "The mortgage was refinanced in 2020." }),
      chunk({ ordinal: 1, text: "The rate is TD Bank Prime minus 0.550%." }),
    ];
    const expanded = attachSiblings([{ chunk: chunks[0] }], chunks, OPTIONS);
    expect(expanded[0].siblings).toEqual([]);
  });

  test("the original hit fields survive", () => {
    const chunks = pair();
    const expanded = attachSiblings(
      [{ chunk: chunks[1], score: 0.9 }],
      chunks,
      OPTIONS,
    );
    expect(expanded[0].score).toBe(0.9);
  });
});
