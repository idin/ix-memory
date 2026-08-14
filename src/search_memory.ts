/**
 * Running a search, end to end.
 *
 * Everything the search does is in the modules this composes; what lives here
 * is the order they run in and the decisions that order encodes.
 *
 * The index is brought up to date first, because a search against a stale
 * index answers a question about the past without saying so. Ranking happens
 * before sibling expansion, so a neighbour's text cannot lift the score of a
 * chunk that did not itself match. And the candidate pool is wider than the
 * returned results, so the learning loop sees examples the ranker did not
 * favour — the sampling that stops a trained model inheriting the current
 * ranker's blind spots.
 */

import { chunkFile, chunkSearchText, type MemoryChunk } from "./chunking";
import {
  EMBEDDING_MODEL,
  EMBEDDING_POOLING,
  embedChunks,
  searchSemantically,
  type Embedder,
} from "./embeddings";
import { applyDepth } from "./deep_memory";
import { fuseByReciprocalRank, RECIPROCAL_RANK_CONSTANT } from "./hybrid_search";
import type { SearchResult } from "./hybrid_search";
import {
  planRebuild,
  readHeadCommit,
  type RebuildMode,
} from "./index_rebuild";
import {
  DEFAULT_FUZZY_MINIMUM_SCORE,
  searchLexically,
} from "./lexical_search";
import type { MemoryRepoConfig } from "./memory_repo";
import {
  hasPersistentIndex,
  type IndexIdentity,
  type IndexedChunk,
  type SearchIndexStore,
} from "./search_index";
import { MAXIMUM_SIBLINGS_PER_HIT, attachSiblings } from "./sibling_chunks";
import type { ExpandedHit } from "./sibling_chunks";
import { readWholeStore } from "./store_read";

/**
 * How many results a search returns by default.
 *
 * Chosen for what an agent will actually read before deciding, not for a round
 * number: past about five, results stop being read and start being skimmed,
 * and every one costs context that the deep-memory work exists to conserve.
 */
export const DEFAULT_SEARCH_LIMIT = 5;

/**
 * How many candidates are scored before the limit is applied.
 *
 * Wider than what is returned, deliberately. The extra candidates are the
 * sampling beyond top-N that stops relevance labels inheriting the current
 * ranker's blind spots: a model trained only on what the ranker already
 * favoured learns to reproduce it.
 */
export const CANDIDATE_POOL_SIZE = 20;

/** Resolved work is left out unless asked for, as everywhere else. */
export const DEFAULT_INCLUDE_DEEP = false;

export type SearchOptions = {
  query: string;
  limit: number;
  includeDeep: boolean;
};

export type SearchOutcome = {
  results: ExpandedHit<SearchResult>[];
  /** Every chunk searched, for reporting what was held back. */
  searched: MemoryChunk[];
  semanticAvailable: boolean;
  /** What the index had to do to answer this. */
  indexMode: RebuildMode;
  /** Why a full rebuild happened, when one did. */
  indexReason: string | null;
};

/**
 * Bring the index up to date and return every chunk in it.
 *
 * Falls back to reading and chunking the store in memory when no index is
 * configured, so search works without a database — lexically, since there is
 * nowhere to keep vectors.
 */
