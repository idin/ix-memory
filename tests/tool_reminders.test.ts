import { describe, expect, test } from "vitest";

import {
  reminderFor,
  TOOL_REMINDERS,
  withReminder,
} from "../src/tool_reminders";

/**
 * Tier 3: a rule delivered with the operation it governs, rather than read
 * once at session start and competing with everything since.
 *
 * The thing that makes this work is restraint. A reminder on every response
 * is a wall of text agents learn to skip, and skipping it costs the one that
 * mattered.
 */

describe("reminderFor", () => {
  test("filing a todo is reminded to file the rest", () => {
    // Capture rule 1, which an agent failed on 2026-08-12 by announcing a
    // write and ending the turn without making it.
    const reminder = reminderFor("create_memory_file", { topic: "todo" });
    expect(reminder).toContain("file that");
  });

  test("recording a fact is reminded not to record inferences", () => {
    const reminder = reminderFor("create_memory_file", { topic: "fact" });
    expect(reminder).toContain("inferred");
  });

  test("the same tool says different things for different topics", () => {
    // Relevance depends on the arguments, not only the tool, or every write
    // would carry every rule.
    expect(reminderFor("create_memory_file", { topic: "todo" })).not.toBe(
      reminderFor("create_memory_file", { topic: "fact" }),
    );
  });

  test("appending is reminded that corrections supersede", () => {
    expect(reminderFor("append_memory", { path: "x" })).toContain("~~");
  });

  test("deleting is reminded what may be deleted at all", () => {
    const reminder = reminderFor("delete_memory_file", { path: "x" });
    expect(reminder).toContain("never true");
  });

  test("a tool with no rule attached says nothing", () => {
    expect(reminderFor("read_memory", { path: "x" })).toBeNull();
    expect(reminderFor("describe_age", { birth_date: "1980" })).toBeNull();
  });

  test("a topic with no rule attached says nothing", () => {
    expect(reminderFor("create_memory_file", { topic: "decision" })).toBeNull();
  });

  test("only one reminder is ever returned", () => {
    // Two would be the wall of text this is trying to avoid.
    for (const reminder of TOOL_REMINDERS) {
      const text = reminderFor(reminder.tool, { topic: "todo", path: "x" });
      expect(typeof text === "string" || text === null).toBe(true);
    }
  });

  test("the list stays short enough to be read", () => {
    // Every rule could be attached to something. Attaching all of them costs
    // the ones that matter their only chance of being read.
    expect(TOOL_REMINDERS.length).toBeLessThanOrEqual(8);
  });
});

describe("withReminder", () => {
  test("the rule is set apart from the result", () => {
    // Run together, the rule reads as part of the answer.
    expect(withReminder("Created x.md", "Remember the thing.")).toBe(
      "Created x.md\n\nRemember the thing.",
    );
  });

  test("no rule leaves the result untouched", () => {
    expect(withReminder("Created x.md", null)).toBe("Created x.md");
  });
});
