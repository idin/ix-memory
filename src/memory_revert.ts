import { Octokit } from "octokit";

import { NAMESPACE } from "./layout";
import type { MemoryRepoConfig } from "./memory_repo";
import { commitTreeChanges } from "./memory_tree";


export type RevertPlan = {
  targetCommitSha: string;
  targetCommitDate: string;
  targetCommitMessage: string;
  restored: string[];
  removed: string[];
  unchanged: number;
};

/**
 * Work out what reverting `memory/` to its state at `timestamp` would change,
 * without changing anything. Used both for the preview and, after
 * confirmation, as the plan that gets applied.
 */
export async function planRevert(
  config: MemoryRepoConfig,
  timestamp: string,
): Promise<RevertPlan> {
  const when = new Date(timestamp);
  if (Number.isNaN(when.getTime())) {
    throw new Error(
      `Could not parse "${timestamp}". Use an ISO 8601 timestamp, `
        + "e.g. 2026-08-08T14:30:00Z.",
    );
  }

  const octokit = new Octokit({ auth: config.token });

  const commits = await octokit.rest.repos.listCommits({
    owner: config.owner,
    repo: config.repo,
    sha: config.branch,
    until: when.toISOString(),
    per_page: 1,
  });

  const target = commits.data[0];
  if (!target) {
    throw new Error(
      `No commit exists at or before ${when.toISOString()}; nothing to revert to.`,
    );
  }

  const [thenFiles, nowFiles] = await Promise.all([
    memoryFilesAt(octokit, config, target.sha),
    memoryFilesAt(octokit, config, config.branch),
  ]);

  const restored: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const [path, sha] of thenFiles) {
    if (nowFiles.get(path) === sha) {
      unchanged += 1;
    } else {
      restored.push(path);
    }
  }
  for (const path of nowFiles.keys()) {
    if (!thenFiles.has(path)) {
      removed.push(path);
    }
  }

  return {
    targetCommitSha: target.sha,
    targetCommitDate: target.commit.author?.date ?? "unknown",
    targetCommitMessage: (target.commit.message ?? "").split("\n")[0],
    restored: restored.sort(),
    removed: removed.sort(),
    unchanged,
  };
}

/**
 * Apply a revert as a NEW commit restoring the old state. History is never
 * rewritten, so the reverted-away content stays reachable and the revert
 * itself can be reverted.
 */
export async function applyRevert(
  config: MemoryRepoConfig,
  plan: RevertPlan,
  commitMessage: string,
): Promise<{ commitSha: string; filesChanged: number }> {
  if (plan.restored.length === 0 && plan.removed.length === 0) {
    throw new Error("Nothing to revert — memory/ already matches that state.");
  }

  const octokit = new Octokit({ auth: config.token });

  const restoredContents = await Promise.all(
    plan.restored.map(async (path) => ({
      path,
      content: await contentAt(octokit, config, plan.targetCommitSha, path),
    })),
  );

  const commitSha = await commitTreeChanges(octokit, config, commitMessage, [
    ...restoredContents,
    ...plan.removed.map((path) => ({ path, sha: null as null })),
  ]);

  return {
    commitSha,
    filesChanged: plan.restored.length + plan.removed.length,
  };
}

/** Map of `memory/` path to blob sha at a given ref. */
async function memoryFilesAt(
  octokit: Octokit,
  config: MemoryRepoConfig,
  ref: string,
): Promise<Map<string, string>> {
  const tree = await octokit.rest.git.getTree({
    owner: config.owner,
    repo: config.repo,
    tree_sha: ref,
    recursive: "true",
  });

  const files = new Map<string, string>();
  for (const entry of tree.data.tree) {
    const path = entry.path ?? "";
    if (entry.type === "blob" && path.startsWith(NAMESPACE) && entry.sha) {
      files.set(path, entry.sha);
    }
  }
  return files;
}

async function contentAt(
  octokit: Octokit,
  config: MemoryRepoConfig,
  ref: string,
  path: string,
): Promise<string> {
  const response = await octokit.rest.repos.getContent({
    owner: config.owner,
    repo: config.repo,
    path,
    ref,
  });
  const file = response.data;
  if (Array.isArray(file) || file.type !== "file") {
    throw new Error(`Not a file at ${ref}: ${path}`);
  }
  const binary = atob(file.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