async function currentChunks(
  config: MemoryRepoConfig,
  store: SearchIndexStore,
  embed: Embedder | null,
): Promise<{
  indexed: IndexedChunk[];
  mode: RebuildMode;
  reason: string | null;
}> {
  if (!hasPersistentIndex(store)) {
    const files = await readWholeStore(config);
    return {
      indexed: files
        .flatMap((file) => chunkFile(file))
        .map((chunk) => ({ chunk, vector: null })),
      mode: "full",
      reason: "No index is configured, so the store was read directly.",
    };
  }

  const headSha = await readHeadCommit(config);
  const identity: IndexIdentity = {
    commitSha: headSha,
    model: EMBEDDING_MODEL,
    pooling: EMBEDDING_POOLING,
  };
  const builtSha = await store.builtCommit({
    model: EMBEDDING_MODEL,
    pooling: EMBEDDING_POOLING,
  });
  const plan = await planRebuild(config, builtSha, headSha);

  if (plan.mode === "up_to_date") {
    return { indexed: await store.load(identity), mode: plan.mode, reason: null };
  }

  if (plan.mode === "full") {
    const files = await readWholeStore(config);
    for (const file of files) {
      const chunks = chunkFile(file);
      const embedded = embed
        ? await embedChunks(chunks, embed)
        : chunks.map((chunk) => ({ chunk, vector: null }));
      await store.replaceFile(identity, file.path, embedded);
    }
    // Written after every chunk has landed. A crash before this leaves the
    // previous sha and the next run redoes the work; the opposite order would
    // claim a build that never finished.
    await store.recordBuiltCommit(identity);
    await store.discardOtherCommits(identity);
    return { indexed: await store.load(identity), mode: plan.mode, reason: plan.reason };
  }

  // Incremental: carry forward what the previous commit had, then apply only
  // what changed. Copying rather than diffing in place, because rows are keyed
  // by commit and the previous commit's rows stay readable for any session
  // still using them.
  if (builtSha) {
    const previous = await store.load({
      commitSha: builtSha,
      model: EMBEDDING_MODEL,
      pooling: EMBEDDING_POOLING,
    });
    const byPath = new Map<string, IndexedChunk[]>();
    for (const entry of previous) {
      const existing = byPath.get(entry.chunk.path) ?? [];
      existing.push(entry);
      byPath.set(entry.chunk.path, existing);
    }
    const changedPaths = new Set(plan.changes.map((change) => change.path));
    for (const [path, chunks] of byPath) {
      if (!changedPaths.has(path)) {
        await store.replaceFile(identity, path, chunks);
      }
    }
  }

  const files = await readWholeStore(config);
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const change of plan.changes) {
    if (change.kind === "delete") {
      await store.removeFile(identity, change.path);
      continue;
    }
    const file = byPath.get(change.path);
    if (!file) {
      continue;
    }
    const chunks = chunkFile(file);
    const embedded = embed
      ? await embedChunks(chunks, embed)
      : chunks.map((chunk) => ({ chunk, vector: null }));
    await store.replaceFile(identity, change.path, embedded);
  }

  await store.recordBuiltCommit(identity);
  await store.discardOtherCommits(identity);
  return { indexed: await store.load(identity), mode: plan.mode, reason: null };
}

/**
 * Search the memory store.
 *
 * @param config - Where the memory lives.
 * @param store - Where chunks and vectors are kept.
 * @param embed - How to embed, or null when unavailable.
 * @param options - The query and what to return.
 * @returns Results, and what the search could and could not see.
 */
export async function searchMemory(
  config: MemoryRepoConfig,
  store: SearchIndexStore,
  embed: Embedder | null,
  options: SearchOptions,
): Promise<SearchOutcome> {
  const { indexed, mode, reason } = await currentChunks(config, store, embed);

  const visiblePaths = new Set(
    applyDepth(
      indexed.map((entry) => entry.chunk.path),
      { includeDeep: options.includeDeep },
    ),
  );
  const visible = indexed.filter((entry) => visiblePaths.has(entry.chunk.path));
  const chunks = visible.map((entry) => entry.chunk);

  const lexical = searchLexically(chunks, options.query, {
    fuzzyMinimumScore: DEFAULT_FUZZY_MINIMUM_SCORE,
    limit: CANDIDATE_POOL_SIZE,
  });

  let semantic: ReturnType<typeof searchSemantically> = [];
  const semanticAvailable = embed !== null && visible.some((one) => one.vector);
  if (embed && semanticAvailable) {
    const [queryVector] = await embed([options.query]);
    semantic = searchSemantically(visible, queryVector, {
      limit: CANDIDATE_POOL_SIZE,
    });
  }

  const fused = fuseByReciprocalRank(lexical, semantic, {
    reciprocalRankConstant: RECIPROCAL_RANK_CONSTANT,
    limit: options.limit,
  });

  // After ranking, never before: expanding first would let a neighbour's text
  // lift the score of a chunk that did not match on its own.
  const results = attachSiblings(fused, chunks, {
    maximum: MAXIMUM_SIBLINGS_PER_HIT,
  });

  return {
    results,
    searched: indexed.map((entry) => entry.chunk),
    semanticAvailable,
    indexMode: mode,
    indexReason: reason,
  };
}

/** Re-exported so a caller can embed the same text the index did. */
export { chunkSearchText };
