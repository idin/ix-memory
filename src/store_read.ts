/**
 * Reading the whole store at once.
 *
 * Two callers need every file rather than one: the suggestion survey, which
 * runs mechanical checks across the store, and search, which scores every
 * chunk. Both want the same three things — the path, the text, and the blob
 * sha that says whether the text has changed since last time.
 *
 * The blob sha matters more than it looks. It is a content hash, so an
 * unchanged sha means the chunks and embeddings derived from that file are
 * still valid and need not be recomputed. Discarding it, as the earlier
 * version of this code did, forces a rebuild to re-read and re-derive
 * everything.
 */

import { Octokit } from "octokit";

import { NAMESPACE } from "./layout";
import { decodeBase64 } from "./base64";
import type { MemoryRepoConfig } from "./memory_repo";
import type { StoreFile } from "./store_checks";

/**
 * How many blobs to fetch at once.
 *
 * GitHub documents two secondary limits that bear on this: no more than 100
 * concurrent requests across the REST and GraphQL APIs, and 900 points per
 * minute against a single endpoint, where a GET costs one point.
 *
 * Concurrency is therefore not the binding constraint — the per-minute budget
 * is, and only for stores in the high hundreds of files. This sits well below
 * both, because the cost of being wrong is asymmetric: too low merely takes
 * longer, while too high earns a secondary-limit block that affects every
 * other tool on this server, not just the one that triggered it.
 */
export const BLOB_FETCH_CONCURRENCY = 16;

/** A file, its text, and the content hash that says whether it changed. */
export type StoreFileWithSha = StoreFile & { sha: string };

/**
 * Thrown when GitHub truncates the tree listing.
 *
 * Recursive tree responses are truncated above 100,000 entries or 7 MB, and
 * the flag saying so is easy to ignore. Ignoring it means indexing part of the
 * store and reporting success — an agent then answers confidently from a store
 * it could not see all of, which is the failure this whole system is built to
 * avoid. Loud beats partial.
 */
export class TruncatedTreeError extends Error {
  constructor() {
    super(
      "GitHub truncated the repository tree, so this listing is incomplete. "
        + "Anything derived from it would silently cover only part of the "
        + "store.",
    );
    this.name = "TruncatedTreeError";
  }
}

/**
 * Run tasks with a ceiling on how many are in flight at once.
 *
 * @param items - What to work through.
 * @param limit - How many may run concurrently.
 * @param run - What to do with each item.
 * @returns The results, in the order the items were given.
 */
async function mapWithConcurrency<Item, Result>(
  items: Item[],
  limit: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Read every file in the namespace, with its text and content hash.
 *
 * @param config - Where the memory lives.
 * @returns Every file in the namespace, sorted by path.
 * @throws TruncatedTreeError - When GitHub returns a partial tree.
 */
export async function readWholeStore(
  config: MemoryRepoConfig,
): Promise<StoreFileWithSha[]> {
  const octokit = new Octokit({ auth: config.token });
  const branch = await octokit.rest.repos.getBranch({
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
  });
  const tree = await octokit.rest.git.getTree({
    owner: config.owner,
    repo: config.repo,
    tree_sha: branch.data.commit.sha,
    recursive: "true",
  });

  if (tree.data.truncated) {
    throw new TruncatedTreeError();
  }

  const blobs = (tree.data.tree ?? [])
    .filter(
      (node) =>
        node.type === "blob" && (node.path ?? "").startsWith(NAMESPACE),
    )
    .map((node) => ({
      path: node.path ?? "",
      bytes: node.size ?? 0,
      sha: node.sha ?? "",
    }));

  // The tree already carries every blob's sha, so read blobs by sha rather
  // than paths by ref. One request per file either way, but this cannot race
  // a concurrent write: a sha names one immutable object, where a path names
  // whatever is there when the request lands.
  return mapWithConcurrency(
    blobs,
    BLOB_FETCH_CONCURRENCY,
    async ({ path, bytes, sha }) => {
      const blob = await octokit.rest.git.getBlob({
        owner: config.owner,
        repo: config.repo,
        file_sha: sha,
      });
      return { path, bytes, sha, text: decodeBase64(blob.data.content) };
    },
  );
}
