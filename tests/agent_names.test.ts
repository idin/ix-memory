import { describe, expect, test } from "vitest";

import {
  agentDirectoryName,
  matchAgentName,
  normalizeAgentName,
} from "../src/agent_names";

describe("normalizeAgentName collapses separators and case", () => {
  test.each([
    ["Ada", "ada"],
    ["ada", "ada"],
    ["ADA", "ada"],
    ["A-D-A", "ada"],
    ["A_D_A", "ada"],
    ["a d a", "ada"],
    ["  Ada  ", "ada"],
    ["A.D.A", "ada"],
    ["Ada-Lovelace", "adalovelace"],
    ["ada_lovelace", "adalovelace"],
    ["Ada Lovelace", "adalovelace"],
  ])("%s normalizes to %s", (input, expected) => {
    expect(normalizeAgentName(input)).toBe(expected);
  });

  test("all spellings of one name share a key", () => {
    const spellings = ["Ada", "ada", "A-D-A", "a_d_a", " ADA "];
    const keys = new Set(spellings.map(normalizeAgentName));
    expect(keys.size).toBe(1);
  });

  test("strips accents so Adá and Ada are one mailbox", () => {
    expect(normalizeAgentName("Adá")).toBe("ada");
  });

  test("rejects a name that normalizes to nothing", () => {
    expect(() => normalizeAgentName("---")).toThrow();
    expect(() => normalizeAgentName("   ")).toThrow();
  });
});

describe("agentDirectoryName", () => {
  test("returns the normalized key", () => {
    expect(agentDirectoryName("Ada Lovelace")).toBe("adalovelace");
  });

  test("two spellings map to the same directory", () => {
    expect(agentDirectoryName("A-D-A")).toBe(agentDirectoryName("ada"));
  });

  test("rejects characters that cannot be used in a path", () => {
    expect(() => agentDirectoryName("ada/../root")).toThrow();
    expect(() => agentDirectoryName("ada:1")).toThrow();
    expect(() => agentDirectoryName("ada*")).toThrow();
  });

  test("allows digits", () => {
    expect(agentDirectoryName("agent-7")).toBe("agent7");
  });
});

describe("matchAgentName", () => {
  const existing = ["ada", "scout", "archivist"];

  test("matches exactly regardless of spelling", () => {
    for (const spelling of ["Ada", "A-D-A", "ada", " ADA "]) {
      expect(matchAgentName(spelling, existing).exact).toBe("ada");
    }
  });

  test("reports no exact match for an unknown name", () => {
    expect(matchAgentName("nobody", existing).exact).toBeNull();
  });

  test("suggests a near miss for a typo", () => {
    const match = matchAgentName("adda", existing);
    expect(match.exact).toBeNull();
    expect(match.near).toContain("ada");
  });

  test("suggests nothing for a name that is nothing like the others", () => {
    const match = matchAgentName("zephyrine", existing);
    expect(match.exact).toBeNull();
    expect(match.near).toHaveLength(0);
  });

  test("orders suggestions by closeness", () => {
    const match = matchAgentName("scut", ["scout", "archivist"]);
    expect(match.near[0]).toBe("scout");
  });

  test("returns no match against an empty mailbox list", () => {
    const match = matchAgentName("ada", []);
    expect(match.exact).toBeNull();
    expect(match.near).toHaveLength(0);
  });

  test("is strict for short names so unrelated ones are not suggested", () => {
    // "bob" and "ada" differ by 3 — never a suggestion.
    const match = matchAgentName("bob", ["ada"]);
    expect(match.near).toHaveLength(0);
  });
});
