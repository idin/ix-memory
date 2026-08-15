/**
 * Choosing which results to return, when the goal is recall.
 *
 * The earlier design fused the lexical and semantic rankings into one ordering
 * and returned the top few. That optimises for putting the best result first,
 * which is the wrong problem: precision can be recovered by whoever reads the
 * results, and recall cannot be recovered by anyone, because nothing
 * downstream can retrieve what was never returned.
 *
 * So this does not rank across methods at all. It runs every method, then
 * fills a quota per method from what earlier methods did not already claim.
 * A chunk appears once, at its strongest method, and no method spends its
 * quota on chunks another method already returned.
 *
 * The order of tiers is the order of how much a match means:
 *
 *   exact         the whole field is the query — never capped
 *   starts_with   the field opens with it
 *   ends_with     the field closes with it
 *   contains      the query appears somewhere
 *   fuzzy         a near-spelling appears
 *   cosine        nothing appears, but the meaning is close
 *
 * Within the anchored tiers, shorter chunks come first. A one-line fact
 * containing the query is a better match than a paragraph containing it,
 * because the query is most of the former and a fraction of the latter — and
 * length says so without needing a model to judge.
 */

import type { MemoryChunk } from "./chunking";
import type { SemanticHit } from "./embeddings";
import type { LexicalHit, MatchMethod } from "./lexical_search";
import type { SearchQuotas } from "./search_config";

/**
 * A tier of the cascade.
 *
 * Wider than {@link MatchMethod}, which names only the lexical methods.
 * Semantic matching is a tier here but not a lexical method, and conflating
 * the two would mean casting at every use — a sign the type is wrong rather
 * than the usage.
 */
export type SearchTier = MatchMethod | "cosine";

/** Every score a chunk earned, kept whole for explaining and for training. */
export type SearchFeatures = {
  exact: number;
  startsWith: number;
  endsWith: number;
  contains: number;
  fuzzy: number;
  /** Null when semantic search did not run or the chunk was unembedded. */
  cosine: number | null;
};

export type CascadeResult = {
  chunk: MemoryChunk;
  features: SearchFeatures;
  /** Which tier claimed this chunk. Why it is in the results. */
  tier: SearchTier;
  /** Every method that matched at all, not only the claiming one. */
  matchedBy: SearchTier[];
};

/** The tiers, strongest first. */
const TIER_ORDER: MatchMethod[] = [
  "exact",
  "starts_with",
  "ends_with",
  "contains",
  "fuzzy",
];

function keyOf(chunk: MemoryChunk): string {
  return `${chunk.path} ${chunk.ordinal}`;
}

/** Every method that scored above nothing. */
function methodsThatMatched(
  hit: LexicalHit | undefined,
  cosine: number | null,
): SearchTier[] {
  const methods: SearchTier[] = [];
  if (hit) {
    for (const method of TIER_ORDER) {
      if (hit.scores[method] > 0) {
        methods.push(method);
      }
    }
  }
  if (cosine !== null) {
    methods.push("cosine");
  }
  return methods;
}

/**
 * Run the cascade.
 *
 * @param lexical - Every chunk that any lexical method matched, unordered.
 * @param semantic - Semantic candidates, closest first.
 * @param quotas - How many each tier may contribute.
 * @returns Results, grouped by tier in tier order.
 */
export function cascadeResults(
  lexical: LexicalHit[],
  semantic: SemanticHit[],
  quotas: SearchQuotas,
): CascadeResult[] {
  const cosineByKey = new Map<string, number>();
  for (const hit of semantic) {
    cosineByKey.set(keyOf(hit.chunk), hit.similarity);
  }
  const lexicalByKey = new Map<string, LexicalHit>();
  for (const hit of lexical) {
    lexicalByKey.set(keyOf(hit.chunk), hit);
  }

  const claimed = new Set<string>();
  const results: CascadeResult[] = [];

  function take(
    chunk: MemoryChunk,
    tier: SearchTier,
  ): void {
    const key = keyOf(chunk);
    claimed.add(key);
    const hit = lexicalByKey.get(key);
    const cosine = cosineByKey.get(key) ?? null;
    results.push({
      chunk,
      features: {
        exact: hit?.scores.exact ?? 0,
        startsWith: hit?.scores.starts_with ?? 0,
        endsWith: hit?.scores.ends_with ?? 0,
        contains: hit?.scores.contains ?? 0,
        fuzzy: hit?.scores.fuzzy ?? 0,
        cosine,
      },
      tier,
      matchedBy: methodsThatMatched(hit, cosine),
    });
  }

  // Every exact match, uncapped. A chunk whose whole text is the query is as
  // good as a match gets, and capping would discard the best results to make
  // room for worse ones.
  for (const hit of lexical) {
    if (hit.scores.exact > 0 && !claimed.has(keyOf(hit.chunk))) {
      take(hit.chunk, "exact");
    }
  }

  // The anchored tiers, shortest chunk first. Deliberately the chunk's own
  // text rather than the searched text: the heading path and preamble are a
  // near-constant prefix, and for a short chunk the preamble can be longer
  // than the fact, which would rank a one-line fact behind a paragraph
  // because of its file rather than itself.
  const anchoredTiers: {
    tier: SearchTier;
    scoreKey: keyof LexicalHit["scores"];
    quota: number;
  }[] = [
    { tier: "starts_with", scoreKey: "starts_with", quota: quotas.startsWith },
    { tier: "ends_with", scoreKey: "ends_with", quota: quotas.endsWith },
    { tier: "contains", scoreKey: "contains", quota: quotas.contains },
  ];

  for (const { tier, scoreKey, quota } of anchoredTiers) {
    const eligible = lexical
      .filter(
        (hit) =>
          hit.scores[scoreKey] > 0 && !claimed.has(keyOf(hit.chunk)),
      )
      .sort((first, second) => first.chunk.text.length - second.chunk.text.length);
    for (const hit of eligible.slice(0, quota)) {
      take(hit.chunk, tier);
    }
  }

  // Fuzzy, by score.
  const fuzzyEligible = lexical
    .filter((hit) => hit.scores.fuzzy > 0 && !claimed.has(keyOf(hit.chunk)))
    .sort((first, second) => second.scores.fuzzy - first.scores.fuzzy);
  for (const hit of fuzzyEligible.slice(0, quotas.fuzzy)) {
    take(hit.chunk, "fuzzy");
  }

  // Semantic last — not because it matters least, but because a chunk whose
  // words actually appear has already been found by a method that can say so.
  // What reaches here is what nothing else could find, which is the whole
  // reason semantic search exists.
  const semanticEligible = semantic.filter(
    (hit) => !claimed.has(keyOf(hit.chunk)),
  );
  for (const hit of semanticEligible.slice(0, quotas.cosine)) {
    take(hit.chunk, "cosine");
  }

  return results;
}

/** How many results each tier contributed, for reporting. */
export function summariseTiers(
  results: CascadeResult[],
): { tier: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.tier, (counts.get(result.tier) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tier, count]) => ({ tier, count }));
}
