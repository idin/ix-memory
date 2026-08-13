import { describe, expect, test } from "vitest";

import {
  assertAppendable,
  assertReadable,
  describeAppendablePaths,
  describeReadablePaths,
} from "../src/memory_repo";

/**
 * Reading and writing are confined to the same namespace as structural
 * changes. The one asymmetry is the instructions file: readable, so the
 * assistant can follow the rules it is given, but never writable, since
 * letting it rewrite its own rules would defeat the purpose.
 */

describe("assertReadable accepts paths inside the namespace", () => {
  test.each([
    "ix/memory/facts/core.md",
    "ix/memory/facts/preferences/food.yaml",
    "ix/memory/decisions/2026.md",
    "ix/memory/capture_rules/what_to_capture.md",
    "ix/memory/instructions/superseded_not_deleted.md",
    "ix/memory/messages/inbox/ada/note.md",
  ])("%s", (path) => {
    expect(() => assertReadable(path)).not.toThrow();
  });
});

describe("assertReadable rejects everything else in the repo", () => {
  test.each([
    ["repo root", "README.md"],
    ["package manifest", "package.json"],
    ["source code", "src/index.ts"],
    ["a sibling namespace", "ix/drive/cache.md"],
    ["the old layout", "memory/core.md"],
    ["traversal", "ix/memory/../.env"],
    ["absolute path", "/etc/passwd"],
    ["empty", ""],
  ])("%s: %s", (_name, path) => {
    expect(() => assertReadable(path)).toThrow();
  });
});

describe("assertAppendable accepts the same namespace", () => {
  test.each([
    "ix/memory/facts/core.md",
    "ix/memory/facts/preferences/food.yaml",
    "ix/memory/decisions/2026.md",
    "ix/memory/capture_rules/what_to_capture.md",
  ])("%s", (path) => {
    expect(() => assertAppendable(path)).not.toThrow();
  });
});

describe("assertAppendable protects every instruction, not one file", () => {
  // The instructions were a single file guarded by an equality check. Splitting
  // them into a folder without widening the guard would have left every rule
  // writable — the protection removed by the act of tidying.
  test.each([
    "ix/memory/instructions/superseded_not_deleted.md",
    "ix/memory/instructions/never_save_inferences.md",
    "ix/memory/instructions/security_posture.md",
    "ix/memory/instructions/README.md",
    "ix/memory/instructions/nested/deeper/invented.md",
  ])("readable but not writable: %s", (path) => {
    expect(() => assertReadable(path)).not.toThrow();
    expect(() => assertAppendable(path)).toThrow(/read-only/);
  });
});

describe("assertAppendable rejects everything outside", () => {
  test.each([
    ["repo root", "README.md"],
    ["source code", "src/index.ts"],
    ["a sibling namespace", "ix/drive/cache.md"],
    ["traversal", "ix/memory/../README.md"],
    ["absolute path", "/etc/passwd"],
    ["empty", ""],
  ])("%s: %s", (_name, path) => {
    expect(() => assertAppendable(path)).toThrow();
  });
});

describe("path descriptions", () => {
  test("readable description names the namespace", () => {
    expect(describeReadablePaths()).toContain("ix/memory/");
  });

  test("appendable description excludes the instructions file", () => {
    expect(describeAppendablePaths()).toContain("instructions/");
    expect(describeAppendablePaths()).toContain("except");
  });
});
