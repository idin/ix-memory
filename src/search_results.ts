/**
 * Turning search results into what an agent reads.
 *
 * Two properties matter more than formatting.
 *
 * A result must say why it is here. A hit an agent cannot explain is one it
 * will misuse — quoting a fuzzy near-match as though it were an exact one, or
 * treating a semantic neighbour as a direct answer.
 *
 * An empty or partial result must say what it is. Silence about what was held
 * back is the failure the whole store is built to avoid: an agent that does
 * not know more exists will answer confidently from a store it could not see
 * all of. So this reports deep files withheld, siblings attached, and — the
 * one that matters most — when semantic search was unavailable, because
 * without it a query worded differently from the store returns nothing and
 * reads as "not recorded".
 */

import type { MemoryChunk } from "./chunking";
import { describeDeep, summariseDeep } from "./deep_memory";
import type { SearchResult } from "./hybrid_search";
import type { ExpandedHit } from "./sibling_chunks";

/** How much of a chunk to show before cutting it. */
const EXCERPT_CHARACTERS = 320;

/** Context around the matched position, when there is one. */
const EXCERPT_CONTEXT_CHARACTERS = 80;

/**
 * Pull the part of a chunk worth showing.
 *
 * Centred on the match where there is one, so a hit deep in a long chunk shows
 * the reason it matched rather than the chunk's opening.
 */
function excerpt(chunk: MemoryChunk, matchedAt: number | null): string {
  const text = chunk.text.trim();
  if (text.length <= EXCERPT_CHARACTERS) {
    return text;
  }
  if (matchedAt === null) {
    return `${text.slice(0, EXCERPT_CHARACTERS)}…`;
  }
  const start = Math.max(0, matchedAt - EXCERPT_CONTEXT_CHARACTERS);
  const end = Math.min(text.length, start + EXCERPT_CHARACTERS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${
    end < text.length ? "…" : ""
  }`;
}

/** Say why a result is in the list. */
function describeWhy(result: SearchResult): string {
  const parts: string[] = [];
  if (result.matchedBy.length > 0) {
    parts.push(result.matchedBy.join(", "));
  }
  if (result.features.cosine !== null) {
    parts.push(`meaning ${result.features.cosine.toFixed(2)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "no method";
}

/** What the caller needs to know beyond the results themselves. */
export type SearchContext = {
  query: string;
  /** False when no index is configured, so nothing was embedded. */
  semanticAvailable: boolean;
  /** Every chunk searched, for reporting what was held back. */
  searched: MemoryChunk[];
  /** True when the caller asked to include resolved work. */
  includeDeep: boolean;
};

/**
 * Render results for an agent to read.
 *
 * @param results - Fused results, with any siblings attached.
 * @param context - What else the caller should know.
 * @returns Text.
 */
export function describeSearchResults(
  results: ExpandedHit<SearchResult>[],
  context: SearchContext,
): string {
  const lines: string[] = [];

  if (results.length === 0) {
    lines.push(`Nothing in the store matched "${context.query}".`);
    if (!context.semanticAvailable) {
      // The distinction that stops a confident wrong "no": without semantic
      // search, a query worded differently from the store finds nothing even
      // when the fact is there. "Canine" does not reach "toy poodle".
      lines.push(
        "",
        "Only word matching ran, so this means no stored wording matched — "
          + "not that the fact is absent. A differently worded fact would not "
          + "have been found. Try the words the store would likely use.",
      );
    } else {
      lines.push(
        "",
        "Word and meaning matching both ran, so the store most likely does "
          + "not hold this.",
      );
    }
    return lines.join("\n");
  }

  lines.push(
    `${results.length} result(s) for "${context.query}".`,
    "",
  );

  results.forEach((result, index) => {
    const heading = result.chunk.headingPath.join(" > ");
    lines.push(
      `${index + 1}. ${result.chunk.path}`
        + `${heading ? ` — ${heading}` : ""}`,
      `   lines ${result.chunk.startLine}-${result.chunk.endLine} · `
        + `${describeWhy(result)}`,
    );

    if (result.semanticOnly) {
      // Worth flagging: the words do not appear anywhere in this chunk, so a
      // reader looking for them will not find them.
      lines.push(
        "   matched by meaning alone — the query's words do not appear here",
      );
    }

    lines.push("", `   ${excerpt(result.chunk, null).replace(/\n/g, "\n   ")}`);

    if (result.chunk.superseded.length > 0) {
      lines.push(
        "",
        `   superseded here, not current: ${result.chunk.superseded.join("; ")}`,
      );
    }

    if (result.chunk.containsSuperseded) {
      lines.push(
        "",
        "   this chunk mixes current and superseded text — read the strike-"
          + "throughs before quoting it",
      );
    }

    for (const sibling of result.siblings) {
      lines.push(
        "",
        `   context, ${sibling.path} lines ${sibling.startLine}-`
          + `${sibling.endLine}:`,
        `   ${sibling.text.trim().replace(/\n/g, "\n   ")}`,
      );
    }

    lines.push("");
  });

  if (!context.semanticAvailable) {
    lines.push(
      "Only word matching ran. Anything worded differently from the query "
        + "was not searched for, so these results are not the whole answer.",
      "",
    );
  }

  if (!context.includeDeep) {
    const withheld = describeDeep(
      summariseDeep(context.searched.map((chunk) => chunk.path)),
    );
    if (withheld) {
      lines.push(withheld, "");
    }
  }

  return lines.join("\n").trimEnd();
}
