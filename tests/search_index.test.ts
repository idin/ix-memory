import { describe, expect, test } from "vitest";

import {
  hasPersistentIndex,
  noOpSearchIndexStore,
  packChunk,
  packVector,
  unpackChunkLists,
  unpackVector,
} from "../src/search_index";
import { chunk } from "./chunk_fixture";

/**
 * Storage is where corruption hides. A vector that survives a round trip
 * slightly changed still produces a number from cosine similarity — a wrong
 * one, with nothing to signal it — so the round trip is tested for exactness
 * rather than approximate equality.
 */

describe("vectors survive storage exactly", () => {
  test("a round trip changes nothing", () => {
    const vector = new Float32Array([0.1, -0.25, 0.5, 0]);
    expect([...unpackVector(packVector(vector))]).toEqual([...vector]);
  });

  test("a full-size embedding survives", () => {
    // 768 dimensions, the size bge-base actually produces.
    const vector = new Float32Array(768).map(
      (_unused, index) => Math.sin(index) / 2,
    );
    expect([...unpackVector(packVector(vector))]).toEqual([...vector]);
  });

  test("the packed form is four bytes per dimension", () => {
    // Raw Float32 rather than JSON: 3,072 bytes against roughly 9,000 for the
    // text form, with no parse on the way back and no precision lost to
    // decimal rounding.
    expect(packVector(new Float32Array(768)).byteLength).toBe(3072);
  });

  test("a vector inside a larger buffer packs only its own bytes", () => {
    // Float32Array.buffer returns the whole underlying buffer, so a subarray
    // would otherwise carry its neighbours along with it.
    const backing = new Float32Array([1, 2, 3, 4, 5, 6]);
    const slice = backing.subarray(2, 5);
    expect(packVector(slice).byteLength).toBe(12);
    expect([...unpackVector(packVector(slice))]).toEqual([3, 4, 5]);
  });
});

describe("chunk lists survive storage", () => {
  test("a heading path round-trips", () => {
    const original = chunk({
      headingPath: ["Core", "Imported 2026-08-08 (second-hand)", "Money"],
    });
    expect(unpackChunkLists(packChunk(original)).headingPath).toEqual(
      original.headingPath,
    );
  });

  test("a heading containing a delimiter survives", () => {
    // Why JSON rather than joining on a separator: a heading can contain any
    // character, including whichever separator looked safe at the time.
    const original = chunk({
      headingPath: ["A > B", "C, D", 'E "F"', "G|H"],
    });
    expect(unpackChunkLists(packChunk(original)).headingPath).toEqual(
      original.headingPath,
    );
  });

  test("superseded spans round-trip", () => {
    const original = chunk({ superseded: ["Mid-40s.", "13-year-old"] });
    expect(unpackChunkLists(packChunk(original)).superseded).toEqual(
      original.superseded,
    );
  });

  test("empty lists round-trip as empty, not null", () => {
    const packed = packChunk(chunk({ headingPath: [], superseded: [] }));
    expect(unpackChunkLists(packed)).toEqual({
      headingPath: [],
      superseded: [],
    });
  });
});

describe("the default store", () => {
  test("reads empty", async () => {
    expect(
      await noOpSearchIndexStore.load({
        commitSha: "abc",
        model: "m",
        pooling: "mean",
      }),
    ).toEqual([]);
  });

  test("reports no previous build, which means a full one", async () => {
    expect(
      await noOpSearchIndexStore.builtCommit({ model: "m", pooling: "mean" }),
    ).toBeNull();
  });

  test("writes are discarded without failing", async () => {
    // A deployment without a database still works; it simply keeps nothing.
    await expect(
      noOpSearchIndexStore.replaceFile(
        { commitSha: "abc", model: "m", pooling: "mean" },
        "ix/memory/facts/x.md",
        [{ chunk: chunk(), vector: null }],
      ),
    ).resolves.toBeUndefined();
  });

  test("is recognisable as absent", () => {
    // So the tool can say semantic search is unavailable rather than
    // returning lexical-only results as though they were the whole answer.
    expect(hasPersistentIndex(noOpSearchIndexStore)).toBe(false);
  });

  test("a real store is recognisable as present", () => {
    expect(
      hasPersistentIndex({ ...noOpSearchIndexStore }),
    ).toBe(true);
  });
});
