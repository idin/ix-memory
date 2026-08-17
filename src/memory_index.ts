/**
 * Where chunks and their vectors are kept.
 *
 * The index is a pure function of the commit: the same commit produces the
 * same chunks and the same vectors, every time. That fact decides the design.
 * Rows are keyed by commit sha, so the first session to build at a commit
 * builds it for every other session, and a session arriving at an
 * already-built commit does no work at all. Per-session storage would
 * re-embed the whole store on every connection, computing data a previous
 * session already computed.
 *
 * It also means there is nothing to invalidate. Cache validity is one
 * comparison — built sha against HEAD — rather than a mechanism.
 *
 * This file defines the contract only. The library cannot assume a database
 * exists, because for most people running it none does. A deployment supplies
 * one; without it, search still works lexically and says so, which matters
 * more than it sounds: a silently lexical-only search returns nothing for
 * "canine" and reads as "not in the store".
 */

import type { MemoryChunk } from "./chunking";

/** A chunk with its vector, as stored in the memory index. */
export type MemoryIndexChunk = {
  chunk: MemoryChunk;
  /** Null when the chunk is stored but not yet embedded. */
  vector: Float32Array | null;
};

/**
 * How a build identifies itself.
 *
 * The commit alone is not enough. Vectors from two embedding models, or two
 * pooling modes of one model, are not comparable — Cloudflare's own
 * documentation says cls and mean embeddings "are not compatible" — and
 * comparing across them returns a plausible number rather than an error. So
 * the model and pooling travel with the commit, and a change in any of the
 * three is a different index.
 */
export type MemoryIndexIdentity = {
  commitSha: string;
  model: string;
  pooling: string;
};

/**
 * The memory store's search index: chunk text and vectors, derived from the
 * memory files at one commit.
 *
 * Deliberately small, and deliberately not SQL: a deployment might use D1,
 * Durable Object storage, or something else entirely, and the library should
 * not care which.
 */
export type MemoryIndex = {
  /**
   * How many paths `carryForward` can exclude in one call, or `null` when
   * there is no such limit.
   *
   * A store backed by a statement with a bound-parameter cap (D1's is 100)
   * cannot exclude more paths than that cap allows minus its fixed
   * parameters — `carryForward`'s own exclusion list is bound as one
   * parameter per path, alongside a handful of fixed ones. A commit
   * changing more files than fit is a case `carryForward` cannot answer
   * correctly, the same way an untracked base commit or a truncated
   * comparison already are: the caller falls back to a full rebuild rather
   * than call `carryForward` with more paths than it can hold.
   */
  maxCarryForwardExclusions: number | null;
  /** Read every chunk for an identity, with vectors where they exist. */
  load(identity: MemoryIndexIdentity): Promise<MemoryIndexChunk[]>;
  /** Replace every chunk for one file. Delete-then-insert, not update. */
  replaceFile(
    identity: MemoryIndexIdentity,
    path: string,
    chunks: MemoryIndexChunk[],
  ): Promise<void>;
  /** Remove every chunk for one file. */
  removeFile(identity: MemoryIndexIdentity, path: string): Promise<void>;
  /**
   * Copy one commit's rows to another, skipping the paths that changed.
   *
   * One operation rather than a write per file, because a Worker's outbound
   * calls are capped per request. Copying file by file would cost a call for
   * every unchanged file, so editing one file in a large store would pay
   * nearly the price of a full rebuild to avoid one.
   */
  carryForward(options: {
    from: MemoryIndexIdentity;
    to: MemoryIndexIdentity;
    exceptPaths: string[];
  }): Promise<void>;

  /** Which commit this identity was last fully built from, if any. */
  builtCommit(
    identity: Omit<MemoryIndexIdentity, "commitSha">,
  ): Promise<string | null>;
  /** Record that a build finished. Called last, deliberately. */
  recordBuiltCommit(identity: MemoryIndexIdentity): Promise<void>;
  /** Drop everything for commits other than the one given. */
  discardOtherCommits(identity: MemoryIndexIdentity): Promise<void>;
};

/**
 * The memory index used when a deployment provides none.
 *
 * Reads empty and discards writes, so every search is a fresh lexical-only
 * search. Correct, and slower than it needs to be, which is the right
 * trade for a library that cannot assume infrastructure.
 */
export const noOpMemoryIndex: MemoryIndex = {
  maxCarryForwardExclusions: null,
  load: async () => [],
  replaceFile: async () => {},
  removeFile: async () => {},
  carryForward: async () => {},
  builtCommit: async () => null,
  recordBuiltCommit: async () => {},
  discardOtherCommits: async () => {},
};

/**
 * Whether a memory index is real.
 *
 * Used to tell the caller that semantic search is unavailable, rather than
 * returning lexical-only results as though they were the whole answer.
 */
export function hasPersistentMemoryIndex(index: MemoryIndex): boolean {
  return index !== noOpMemoryIndex;
}

/**
 * Pack a vector for storage as bytes.
 *
 * Stored as raw Float32 rather than JSON: 3,072 bytes against roughly 9,000
 * for the text form, no parse on the way back, and no precision lost to
 * decimal rounding.
 *
 * @param vector - The embedding.
 * @returns Its bytes.
 */
export function packVector(vector: Float32Array): ArrayBuffer {
  return vector.buffer.slice(
    vector.byteOffset,
    vector.byteOffset + vector.byteLength,
  ) as ArrayBuffer;
}

/**
 * Unpack a stored vector.
 *
 * D1 documents BLOB columns as coming back as an `ArrayBuffer`, but in
 * production some driver versions return a plain array of byte values
 * instead (cloudflare/workers-sdk#8642). `new Float32Array` does not error on
 * that — it treats the array as array-like and produces one float per byte,
 * four times too long, silently. Normalising here means every caller gets a
 * real embedding regardless of which shape the binding handed back, rather
 * than each one needing to know about a driver bug that has nothing to do
 * with what they are trying to do.
 *
 * @param bytes - What was stored: an `ArrayBuffer`, or a plain array of byte
 *   values if the D1 binding returned one instead.
 * @returns The embedding.
 */
export function unpackVector(bytes: ArrayBuffer | number[]): Float32Array {
  const buffer = Array.isArray(bytes) ? new Uint8Array(bytes).buffer : bytes;
  return new Float32Array(buffer);
}

/**
 * Serialise the parts of a chunk that are not scalars.
 *
 * Heading paths and superseded spans are lists, and a store may only accept
 * scalars. JSON is used rather than a delimiter because a heading can contain
 * any character, including whichever delimiter looked safe.
 */
export function packChunk(chunk: MemoryChunk): {
  headingPath: string;
  superseded: string;
} {
  return {
    headingPath: JSON.stringify(chunk.headingPath),
    superseded: JSON.stringify(chunk.superseded),
  };
}

/** Restore a chunk's lists from their stored form. */
export function unpackChunkLists(row: {
  headingPath: string;
  superseded: string;
}): { headingPath: string[]; superseded: string[] } {
  return {
    headingPath: JSON.parse(row.headingPath) as string[],
    superseded: JSON.parse(row.superseded) as string[],
  };
}
