import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Three kinds of test, which need three different environments.
 *
 * `worker` holds the logic tests. They run inside workerd rather than Node, so
 * `crypto.subtle` and the other Workers globals behave exactly as they do in
 * production. Nothing here touches the network.
 *
 * `repository` holds tests that inspect the repository itself rather than the
 * code — that secrets cannot be committed, that the ignore rules exist. These
 * need `node:child_process` to ask git questions, which workerd has no way to
 * provide.
 *
 * `integration` holds tests that talk to a real GitHub repository. They are
 * excluded from the default run because they are slow, need a token, and
 * mutate a repository. Run them deliberately with `npm run test:integration`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.integration.test.ts", "tests/secret_hygiene.test.ts"],
        },
      },
      {
        test: {
          name: "repository",
          environment: "node",
          include: ["tests/secret_hygiene.test.ts"],
        },
      },
    ],
  },
});
