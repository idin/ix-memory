/**
 * Recording which results were actually useful.
 *
 * The mechanical layer generates candidates; an agent reads them and judges;
 * the judgments accumulate. Given enough of them, a model can be trained to
 * rank better than the hand-set weights — but that is a later decision, and
 * deliberately separate from this one. Collecting the data is cheap,
 * reversible, and useful on its own: even unused, it measures how well the
 * current ranking does.
 *
 * Three properties decide whether the data is worth anything, and each is a
 * way the collection can quietly ruin itself:
 *
 * Unjudged is not irrelevant. If a reader stops at the third result, results
 * four onward were not judged — nobody looked. Recording them as negatives
 * stores a guess as a fact and teaches a model that low-ranked results are
 * bad, which is the very prior the model was meant to test.
 *
 * The query is stored, not only the scores. Feature sets change; a row that
 * kept only numbers is frozen at whatever features existed when it was
 * written, and cannot be recomputed.
 *
 * The candidate pool is wider than what is returned. A judge only sees what
 * retrieval surfaced, so labels inherit the ranker's blind spots unless
 * something beyond the top results is occasionally included.
 */

import type { SearchFeatures } from "./hybrid_search";

/**
 * What a judge concluded about one candidate.
 *
 * Three states, not two. The absence of a judgment is a distinct fact from a
 * negative judgment, and conflating them is the single most common way this
 * kind of dataset is spoiled.
 */
export type RelevanceLabel = "relevant" | "irrelevant" | "unjudged";

/** One candidate, as recorded. */
export type CandidateRecord = {
  timestamp: string;
  /** Who searched, when the request carried an identity. */
  login: string | null;
  /**
   * What was searched for.
   *
   * Stored so a row can be recomputed when a new feature is added later.
   * Without it the dataset is frozen at the feature set that existed the day
   * each row was written.
   */
  query: string;
  path: string;
  ordinal: number;
  /** Where this candidate ranked, from 1. */
  rank: number;
  features: SearchFeatures;
  label: RelevanceLabel;
};

/**
 * Somewhere judgments are kept.
 *
 * The same shape as the failure and usage sinks, for the same reason: a
 * deployment can send these to a database without the library needing to know
 * one exists.
 */
export type RelevanceSink = (records: CandidateRecord[]) => void | Promise<void>;

/**
 * The sink used when a deployment provides none.
 *
 * Discards. Collecting judgments is worth doing and not worth failing a
 * search over.
 */
export const noOpRelevanceSink: RelevanceSink = () => {};

/**
 * Turn search results into unjudged candidate records.
 *
 * Every candidate starts unjudged, and nothing here can produce any other
 * label. That is the invariant the three-state rule reduces to: a negative
 * can only come from an explicit judgment, so there is no path by which a
 * result nobody read is recorded as a bad one.
 *
 * @param query - What was searched for.
 * @param login - Who searched, when known.
 * @param candidates - The results, in rank order.
 * @param now - When, in milliseconds.
 * @returns One record per candidate, all unjudged.
 */
export function recordCandidates(
  query: string,
  login: string | null,
  candidates: { path: string; ordinal: number; features: SearchFeatures }[],
  now: number,
): CandidateRecord[] {
  const timestamp = new Date(now).toISOString();
  return candidates.map((candidate, index) => ({
    timestamp,
    login,
    query,
    path: candidate.path,
    ordinal: candidate.ordinal,
    rank: index + 1,
    features: candidate.features,
    label: "unjudged",
  }));
}

/**
 * Apply a judge's verdict to recorded candidates.
 *
 * Anything the judge did not name stays unjudged rather than becoming
 * irrelevant. A reader who marked two results useful has told you about those
 * two; whether they read the rest is unknown, and unknown is what gets stored.
 *
 * @param records - The candidates, as recorded at search time.
 * @param relevant - Paths and ordinals the judge found useful.
 * @param irrelevant - Paths and ordinals the judge explicitly rejected.
 * @returns The records, with labels applied.
 */
export function applyJudgments(
  records: CandidateRecord[],
  relevant: { path: string; ordinal: number }[],
  irrelevant: { path: string; ordinal: number }[],
): CandidateRecord[] {
  const key = (item: { path: string; ordinal: number }) =>
    `${item.path} ${item.ordinal}`;
  const relevantKeys = new Set(relevant.map(key));
  const irrelevantKeys = new Set(irrelevant.map(key));

  return records.map((record) => {
    const recordKey = key(record);
    if (relevantKeys.has(recordKey)) {
      return { ...record, label: "relevant" as const };
    }
    if (irrelevantKeys.has(recordKey)) {
      return { ...record, label: "irrelevant" as const };
    }
    return record;
  });
}

/**
 * Describe what a set of judgments amounts to.
 *
 * @param records - The labelled records.
 * @returns A sentence naming what was recorded.
 */
export function describeJudgments(records: CandidateRecord[]): string {
  const counts = { relevant: 0, irrelevant: 0, unjudged: 0 };
  for (const record of records) {
    counts[record.label] += 1;
  }

  if (counts.relevant === 0 && counts.irrelevant === 0) {
    return (
      "Nothing was judged, so nothing was recorded. Mark which results "
      + "answered the question and which did not — the rejections matter as "
      + "much as the choices, because a dataset of only good matches cannot "
      + "teach anything to tell them apart."
    );
  }

  return (
    `Recorded ${counts.relevant} relevant and ${counts.irrelevant} `
    + `irrelevant, with ${counts.unjudged} left unjudged. Unjudged is stored `
    + "as its own state rather than as a rejection, since nobody looked at "
    + "those."
  );
}
