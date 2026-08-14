/**
 * The checks a machine can make about the state of the store.
 *
 * Most of what makes a store worth cleaning is detectable without judgement:
 * a file past the length at which it should have become a folder, a bare
 * abbreviation the whitelist forbids, a stored age that will be wrong within
 * a year. Running these in code rather than asking an agent to notice them
 * spends the agent's judgement only where judgement is actually required.
 *
 * These findings are evidence for a proposal. None of them is a proposal, and
 * nothing here changes anything.
 */

import { ALLOWED_EXTENSIONS, INSTRUCTIONS_PREFIX, NAMESPACE } from "./layout";

/** Lines past which the layout rule says a file becomes a subfolder. */
const LINE_LIMIT = 100;

/** Abbreviations that must always be followed by "Bank". */
const BANKS = ["TD", "RBC", "BMO"];

/** Abbreviations rejected outright by the naming rules. */
const REJECTED_ABBREVIATIONS = [
  "ASAP",
  "FYI",
  "TBD",
  "WIP",
  "IMO",
  "AKA",
  "ETA",
  "RL",
];

/**
 * Phrases that usually mean a derived value was stored.
 *
 * Deliberately loose. This produces candidates for an agent to judge, not
 * verdicts — "13 years old" in a fact file is almost certainly a stored age,
 * and the same words inside a quotation are not.
 */
const DERIVED_VALUE_PATTERNS = [
  /\b\d+\s*years?\s+old\b/i,
  /\bage[ds]?\s+\d+\b/i,
  /\b\d+\s*(years?|months?|weeks?)\s+ago\b/i,
  /\bfor\s+the\s+past\s+\d+\s*(years?|months?)\b/i,
];

/**
 * References that name nothing when an entry opens with one.
 *
 * Kept in step with `DANGLING_REFERENCE_PATTERN` in `chunking.ts`, which
 * detects the same thing for a different purpose: that one repairs a retrieved
 * result by fetching the neighbour, this one reports the entry so it can be
 * rewritten. The repair costs context on every search; the rewrite is
 * permanent.
 *
 * Leading markdown emphasis is skipped, since "**They compose**" is the same
 * failure dressed up.
 */
const ENTRY_OPENING_REFERENCE =
  /^[-*\s]*\**(It|This|That|These|Those|They|Them|Both|Either|Neither|The above|The former|The latter|Such)\b/;

export type StoreFinding = {
  /** What kind of problem this is, so like ones can be grouped. */
  kind: string;
  path: string;
  detail: string;
};

export type StoreFile = { path: string; text: string; bytes: number };

/**
 * Run every mechanical check over the store.
 *
 * @param files - Every file in the namespace, with its text.
 * @returns One finding per problem, in no particular order.
 */
export function checkStore(files: StoreFile[]): StoreFinding[] {
  return [
    ...tooLong(files),
    ...bareBankNames(files),
    ...rejectedAbbreviations(files),
    ...storedDerivedValues(files),
    ...entriesWithoutASubject(files),
  ];
}

/**
 * Whether a file is discussing the rules rather than subject to them.
 *
 * A todo that specifies an abbreviation check has to name the abbreviations.
 * A misjudgement entry recording a naming error has to quote the error. A
 * decision log records what was decided, in the words it was decided in.
 *
 * Run against the real store, half the abbreviation findings were files of
 * exactly this kind — including the todo that asked for the check. Findings
 * that are obviously wrong are worse than no findings, because they train
 * whoever reads them to skip the rest.
 */
function discussesTheRules(file: StoreFile): boolean {
  if (file.path.startsWith(INSTRUCTIONS_PREFIX)) {
    return true;
  }
  return /naming rule|abbreviation|whitelist|rejected outright/i.test(file.text);
}

/**
 * Files past the length at which the layout rule says they become a folder.
 *
 * The instructions are exempt. They are read whole rather than looked up, so
 * the rule that motivates splitting does not apply to them — and they were
 * split anyway, on a different argument.
 */
function tooLong(files: StoreFile[]): StoreFinding[] {
  return files
    .filter((file) => !file.path.startsWith(INSTRUCTIONS_PREFIX))
    .map((file) => ({ file, lines: file.text.split("\n").length }))
    .filter(({ lines }) => lines > LINE_LIMIT)
    .map(({ file, lines }) => ({
      kind: "over_the_line_limit",
      path: file.path,
      detail:
        `${lines} lines, over the ${LINE_LIMIT} at which the layout rule says `
        + "a file becomes a subfolder with one entry per file.",
    }));
}

