/**
 * Scoring chunks against a query, without embeddings.
 *
 * Six methods, one pass. Five are anchored — exact, starts with, ends with,
 * contains, contained by — and are the same scan with different anchors, so
 * they are not five implementations and should not be five tools. Fuzzy is
 * the sixth.
 *
 * `contains` and `contained_by` are opposite directions of the same
 * relationship, and both are needed. A short query finds long chunks by
 * `contains`; a long query finds short chunks by `contained_by`. Without the
 * second, asking a full question reaches nothing, because no chunk holds the
 * whole question.
 *
 * Every method is scored for every chunk, always. Nothing selects one, because
 * the learning loop needs the full feature vector per candidate — computing
 * one and discarding the rest would destroy the training data before it is
 * collected.
 */

import { chunkSearchText, type MemoryChunk } from "./chunking";
import { bestTokenAlignment } from "./text_similarity";

/**
 * The fuzzy score below which a hit is noise rather than a weak match.
 *
 * Jaro-Winkler is generous with short strings: two unrelated four-letter
 * tokens sharing a first letter can reach the low 0.6s, so a floor below that
 * admits everything and makes the method meaningless. This sits above that
 * band while staying below the ~0.9 a genuine typo scores.
 */
export const DEFAULT_FUZZY_MINIMUM_SCORE = 0.72;

/**
 * The shortest field that may count as contained by the query.
 *
 * Without a floor, any chunk shorter than the query matches on a fragment —
 * a stray word, a bare date — and the method fires on everything, which is
 * the same as meaning nothing.
 */
const MINIMUM_CONTAINED_BY_LENGTH = 8;

/** The six ways a chunk can match, all scored for every chunk. */
export type MatchMethod =
  | "exact"
  | "starts_with"
  | "ends_with"
  | "contains"
  | "contained_by"
  | "fuzzy";

/**
 * Every method's score for one chunk.
 *
 * Named from the field's side throughout: the field contains the query, the
 * field starts with the query, the field is contained by the query.
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
      contained_by: 0,
      fuzzy: 0,
    };
  }

  // Anchored methods are binary: a field either starts with the query or it
  // does not. Graduating them would blur into what fuzzy already measures.
  const exact = normalisedField.trim() === normalisedQuery ? 1 : 0;
  const startsWith = normalisedField.startsWith(normalisedQuery) ? 1 : 0;
  const endsWith = normalisedField.trimEnd().endsWith(normalisedQuery) ? 1 : 0;
  const contains = normalisedField.includes(normalisedQuery) ? 1 : 0;

  // The reverse direction: the field appears inside the query. Finds the
  // short entries a long question passes over — asking "what is Frodo's
  // collar size in inches" reaches a chunk reading "Neck: 7.5 inches",
  // which `contains` cannot, because the field holds only a fraction of
  // what was asked.
  //
  // Trimmed and length-guarded: without the guard every chunk shorter than
  // the query would match on whitespace or a stray character, which would
  // make the method fire on everything and mean nothing.
  const trimmedField = normalisedField.trim();
  const containedBy =
    trimmedField.length >= MINIMUM_CONTAINED_BY_LENGTH
    && normalisedQuery.includes(trimmedField)
      ? 1
      : 0;

  // Token alignment only. tokenSetRatio is deliberately absent: it returns 1
  // whenever the query's tokens are a subset of the field's, which is
  // documented behaviour and useless here, because a long chunk contains
  // almost any short query's tokens somewhere.
  //
  // Measured against the real store, including it scored an unrelated archived
  // message 0.956 for "Mid-40s" while a genuine typo — "poddle" for "poodle" —
  // scored 0.911. The ranges overlapped, so no threshold could separate a real
  // near-match from noise.
  //
  // tokenSortRatio is absent for a milder version of the same problem: it
  // compares whole sorted strings, so a short query against a long chunk
  // scores low regardless of whether the query appears. bestTokenAlignment
  // gives both properties that were wanted — word order does not matter, and
  // within each word the first letters count for more.
  const fuzzy = bestTokenAlignment(query, field);

  return {
    exact,
    starts_with: startsWith,
    ends_with: endsWith,
    contains,
    contained_by: containedBy,
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
    "contained_by",
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
  options: { fuzzyMinimumScore: number },
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
      scores.exact
      + scores.starts_with
      + scores.ends_with
      + scores.contains
      + scores.contained_by;
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

  // Deliberately unsorted and uncapped. Ordering and quotas belong to the
  // cascade, which fills each method's share from what earlier methods did
  // not claim — sorting by a single best score here would mix the methods
  // back together and cutting to a limit would discard candidates the
  // cascade had not yet had the chance to consider.
  return hits;
}
