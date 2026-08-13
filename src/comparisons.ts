/**
 * Comparisons, and the part of them nobody writes down.
 *
 * Choosing between things is work: the criteria are decided, the options are
 * gathered, most are ruled out, one is picked. What survives is usually the
 * choice alone. A year later the same comparison is run again from scratch,
 * and the options that were already rejected are rejected again for the same
 * reasons nobody recorded.
 *
 * So the rejected options and their reasons are a required field here. They
 * are the expensive part of the work and the part that goes missing.
 */

import { assertFilenameFits } from "./filename_limit";
import { NAMESPACE } from "./layout";

/** Where comparisons live. Dated, since a comparison is true of a moment. */
export const COMPARISONS_PREFIX = `${NAMESPACE}comparisons/`;

export type ComparedOption = {
  name: string;
  /** Free-form fields: price, rating, distance, whatever was compared on. */
  attributes?: Record<string, string>;
  /** Why this one was not chosen. Required for everything except the choice. */
  rejected_because?: string;
};

export type Comparison = {
  subject: string;
  criteria: string[];
  options: ComparedOption[];
  chosen: string | null;
  conclusion: string;
  /** What would change the answer. Often more durable than the answer. */
  would_change_if?: string;
};

/**
 * Whether a comparison looks too slight to be worth keeping.
 *
 * This surfaces rather than refuses. Idin's ruling, 2026-08-13: the tool says
 * when something looks trivial, and he decides — a tool that silently declined
 * to save would be overruling the person who asked it to.
 *
 * @param comparison - What is being saved.
 * @returns Why it looks trivial, or null when it does not.
 */
export function looksTrivial(comparison: Comparison): string | null {
  if (comparison.options.length < 3) {
    return (
      `Only ${comparison.options.length} option(s) compared. Worth saving if `
      + "you would run this again, or if gathering them took real work — "
      + "otherwise it may not earn a file. Saved anyway; say so if you want it "
      + "removed."
    );
  }

  const withoutReasons = comparison.options.filter(
    (option) => option.name !== comparison.chosen && !option.rejected_because,
  );
  if (withoutReasons.length > 0) {
    return (
      `${withoutReasons.length} rejected option(s) have no reason recorded. `
      + "That is the part nobody writes down and everybody re-derives, so a "
      + "comparison without it is worth much less later."
    );
  }

  if (comparison.conclusion.trim().length < 40) {
    return (
      "The conclusion is very short. In a year it is the sentence that has to "
      + "carry the reasoning, since the numbers will have moved."
    );
  }

  return null;
}

/**
 * The path for a comparison.
 *
 * @param subject - What was compared.
 * @param now - When.
 * @returns A dated path under the comparisons folder.
 */
export function comparisonPath(subject: string, now: number): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug.length === 0) {
    throw new Error(
      "That subject has no usable characters. Give something like "
        + '"air purifiers" or "restaurants near the office".',
    );
  }
  const date = new Date(now).toISOString().slice(0, 10);
  const filename = `${date}_${slug}.md`;
  assertFilenameFits(filename, `A comparison of "${subject}"`);
  return `${COMPARISONS_PREFIX}${filename}`;
}

/**
 * Render a comparison as the file that gets stored.
 *
 * Written so the rejected options are as prominent as the choice. A format
 * that buries them under the winner would lose them the same way an unwritten
 * comparison does.
 *
 * @param comparison - What was compared and concluded.
 * @param now - When, for the dateline.
 * @returns Markdown.
 */
export function renderComparison(comparison: Comparison, now: number): string {
  const date = new Date(now).toISOString().slice(0, 10);
  const lines: string[] = [
    `# ${comparison.subject}`,
    "",
    `Compared ${date}. Superseded rather than replaced — a later comparison of`,
    "the same thing is a new file, and this one stays as a record of what was",
    "true and what was thought at the time.",
    "",
    "## Criteria",
    "",
    ...comparison.criteria.map((criterion) => `- ${criterion}`),
    "",
  ];

  if (comparison.chosen) {
    const winner = comparison.options.find(
      (option) => option.name === comparison.chosen,
    );
    lines.push(`## Chosen: ${comparison.chosen}`, "");
    if (winner?.attributes) {
      for (const [key, value] of Object.entries(winner.attributes)) {
        lines.push(`- ${key}: ${value}`);
      }
      lines.push("");
    }
  } else {
    lines.push("## Nothing chosen", "");
  }

  const rejected = comparison.options.filter(
    (option) => option.name !== comparison.chosen,
  );
  if (rejected.length > 0) {
    lines.push(
      "## Rejected, and why",
      "",
      "The part worth keeping. Without it the next comparison starts from",
      "nothing and rejects the same options for the same unrecorded reasons.",
      "",
    );
    for (const option of rejected) {
      lines.push(`### ${option.name}`, "");
      if (option.attributes) {
        for (const [key, value] of Object.entries(option.attributes)) {
          lines.push(`- ${key}: ${value}`);
        }
        lines.push("");
      }
      lines.push(option.rejected_because ?? "_No reason recorded._", "");
    }
  }

  lines.push("## Conclusion", "", comparison.conclusion, "");

  if (comparison.would_change_if) {
    lines.push(
      "## What would change this",
      "",
      comparison.would_change_if,
      "",
    );
  }

  lines.push(
    "---",
    "",
    "Figures are as they stood on the date above. Anything sourced from a",
    "search — ratings, prices, opening hours — has moved since, and the",
    "reasoning is the part meant to survive.",
    "",
    "Whether third-party fields may be stored at all has not been checked",
    "against the terms of the services they came from. Idin chose on",
    "2026-08-13 to store them and settle that question later; this note is",
    "here so the question is found rather than forgotten.",
  );

  return lines.join("\n");
}
