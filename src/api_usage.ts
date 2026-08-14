/**
 * Recording what external APIs this server consumes.
 *
 * Every paid or rate-limited API used here should say what it cost, so that
 * "am I near the limit" and "what caused that spike" are answerable from
 * stored facts rather than guessed at after the bill arrives. Workers AI is
 * the first caller; GitHub's rate limits are already consumed by every tool on
 * this server and tracked nowhere, and belong here too.
 *
 * The awkward part, and the reason this module is careful about naming: the
 * embedding API reports nothing. Its response is `{shape, data, pooling}` —
 * no token count, no unit count. Text-generation models on Workers AI do
 * report usage and AI Gateway logs it, but the embedding path does not.
 *
 * So the rule "record what the API reports" cannot be followed here, and
 * pretending otherwise would store a computed guess in a column that reads
 * like a measurement. Instead the two kinds are separated by name: `calls`,
 * `texts` and `characters` are counted directly, and anything derived from
 * them is prefixed `estimated`. A reader can then tell at a glance which
 * numbers would survive an audit.
 */

/**
 * Neurons per million input tokens for the default embedding model.
 *
 * Cloudflare's published rate for `@cf/baai/bge-base-en-v1.5`. Stored as a
 * constant rather than inlined so that a model change is one edit, and so the
 * estimate can be recomputed from history if the rate changes.
 */
export const NEURONS_PER_MILLION_TOKENS_BGE_BASE = 6058;

/**
 * The free daily allowance, in neurons.
 *
 * Cloudflare grants this on both the Free and Paid Workers plans. Recorded
 * here because it is the number an estimate is checked against — a usage
 * figure with nothing to compare it to answers no question worth asking.
 */
export const FREE_NEURONS_PER_DAY = 10_000;

/**
 * When the allowance resets.
 *
 * 00:00 UTC, which is the boundary Cloudflare's billing actually uses. Any
 * other interval — a local day, a rolling window — would produce totals that
 * do not line up with the limit they are meant to be checked against.
 */
export const USAGE_INTERVAL = "utc_day";

/** One call to an external API. */
export type ApiUsage = {
  /** When the call was made, ISO 8601. */
  timestamp: string;
  /** Which service: "workers_ai", "github". */
  service: string;
  /** The specific model or endpoint, where the service has several. */
  model: string;
  /** What was being done: "embed", "read_blob". */
  operation: string;
  /** What caused it: "full_build", "incremental_build", "query". */
  trigger: string;
  /** How many requests were made. Measured. */
  calls: number;
  /** How many items were sent, where a call carries a batch. Measured. */
  items: number;
  /** How many characters were sent. Measured. */
  characters: number;
  /**
   * Tokens, estimated from character count.
   *
   * Named `estimated` because it is: no tokenizer runs in a Worker, and the
   * API does not report the true count. Reconcilable against the Cloudflare
   * dashboard, and not to be mistaken for it.
   */
  estimatedTokens: number;
  /** Neurons, derived from the estimate above at the model's published rate. */
  estimatedUnits: number;
  /**
   * What the units are called for this service.
   *
   * A column rather than a constant, because services meter differently —
   * neurons here, requests for GitHub, tokens elsewhere. Hardcoding one
   * service's unit would make this table single-purpose.
   */
  unitName: string;
};

/**
 * Somewhere usage is written.
 *
 * The same shape as {@link FailureSink} and for the same reason: a deployment
 * can send this to a database without the library needing to know one exists.
 */
export type UsageSink = (usage: ApiUsage) => void | Promise<void>;

/**
 * The default sink, which discards.
 *
 * Usage metering is worth having and not worth failing a search over. A
 * deployment with nowhere to put it still works; it simply cannot answer
 * questions about consumption.
 */
export const noOpUsageSink: UsageSink = () => {};

/**
 * Estimate neurons from characters, at a given model's rate.
 *
 * @param characters - How many characters were sent.
 * @param neuronsPerMillionTokens - The model's published rate.
 * @param charactersPerToken - The token estimate's divisor.
 * @returns Estimated tokens and neurons.
 */
export function estimateUsage(
  characters: number,
  options: { neuronsPerMillionTokens: number; charactersPerToken: number },
): { estimatedTokens: number; estimatedUnits: number } {
  const estimatedTokens = Math.ceil(characters / options.charactersPerToken);
  const estimatedUnits =
    (estimatedTokens / 1_000_000) * options.neuronsPerMillionTokens;
  return { estimatedTokens, estimatedUnits };
}

/**
 * Describe usage against the free allowance.
 *
 * Totals are computed from records rather than stored, because a stored total
 * is wrong the moment the next call lands.
 *
 * @param records - Usage rows, typically one UTC day's worth.
 * @returns A sentence naming the total and what it is a fraction of.
 */
export function describeUsage(records: ApiUsage[]): string {
  if (records.length === 0) {
    return "No API usage recorded for this period.";
  }

  const calls = records.reduce((total, row) => total + row.calls, 0);
  const units = records.reduce((total, row) => total + row.estimatedUnits, 0);
  const share = (units / FREE_NEURONS_PER_DAY) * 100;

  return (
    `${calls} call(s), an estimated ${units.toFixed(1)} neurons — about `
    + `${share.toFixed(1)}% of the ${FREE_NEURONS_PER_DAY.toLocaleString()} `
    + "free daily allowance, which resets at 00:00 UTC. Estimated from "
    + "character counts, since the embedding API reports no token usage; "
    + "reconcile against the Cloudflare dashboard for billing."
  );
}