/** TD, RBC and BMO must each be followed by "Bank". */
function bareBankNames(files: StoreFile[]): StoreFinding[] {
  const findings: StoreFinding[] = [];
  for (const file of files) {
    if (discussesTheRules(file)) {
      continue;
    }
    for (const bank of BANKS) {
      // Not followed by "Bank", and not inside a longer word.
      const bare = new RegExp(`\\b${bank}\\b(?!\\s+Bank)`, "g");
      const matches = file.text.match(bare);
      if (matches) {
        findings.push({
          kind: "bare_bank_name",
          path: file.path,
          detail:
            `${bank} appears ${matches.length} time(s) without "Bank" after `
            + "it. The naming rules require it in filenames and in prose.",
        });
      }
    }
  }
  return findings;
}

/** Abbreviations the naming rules reject outright. */
function rejectedAbbreviations(files: StoreFile[]): StoreFinding[] {
  const findings: StoreFinding[] = [];
  for (const file of files) {
    if (discussesTheRules(file)) {
      continue;
    }
    for (const abbreviation of REJECTED_ABBREVIATIONS) {
      if (new RegExp(`\\b${abbreviation}\\b`).test(file.text)) {
        findings.push({
          kind: "rejected_abbreviation",
          path: file.path,
          detail: `Uses ${abbreviation}, which the naming rules reject outright.`,
        });
      }
    }
  }
  return findings;
}

/**
 * Values that look derived, and so will be wrong later.
 *
 * Candidates rather than verdicts: the same words are fine inside a quotation
 * of something somebody said.
 */
function storedDerivedValues(files: StoreFile[]): StoreFinding[] {
  const findings: StoreFinding[] = [];
  for (const file of files) {
    if (file.path.startsWith(INSTRUCTIONS_PREFIX)) {
      continue;
    }
    for (const pattern of DERIVED_VALUE_PATTERNS) {
      const match = file.text.match(pattern);
      if (match) {
        findings.push({
          kind: "possible_derived_value",
          path: file.path,
          detail:
            `Contains "${match[0]}", which reads as a derived value. The `
            + "store-the-fact rule says record the date and compute the rest. "
            + "Check whether this is a stored age or a quotation.",
        });
        break;
      }
    }
  }
  return findings;
}

/**
 * Bullets and paragraphs that open with a reference to something unnamed.
 *
 * An entry beginning "It went from Scotia to TD Bank" only means anything to
 * a reader who has just read the entry above it, and search retrieves an
 * entry rather than a file. Such a fact is in the store and cannot be
 * retrieved, which is indistinguishable from never having recorded it.
 *
 * Only the opening is checked. Pronouns inside an entry that has already named
 * its subject are ordinary prose, and flagging them would bury the real
 * findings.
 */
function entriesWithoutASubject(files: StoreFile[]): StoreFinding[] {
  const findings: StoreFinding[] = [];
  for (const file of files) {
    if (discussesTheRules(file)) {
      continue;
    }
    const lines = file.text.split("\n");
    lines.forEach((line, index) => {
      const opener = ENTRY_OPENING_REFERENCE.exec(line);
      if (!opener) {
        return;
      }
      // Only an entry's first line counts. A continuation line inside a
      // bullet has its subject a few words earlier, not a chunk away.
      const previous = lines[index - 1] ?? "";
      if (previous.trim().length > 0 && !/^[-*]\s/.test(line)) {
        return;
      }
      findings.push({
        kind: "entry_without_a_subject",
        path: file.path,
        detail:
          `Line ${index + 1} opens with "${opener[1]}", which names nothing. `
          + "Retrieved on its own — and search retrieves entries, not files — "
          + "this says nothing and cannot be found by searching for its "
          + "subject. Name the subject.",
      });
    });
  }
  return findings;
}

/** Extensions the store permits, for a caller checking a proposed path. */
export function permittedExtensions(): readonly string[] {
  return ALLOWED_EXTENSIONS;
}

/** The namespace every finding is relative to. */
export function checkedNamespace(): string {
  return NAMESPACE;
}
