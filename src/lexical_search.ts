/**
 * Scoring chunks against a query, without embeddings.
 *
 * Five methods, one pass. The four anchored ones — exact, starts with, ends
 * with, contains — are the same scan with different anchors, so they are not
 * four separate implementations and should not be four separate tools. Fuzzy
 * is the fifth.
 *
 * Every method is scored for every chunk, always. Nothing selects one. That
 * matters twice over: hybrid ranking needs all of them to fuse, and the
 * learning loop needs the full feature vector per candidate, so computing one
 * and discarding the rest would destroy the training data before it is
 * collected.
 */

import { chunkSearchText, type MemoryChunk } from "./chunking";
import {
  bestTokenAlignment,
  tokenSetRatio,
  tokenSortRatio,
} from "./text_similarity";

/**
 * The fuzzy score below which a hit is noise rather than a weak match.
 *
 * Jaro-Winkler is generous with short strings: two unrelated four-letter
 * tokens sharing a first letter can reach the low 0.6s, so a floor below that
 * admits everything and makes the method meaningless. This sits above that
 * band while staying below the ~0.9 a genuine typo scores.
 */
export const DEFAULT_FUZZY_MINIMUM_SCORE = 0.72;

/** The five ways a chunk can match, all scored for every chunk. */
export type MatchMethod =
  | "exact"
  | "starts_with"
  | "ends_with"
  | "contains"
  | "fuzzy";

/**
 * Every method's score for one chunk.
 *
 * Named from the field's side throughout: the field contains the query, the
 * field starts with the query. The genuine reverse — the query containing the
 * field — is a different operation and is not implemented.
 */
export type LexicalScores = Record<MatchMethod, number>;

export type LexicalHit = {
  chunk: MemoryChunk;
  scores: LexicalScores;
  /** The strongest method, for explaining the hit. */
  bestMethod: MatchMethod;
  /** The best score across methods, for ranking. */
  bestScore: number;
  /** Where in the text the match landed, for quoting it back. */
  matchedAt: number | null;
};

/**
 * Score one field against a query, by every method.
 *
 * @param query - What was searched for.
 * @param field - The text being searched.
 * @returns One score per method, each in [0, 1].
 */
export function scoreLexically(query: string, field: string): LexicalScores {
  const normalisedQuery = query.trim().toLowerCase();
  const normalisedField = field.toLowerCase();

  if (normalisedQuery.length === 0) {
    return {
      exact: 0,
      starts_with: 0,
      ends_with: 0,
      contains: 0,
      fuzzy: 0,
    };
  }

  // Anchored methods are binary: a field either starts with the query or it
  // does not. Graduating them would blur into what fuzzy already measures.
  const exact = normalisedField.trim() === normalisedQuery ? 1 : 0;
  const startsWith = normalisedField.startsWith(normalisedQuery) ? 1 : 0;
  const endsWith = normalisedField.trimEnd().endsWith(normalisedQuery) ? 1 : 0;
  const contains = normalisedField.includes(normalisedQuery) ? 1 : 0;

  // Three fuzzy views, kept as the strongest rather than averaged: they
  // disagree by design, and a query that only one of them recognises is still
  // a match. Averaging would let two indifferent scores bury one good one.
  const fuzzy = Math.max(
    bestTokenAlignment(query, field),
    tokenSortRatio(query, field),
    tokenSetRatio(query, field),
  );

  return {
    exact,
    starts_with: startsWith,
    ends_with: endsWith,
    contains,
    fuzzy,
  };
}

/** Which method scored highest, preferring the most specific on ties. */
function strongestMethod(scores: LexicalScores): MatchMethod {
  const order: MatchMethod[] = [
    "exact",
    "starts_with",
    "ends_with",
    "contains",
    "fuzzy",
  ];
  let best: MatchMethod = "fuzzy";
  let bestScore = -1;
  for (const method of order) {
    if (scores[method] > bestScore) {
      best = method;
      bestScore = scores[method];
    }
  }
  return best;
}

/**
 * Score every chunk against a query, keeping those that matched.
 *
 * @param chunks - The chunks to search.
 * @param query - What was searched for.
 * @param options - The fuzzy floor, and how many hits to return.
 * @returns Hits, best first.
 */
export function searchLexically(
  chunks: MemoryChunk[],
  query: string,
  options: { fuzzyMinimumScore: number; limit: number },
): LexicalHit[] {
  const hits: LexicalHit[] = [];

  for (const chunk of chunks) {
    // Scored against the search text rather than the body, so a query naming
    // a section ("second-hand", "Money") reaches the facts under it.
    const field = chunkSearchText(chunk);
    const scores = scoreLexically(query, field);
    const bestMethod = strongestMethod(scores);
    const bestScore = scores[bestMethod];

    const anchored =
      scores.exact + scores.starts_with + scores.ends_with + scores.contains;
    if (anchored === 0 && scores.fuzzy < options.fuzzyMinimumScore) {
      continue;
    }

    const found = field.toLowerCase().indexOf(query.trim().toLowerCase());
    hits.push({
      chunk,
      scores,
      bestMethod,
      bestScore,
      matchedAt: found >= 0 ? found : null,
    });
  }

  return hits
    .sort((first, second) => second.bestScore - first.bestScore)
    .slice(0, options.limit);
}
