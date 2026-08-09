import { describe, expect, test } from "vitest";

import { assertManagedPath } from "../src/memory_tree";

/**
 * assertManagedPath is the boundary that keeps structural changes inside the
 * namespace. Everything else in memory_tree.ts calls the GitHub API, so it is
 * covered by the integration path rather than here.
 *
 * The token this server holds can write anywhere in the repo, so these checks
 * are the only thing stopping it. The repo may hold code, notes, anything —
 * none of it is this server's business.
 */

describe("assertManagedPath accepts paths inside the namespace", () => {
  test.each([
    "ix/memory/facts/core.md",
    "ix/memory/facts/inventory.yaml",
    "ix/memory/facts/preferences/food.yaml",
    "ix/memory/facts/home/kitchen.md",
    "ix/memory/decisions/2026.md",
    "ix/memory/capture-rules.md",
    "ix/memory/a/b/c/deep.md",
  ])("%s", (path) => {
    expect(() => assertManagedPath(path)).not.toThrow();
  });
});

describe("assertManagedPath rejects paths outside the namespace", () => {
  test.each([
    ["repo root", "README.md"],
    ["another root file", "package.json"],
    ["the old top-level layout", "memory/core.md"],
    ["a sibling namespace", "ix/drive/cache.md"],
    ["the namespace parent", "ix/notes.md"],
    ["source code", "src/index.ts"],
    ["someone else's directory", "docs/guide.md"],
  ])("%s: %s", (_name, path) => {
    expect(() => assertManagedPath(path)).toThrow();
  });
});

describe("assertManagedPath rejects traversal and escapes", () => {
  test.each([
    ["parent traversal", "../secrets.md"],
    ["traversal after prefix", "ix/memory/../../README.md"],
    ["double traversal", "ix/memory/../../../escape.md"],
    ["nested traversal", "ix/memory/sub/../../../package.json"],
    ["absolute path", "/etc/passwd"],
    ["absolute repo path", "/ix/memory/core.md"],
    ["double slash", "ix/memory//core.md"],
  ])("%s: %s", (_name, path) => {
    expect(() => assertManagedPath(path)).toThrow();
  });
});

describe("assertManagedPath rejects malformed paths", () => {
  test.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["leading space", " ix/memory/core.md"],
    ["trailing space", "ix/memory/core.md "],
    ["hidden file", "ix/memory/.hidden.md"],
    ["hidden directory", "ix/memory/.git/config.md"],
    ["folder rather than file", "ix/memory/facts/"],
  ])("%s: %s", (_name, path) => {
    expect(() => assertManagedPath(path)).toThrow();
  });
});

describe("assertManagedPath rejects unexpected extensions", () => {
  test.each([
    ["plain text", "ix/memory/facts/notes.txt"],
    ["json", "ix/memory/facts/data.json"],
    ["executable", "ix/memory/facts/script.sh"],
    ["no extension", "ix/memory/facts/notes"],
    ["extension in the middle", "ix/memory/facts/notes.md.txt"],
  ])("%s: %s", (_name, path) => {
    expect(() => assertManagedPath(path)).toThrow();
  });
});

describe("assertManagedPath protects the instructions file", () => {
  test("refuses to move or delete it", () => {
    // Readable so the assistant can follow the rules; not its to restructure.
    expect(() => assertManagedPath("ix/memory/INSTRUCTIONS.md")).toThrow(
      /rules this server follows/,
    );
  });
});

describe("assertManagedPath error messages", () => {
  test("names the namespace when the path is outside it", () => {
    expect(() => assertManagedPath("README.md")).toThrow(/ix\/memory\//);
  });

  test("explains that folders are implicit", () => {
    expect(() => assertManagedPath("ix/memory/facts/")).toThrow(
      /created implicitly/,
    );
  });
});
