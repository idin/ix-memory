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
    "ix/memory/capture-rules.md",
    "ix/memory/INSTRUCTIONS.md",
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
    "ix/memory/capture-rules.md",
  ])("%s", (path) => {
    expect(() => assertAppendable(path)).not.toThrow();
  });
});

describe("assertAppendable protects the instructions file", () => {
  test("readable but not writable", () => {
    expect(() => assertReadable("ix/memory/INSTRUCTIONS.md")).not.toThrow();
    expect(() => assertAppendable("ix/memory/INSTRUCTIONS.md")).toThrow(
      /read-only/,
    );
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
    expect(describeAppendablePaths()).toContain("INSTRUCTIONS.md");
    expect(describeAppendablePaths()).toContain("except");
  });
});
