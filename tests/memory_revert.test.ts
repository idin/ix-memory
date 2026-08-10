import { describe, expect, test } from "vitest";

import { planDigest, revertOperation, type RevertPlan } from "../src/memory_revert";

/**
 * Build a plan without touching the network.
 *
 * @param overrides - Fields to change from the default.
 * @returns A plan suitable for digesting.
 */
function plan(overrides: Partial<RevertPlan> = {}): RevertPlan {
  return {
    targetCommitSha: "a".repeat(40),
    targetCommitDate: "2026-01-12T14:30:00Z",
    targetCommitMessage: "feat: something",
    restored: ["ix/memory/facts/core.md"],
    removed: ["ix/memory/facts/added_later.md"],
    unchanged: 3,
    ...overrides,
  };
}

describe("planDigest", () => {
  test("is stable for the same plan", async () => {
    // The preview and the confirmation build the digest separately. If it were
    // not deterministic, every confirmation would fail.
    expect(await planDigest(plan())).toBe(await planDigest(plan()));
  });

  test("changes when a file would be removed that would not have been", async () => {
    // The failure this whole mechanism exists to prevent.
    const previewed = plan({ removed: ["ix/memory/facts/added_later.md"] });
    const recomputed = plan({
      removed: ["ix/memory/facts/added_later.md", "ix/memory/facts/written_meanwhile.md"],
    });

    expect(await planDigest(previewed)).not.toBe(await planDigest(recomputed));
  });

  test("changes when a different file would be restored", async () => {
    const a = plan({ restored: ["ix/memory/facts/core.md"] });
    const b = plan({ restored: ["ix/memory/facts/biscuit.md"] });

    expect(await planDigest(a)).not.toBe(await planDigest(b));
  });

  test("tells apart a restore from a removal of the same path", async () => {
    // Without a separator between the two lists these would digest
    // identically, and a token issued to restore a file would authorise
    // deleting it.
    const restoring = plan({ restored: ["ix/memory/facts/core.md"], removed: [] });
    const removing = plan({ restored: [], removed: ["ix/memory/facts/core.md"] });

    expect(await planDigest(restoring)).not.toBe(await planDigest(removing));
  });

  test("is unaffected by how many files already match", async () => {
    // `unchanged` is a count shown to the user, not something being authorised.
    expect(await planDigest(plan({ unchanged: 0 }))).toBe(
      await planDigest(plan({ unchanged: 99 })),
    );
  });
});

describe("revertOperation", () => {
  test("names both the target commit and the plan", async () => {
    const operation = await revertOperation(plan());

    expect(operation).toContain(`revert:${"a".repeat(40)}`);
    expect(operation).toBe(`revert:${"a".repeat(40)}:${await planDigest(plan())}`);
  });

  test("differs between plans that share a target commit", async () => {
    // The bug in one line: the same timestamp resolves to the same commit
    // however much the repository has changed since.
    const previewed = plan({ removed: [] });
    const recomputed = plan({ removed: ["ix/memory/facts/written_meanwhile.md"] });

    expect(previewed.targetCommitSha).toBe(recomputed.targetCommitSha);
    expect(await revertOperation(previewed)).not.toBe(await revertOperation(recomputed));
  });
});
