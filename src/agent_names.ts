/**
 * Agent names are free-form: the user tells one chat it is "Ada" and another
 * "Scout", and nothing is registered in advance. That makes matching the hard
 * part — "Ada", "ada", "A-D-A" and " Ada " all mean the same mailbox.
 *
 * All matching happens here rather than being left to a model to remember,
 * so the same input always resolves the same way.
 */

/**
 * Canonical key for a name: lowercased, with spaces, dashes and underscores
 * removed. This is what mailbox lookup compares on.
 */
export function normalizeAgentName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s\-_.]/g, "");

  if (normalized.length === 0) {
    throw new Error(`Agent name "${name}" normalizes to nothing.`);
  }
  return normalized;
}

/**
 * Filesystem-safe form of a name, used for directory names. Keeps the
 * normalized key rather than the raw name so one agent never ends up with two
 * directories.
 */
export function agentDirectoryName(name: string): string {
  const key = normalizeAgentName(name);
  if (!/^[a-z0-9]+$/.test(key)) {
    throw new Error(
      `Agent name "${name}" contains characters that cannot be used in a path. `
        + "Use letters and digits, optionally separated by spaces, dashes or "
        + "underscores.",
    );
  }
  return key;
}

/** Levenshtein distance, capped — used only to suggest near-misses. */
function editDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let i = 0; i < left.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < right.length; j += 1) {
      const substitution = previous[j] + (left[i] === right[j] ? 0 : 1);
      current[j + 1] = Math.min(current[j] + 1, previous[j + 1] + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export type NameMatch = {
  /** Exact match on the normalized key, if one exists. */
  exact: string | null;
  /** Close-but-not-equal candidates, nearest first. */
  near: string[];
};

/**
 * Resolve a name against the mailboxes that actually exist.
 *
 * Returns an exact match when the normalized keys are equal, plus near misses
 * so a caller can say "no mailbox 'adda' — did you mean 'ada'?" rather than
 * silently creating a second mailbox for a typo.
 */
export function matchAgentName(
  requested: string,
  existing: string[],
): NameMatch {
  const key = normalizeAgentName(requested);
  const normalizedExisting = existing.map((name) => ({
    original: name,
    key: normalizeAgentName(name),
  }));

  const exact = normalizedExisting.find((entry) => entry.key === key);
  if (exact) {
    return { exact: exact.original, near: [] };
  }

  const threshold = key.length <= 4 ? 1 : 2;
  const near = normalizedExisting
    .map((entry) => ({
      original: entry.original,
      distance: editDistance(key, entry.key),
    }))
    .filter((entry) => entry.distance <= threshold)
    .sort((left, right) => left.distance - right.distance)
    .map((entry) => entry.original);

  return { exact: null, near };
}
