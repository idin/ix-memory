import OAuthProvider from "@cloudflare/workers-oauth-provider";

import { GitHubHandler } from "./github_handler";
import { MemoryMCP } from "./index";

/**
 * A ready-to-deploy memory server.
 *
 * This is the whole thing assembled: the MCP agent, GitHub as the identity
 * provider, and the OAuth endpoints wired together. A deployment that wants
 * the server as it comes can point `wrangler.jsonc` at this file and be done.
 *
 * It is deliberately separate from `index.ts`. That file is the library —
 * importing it must not also hand you a running worker, because a deployment
 * that needs to change anything would then have no way to do so except by
 * editing the library's own source. That is exactly what happened before this
 * split existed, and the edits were silently lost every time the library was
 * updated.
 *
 * To extend the server rather than replace it, subclass `MemoryMCP`, register
 * whatever else you need, and build your own provider here — see the README.
 */
export default new OAuthProvider({
  apiHandlers: {
    "/sse": MemoryMCP.serveSSE("/sse"),
    "/mcp": MemoryMCP.serve("/mcp"),
  },
  defaultHandler: GitHubHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
