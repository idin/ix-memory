import { describe, expect, test } from "vitest";

import { confirmationToken, isValidConfirmation } from "../src/confirmation";

const SECRET = "a-test-signing-key";
const NOW = 1_775_000_000_000;

const DELETE_CORE = "delete:memory/core.md";
const DELETE_WORK = "delete:memory/work.md";

const MINUTE = 60 * 1000;

describe("confirmationToken", () => {
  test("same operation and time produce the same token", async () => {
    const first = await confirmationToken(SECRET, DELETE_CORE, NOW);
    const second = await confirmationToken(SECRET, DELETE_CORE, NOW);
    expect(first).toBe(second);
  });

  test("different operations produce different tokens", async () => {
    const core = await confirmationToken(SECRET, DELETE_CORE, NOW);
    const work = await confirmationToken(SECRET, DELETE_WORK, NOW);
    expect(core).not.toBe(work);
  });

  test("different secrets produce different tokens", async () => {
    const ours = await confirmationToken(SECRET, DELETE_CORE, NOW);
    const theirs = await confirmationToken("a-different-key", DELETE_CORE, NOW);
    expect(ours).not.toBe(theirs);
  });

  test("token is hex and short enough to read back to a user", async () => {
    const token = await confirmationToken(SECRET, DELETE_CORE, NOW);
    expect(token).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("isValidConfirmation", () => {
  test("accepts the token issued for that operation", async () => {
    const token = await confirmationToken(SECRET, DELETE_CORE, NOW);
    expect(await isValidConfirmation(SECRET, DELETE_CORE, token, NOW)).toBe(true);
  });

  test("rejects a token issued for a different file", async () => {
    const token = await confirmationToken(SECRET, DELETE_CORE, NOW);
    expect(await isValidConfirmation(SECRET, DELETE_WORK, token, NOW)).toBe(false);
  });

  test("rejects a guessed token", async () => {
    expect(
      await isValidConfirmation(SECRET, DELETE_CORE, "deadbeefdeadbeef", NOW),
    ).toBe(false);
  });

  test("rejects an empty token", async () => {
    expect(await isValidConfirmation(SECRET, DELETE_CORE, "", NOW)).toBe(false);
  });

  test("rejects a token derived with a different secret", async () => {
    const forged = await confirmationToken("attacker-key", DELETE_CORE, NOW);
    expect(await isValidConfirmation(SECRET, DELETE_CORE, forged, NOW)).toBe(false);
  });

  test("still accepts a token nine minutes later", async () => {
    const token = await confirmationToken(SECRET, DELETE_CORE, NOW);
    expect(
      await isValidConfirmation(SECRET, DELETE_CORE, token, NOW + 9 * MINUTE),
    ).toBe(true);
  });

  test("accepts across a bucket boundary via the previous bucket", async () => {
    // A token issued just before a boundary must still work just after it.
    const justBeforeBoundary = Math.ceil(NOW / (10 * MINUTE)) * (10 * MINUTE) - 1;
    const token = await confirmationToken(SECRET, DELETE_CORE, justBeforeBoundary);
    expect(
      await isValidConfirmation(SECRET, DELETE_CORE, token, justBeforeBoundary + 2),
    ).toBe(true);
  });

  test("rejects a token forty-five minutes later", async () => {
    const token = await confirmationToken(SECRET, DELETE_CORE, NOW);
    expect(
      await isValidConfirmation(SECRET, DELETE_CORE, token, NOW + 45 * MINUTE),
    ).toBe(false);
  });
});
