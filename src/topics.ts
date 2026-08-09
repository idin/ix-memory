import { DECISIONS_PREFIX, FACTS_PREFIX, NAMESPACE } from "./layout";

/**
 * Where a new file goes, decided here rather than by whoever is writing it.
 *
 * Callers used to pass a path. That meant every agent invented its own
 * conventions — one produced `todos/2026-08-09-check-thing.md`, another
 * `facts/home/kitchen.md`, and neither knew what the last had chosen. The
 * layout drifted because nothing owned it.
 *
 * Now a caller says what kind of thing it is recording and what it is about,
 * and the path is derived. There is no way to pass a path, so there is no way
 * to disagree about one.
 */

/** The kinds of thing that can be recorded, and where each lives. */
export const TOPICS = {
  fact: {
    prefix: FACTS_PREFIX,
    extension: ".md",
    dated: false,
    description:
      "something true about the user — identity, work, home, preferences",
  },
  inventory: {
    prefix: FACTS_PREFIX,
    extension: ".yaml",
    dated: false,
    description: "a list of owned things, as YAML entries",
  },
  todo: {
    prefix: `${NAMESPACE}todos/open/`,
    extension: ".md",
    dated: true,
    description: "a task to be done, filed under todos/open",
  },
  decision: {
    prefix: DECISIONS_PREFIX,
    extension: ".md",
    dated: false,
    description:
      "a decision and its reasoning — appended to the current year's log",
  },
} as const;

export type Topic = keyof typeof TOPICS;

export function topicNames(): Topic[] {
  return Object.keys(TOPICS) as Topic[];
}

/** One line per topic, for tool descriptions. */
export function describeTopics(): string {
  return topicNames()
    .map((name) => `${name} (${TOPICS[name].description})`)
    .join("; ");
}

/**
 * Turn a free-text subject into the file-name part of a path.
 *
 * Lowercase, snake_case, no leading or trailing separators. Slashes are
 * preserved so a caller can say "home/kitchen" and get a subfolder, which is
 * how a topic that outgrows one file splits without needing a second tool.
 */
export function subjectToSlug(subject: string): string {
  const cleaned = subject
    .toLowerCase()
    .split("/")
    .map((segment) =>
      segment
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    )
    .filter((segment) => segment.length > 0)
    .join("/");

  if (cleaned.length === 0) {
    throw new Error(
      "That subject has no usable characters. Give something like "
        + '"kitchen appliances" or "home/kitchen".',
    );
  }
  if (cleaned.length > 96) {
    throw new Error(
      `That subject is too long (${cleaned.length} characters after cleaning). `
        + "Keep it under 96.",
    );
  }
  return cleaned;
}

/** ISO date, hyphens intact — the only place hyphens are allowed in a name. */
function isoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * The full path for a new file. The caller has no say in it beyond the topic
 * and the subject.
 */
export function pathForTopic(
  topic: Topic,
  subject: string,
  now: number,
): string {
  const config = TOPICS[topic];
  const slug = subjectToSlug(subject);

  if (config.dated) {
    // Date first so a directory listing sorts chronologically. The date keeps
    // its hyphens; everything after the separator is snake_case.
    const directory = slug.includes("/")
      ? `${slug.slice(0, slug.lastIndexOf("/") + 1)}`
      : "";
    const name = slug.slice(slug.lastIndexOf("/") + 1);
    return `${config.prefix}${directory}${isoDate(now)}_${name}${config.extension}`;
  }

  return `${config.prefix}${slug}${config.extension}`;
}

/** Where a decision is appended. One file per year, created on demand. */
export function decisionLogPath(now: number): string {
  return `${DECISIONS_PREFIX}${new Date(now).getUTCFullYear()}.md`;
}
