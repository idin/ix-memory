/**
 * Recording which search results an agent found useful.
 *
 * Mechanical retrieval generates candidates, an agent reads them and marks
 * which answered the question, and those marks accumulate. Given enough of
 * them a model could be trained to rank better than the hand-set quotas — a
 * later decision, deliberately separate from this one, since collecting is
 * cheap and reversible while handing ranking to a model is neither.
 *
 * The agent does the assessing, not Idin. Nobody is going to read seventy-odd
 * results by hand on every search, so the volume has to come from somewhere
 * automatic. That has a consequence worth stating rather than discovering: a
 * model trained on these learns to imitate the agent, including whatever the
 * agent gets wrong. `assessed_by` is recorded for exactly that reason — an
 * occasional human correction is worth far more per row than bulk agent
 * output, and telling them apart later requires having stored which is which.
 *
 * Three properties decide whether the data is worth anything:
 *
 * Unassessed is not irrelevant. If a reader stops at the fifth result, the
 * rest were not judged — nobody looked. Recording them as negatives stores a
 * guess as a fact and teaches a model that low-ranked results are bad, which
 * is the very prior it was meant to test.
 *
 * The query is stored, not only the scores. Feature sets change; a row that
 * kept only numbers is frozen at whatever features existed when it was
 * written, and cannot be recomputed.
 *
 * Every feature is stored, including the ones that did not fire. Which method
 * found something is as informative as how well it scored — the "canine"
 * search showed the lexically perfect matches were the wrong answers and the
 * right ones scored zero on `contains`.
 */

import type { SearchFeatures } from "./search_cascade";

/**
 * What an agent concluded about one candidate.
 *
 * Three states, not two. The absence of an assessment is a distinct fact from
 * a negative one, and conflating them is the most common way this kind of
 * dataset is quietly ruined.
 */
export type AgentAssessment = "relevant" | "irrelevant" | "unassessed";

/** One candidate, as recorded. */
export type CandidateRecord = {
  timestamp: string;
  /** Who ran the search, when the request carried an identity. */
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
  /**
   * How long the chunk's own text is.
   *
   * A feature, not bookkeeping: it is what orders the anchored tiers, on the
   * reasoning that a query is most of a short chunk and a fraction of a long
   * one. Without it stored, nothing can check whether that reasoning holds.
   */
  chunkLength: number;
  features: SearchFeatures;
  /**
   * Where semantic search placed this candidate, from 1. Null when semantic
   * search did not return it — which is a different fact from ranking last.
   */
  cosineSimilarityRank: number | null;
  /** Where fuzzy matching placed this candidate, from 1. Null when unmatched. */
  fuzzyRank: number | null;
  /** What the agent concluded. */
  agentAssessment: AgentAssessment;
  /**
   * Which agent, or person, assessed it.
   *
   * Null until assessed. Kept because an assessment by an agent skimming and
   * one by Idin correcting it are not the same evidence, and a model trained
   * on them undifferentiated cannot weight them differently.
   */
  assessedBy: string | null;
};

/**
 * Somewhere assessments are kept.
 *
 * The same shape as the failure and usage sinks, for the same reason: a
 * deployment can send these to a database without the library needing to know
 * one exists.
 */
export type RelevanceSink = (records: CandidateRecord[]) => void | Promise<void>;

/**
 * The sink used when a deployment provides none.
 *
 * Discards. Collecting assessments is worth doing and not worth failing a
 * search over.
 */
export const noOpRelevanceSink: RelevanceSink = () => {};

/**
 * Turn search results into unassessed candidate records.
 *
 * Every candidate starts unassessed, and nothing here can produce any other
 * value. That is the invariant the three states reduce to: a negative can only
 * come from an explicit assessment, so no result that nobody read is recorded
 * as a bad one.
 *
 * @param query - What was searched for.
 * @param login - Who ran the search, when known.
 * @param candidates - The results, in the order they were returned.
 * @param now - When, in milliseconds.
 * @returns One record per candidate, all unassessed.
 */
export function recordCandidates(
  query: string,
  login: string | null,
  candidates: {
    path: string;
    ordinal: number;
    chunkLength: number;
    features: SearchFeatures;
    cosineSimilarityRank: number | null;
    fuzzyRank: number | null;
  }[],
  now: number,
): CandidateRecord[] {
  const timestamp = new Date(now).toISOString();
  return candidates.map((candidate) => ({
    timestamp,
    login,
    query,
    path: candidate.path,
    ordinal: candidate.ordinal,
    chunkLength: candidate.chunkLength,
    features: candidate.features,
    cosineSimilarityRank: candidate.cosineSimilarityRank,
    fuzzyRank: candidate.fuzzyRank,
    agentAssessment: "unassessed",
    assessedBy: null,
  }));
}

/**
 * Apply an agent's assessment to recorded candidates.
 *
 * Anything not named stays unassessed rather than becoming irrelevant. An
 * agent that marked two results useful has told you about those two; whether
 * it read the rest is unknown, and unknown is what gets stored.
 *
 * @param records - The candidates, as recorded at search time.
 * @param relevant - Paths and ordinals found useful.
 * @param irrelevant - Paths and ordinals read and rejected.
 * @param assessedBy - Which agent or person assessed them.
 * @returns The records, with assessments applied.
 */
export function applyAssessments(
  records: CandidateRecord[],
  relevant: { path: string; ordinal: number }[],
  irrelevant: { path: string; ordinal: number }[],
  assessedBy: string,
): CandidateRecord[] {
  const key = (item: { path: string; ordinal: number }) =>
    `${item.path} ${item.ordinal}`;
  const relevantKeys = new Set(relevant.map(key));
  const irrelevantKeys = new Set(irrelevant.map(key));

  return records.map((record) => {
    const recordKey = key(record);
    if (relevantKeys.has(recordKey)) {
      return {
        ...record,
        agentAssessment: "relevant" as const,
        assessedBy,
      };
    }
    if (irrelevantKeys.has(recordKey)) {
      return {
        ...record,
        agentAssessment: "irrelevant" as const,
        assessedBy,
      };
    }
    return record;
  });
}

/**
 * Describe what a set of assessments amounts to.
 *
 * @param records - The assessed records.
 * @returns A sentence naming what was recorded.
 */
export function describeAssessments(records: CandidateRecord[]): string {
  const counts = { relevant: 0, irrelevant: 0, unassessed: 0 };
  for (const record of records) {
    counts[record.agentAssessment] += 1;
  }

  if (counts.relevant === 0 && counts.irrelevant === 0) {
    return (
      "Nothing was assessed, so nothing was recorded. Mark which results "
      + "answered the question and which did not — the rejections matter as "
      + "much as the choices, because a set of only good matches cannot teach "
      + "anything to tell them apart."
    );
  }

  return (
    `Recorded ${counts.relevant} relevant and ${counts.irrelevant} `
    + `irrelevant, with ${counts.unassessed} left unassessed. Unassessed is `
    + "stored as its own state rather than as a rejection, since nobody "
    + "looked at those."
  );
}
