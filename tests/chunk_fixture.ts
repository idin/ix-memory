import type { MemoryChunk } from "../src/chunking";
import type { StoreFile } from "../src/store_checks";

/**
 * Fixtures shared by the search test files.
 *
 * A chunk has enough fields that constructing one inline buries the property
 * under test in boilerplate, and every new field breaks every literal. These
 * default sensibly and take an override, so a test states only what it cares
 * about.
 */

/** A store file, for feeding to the chunker. */
export function storeFile(path: string, text: string): StoreFile {
  return { path, text, bytes: text.length };
}

/** A chunk, for testing what consumes chunks rather than what makes them. */
export function chunk(overrides: Partial<MemoryChunk> = {}): MemoryChunk {
  return {
    path: "ix/memory/facts/example.md",
    ordinal: 0,
    headingPath: [],
    filePreamble: "",
    text: "Idin has a toy poodle named Frodo.",
    superseded: [],
    containsSuperseded: false,
    dependsOnPrevious: false,
    isMessage: false,
    isDeep: false,
    startLine: 1,
    endLine: 1,
    ...overrides,
  };
}
