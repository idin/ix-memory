/**
 * Running a search, end to end.
 *
 * Everything the search does is in the modules this composes; what lives here
 * is the order they run in and the decisions that order encodes.
 *
 * The index is brought up to date first, because a search against a stale
 * index answers a question about the past without saying so. Selection happens
 * before sibling expansion, so a neighbour's text cannot pull in a chunk that
 * did not itself match.
 *
 * Nothing here ranks results against each other across methods. Recall is the
 * goal: precision is recoverable by whoever reads the results, and recall is
 * not recoverable by anyone, since nothing downstream can retrieve what was
 * never returned. Selection is a per-method cascade — see search_cascade.ts.
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
import { cascadeResults, type CascadeResult } from "./search_cascade";
import {
  FILES_INDEXED_PER_SEARCH,
  FUZZY_FLOOR,
  MAXIMUM_SIBLINGS_PER_HIT,
  cosinePoolSize,
  type SearchQuotas,
} from "./search_config";
import {
  planRebuild,
  readHeadCommit,
  type RebuildMode,
} from "./index_rebuild";
import { searchLexically } from "./lexical_search";
import type { MemoryRepoConfig } from "./memory_repo";
import {
  hasPersistentIndex,
  type IndexIdentity,
  type IndexedChunk,
  type SearchIndexStore,
} from "./search_index";
import { attachSiblings } from "./sibling_chunks";
import type { ExpandedHit } from "./sibling_chunks";
import {
  listStoreTree,
  readStoreBlobs,
  readWholeStore,
  type StoreFileWithSha,
} from "./store_read";

/** Resolved work is left out unless asked for, as everywhere else. */
export const DEFAULT_INCLUDE_DEEP = false;

/**
 * List the store, then fetch text for only a bounded slice of it.
 *
 * Listing is one or two requests regardless of store size; fetching text is
 * what scales per file. Filtering and slicing before fetching is what keeps a
 * batched rebuild's subrequest count bounded by the batch size rather than by
 * the size of the store.
 *
 * @param config - Where the memory lives.
 * @param options.exclude - Paths to leave out before slicing, e.g. what a
 *   resumed build has already indexed.
 * @param options.limit - How many files this batch may fetch.
 * @returns The batch's files with text, and how many eligible files remained
 *   beyond it.
 */
async function readBoundedBatch(
  config: MemoryRepoConfig,
  options: { exclude: Set<string>; limit: number },
): Promise<{ batch: StoreFileWithSha[]; totalEligible: number }> {
  const refs = await listStoreTree(config);
  const eligible = refs.filter((ref) => !options.exclude.has(ref.path));
  const batchRefs = eligible.slice(0, options.limit);
  const batch = await readStoreBlobs(config, batchRefs);
  return { batch, totalEligible: eligible.length };
}

export type SearchOptions = {
  query: string;
  /** How many results each tier of the cascade may contribute. */
  quotas: SearchQuotas;
  includeDeep: boolean;
};

export type SearchOutcome = {
  results: ExpandedHit<CascadeResult>[];
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
    // What is already indexed at this commit, so a resumed build picks up
    // where the previous search stopped rather than starting again.
    const alreadyIndexed = new Set(
      (await store.load(identity)).map((entry) => entry.chunk.path),
    );
    const { batch, totalEligible } = await readBoundedBatch(config, {
      exclude: alreadyIndexed,
      limit: FILES_INDEXED_PER_SEARCH,
    });

    for (const file of batch) {
      const chunks = chunkFile(file);
      const embedded = embed
        ? await embedChunks(chunks, embed)
        : chunks.map((chunk) => ({ chunk, vector: null }));
      await store.replaceFile(identity, file.path, embedded);
    }

    const stillMissing = totalEligible - batch.length;
    if (stillMissing > 0) {
      // Deliberately not recording the commit as built. The sha means "every
      // file at this commit is indexed", and claiming it early would make
      // every later search skip the rest — a permanently partial index
      // reporting itself as complete.
      return {
        indexed: await store.load(identity),
        mode: plan.mode,
        reason:
          `Indexed ${alreadyIndexed.size + batch.length} of `
          + `${alreadyIndexed.size + totalEligible} files so far. A Worker `
          + `can only make so many calls per request, so the index is built `
          + `across several searches. Results below cover what is indexed; `
          + `search again to continue — ${stillMissing} file(s) to go.`,
      };
    }

    // Written after every chunk has landed. A crash before this leaves the
    // previous sha and the next run redoes the work; the opposite order would
    // claim a build that never finished.
    await store.recordBuiltCommit(identity);
    await store.discardOtherCommits(identity);
    return {
      indexed: await store.load(identity),
      mode: plan.mode,
      reason:
        `Index complete: ${alreadyIndexed.size + batch.length} files.`,
    };
  }

  // Incremental: carry forward what the previous commit had, then apply only
  // what changed. Rows are keyed by commit, so the previous commit's rows stay
  // readable for any session still using them.
  //
  // Carrying forward is one bulk copy rather than a write per file. Writing
  // each file separately would cost a subrequest per unchanged file, which for
  // a one-file edit means paying nearly the price of a full rebuild to avoid
  // one.
  if (builtSha) {
    const changedPaths = new Set(plan.changes.map((change) => change.path));
    await store.carryForward({
      from: {
        commitSha: builtSha,
        model: EMBEDDING_MODEL,
        pooling: EMBEDDING_POOLING,
      },
      to: identity,
      exceptPaths: [...changedPaths],
    });
  }

  // Only the changed files scheduled this round need their text — an
  // unbounded fetch here would cost a subrequest per changed file regardless
  // of how many `FILES_INDEXED_PER_SEARCH` allows this call to use.
  const changesThisRound = plan.changes.slice(0, FILES_INDEXED_PER_SEARCH);
  const upsertPaths = new Set(
    changesThisRound
      .filter((change) => change.kind === "upsert")
      .map((change) => change.path),
  );
  const refs = (await listStoreTree(config)).filter((ref) =>
    upsertPaths.has(ref.path),
  );
  const byPath = new Map(
    (await readStoreBlobs(config, refs)).map((file) => [file.path, file]),
  );
  for (const change of changesThisRound) {
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

  const unprocessed = plan.changes.length - FILES_INDEXED_PER_SEARCH;
  if (unprocessed > 0) {
    return {
      indexed: await store.load(identity),
      mode: plan.mode,
      reason:
        `${unprocessed} changed file(s) still to index. Search again to `
        + "continue.",
    };
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

  // Every lexical candidate, unsorted and uncapped. Cutting here would
  // discard candidates the cascade has not yet had the chance to consider.
  const lexical = searchLexically(chunks, options.query, {
    fuzzyMinimumScore: FUZZY_FLOOR,
  });

  const exactCount = lexical.filter((hit) => hit.scores.exact > 0).length;

  let semantic: ReturnType<typeof searchSemantically> = [];
  const semanticAvailable = embed !== null && visible.some((one) => one.vector);
  if (embed && semanticAvailable) {
    const [queryVector] = await embed([options.query]);
    // Wide enough that the tiers above it can take their share without
    // starving the semantic quota — the pool is cut before the cascade runs,
    // so it must account for what earlier tiers will claim from it.
    semantic = searchSemantically(visible, queryVector, {
      limit: cosinePoolSize(options.quotas, exactCount),
    });
  }

  const selected = cascadeResults(lexical, semantic, options.quotas);

  // After selection, never before: expanding first would let a neighbour's
  // text pull in a chunk that did not match on its own.
  const results = attachSiblings(selected, chunks, {
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
