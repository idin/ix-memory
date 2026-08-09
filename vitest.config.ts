import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Tests run inside workerd rather than Node, so `crypto.subtle` and the other
 * Workers globals behave exactly as they do in production.
 *
 * These are pure-logic tests: nothing here touches the GitHub API or the real
 * memory repo. The functions that make network calls are deliberately not
 * covered — see README.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
