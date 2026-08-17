# Client connection troubleshooting

What broke connecting real MCP clients to a freshly-renamed deployment, and
what fixed it. Recorded from the `other-memory` rename's own deploy, so the
next Worker rename (or first deploy anywhere) doesn't rediscover the same
things by trial and error.

## Renaming a deployed Worker breaks the GitHub OAuth App's callback

A GitHub OAuth App has exactly one **Authorization callback URL** and one
**Homepage URL**, both hardcoded to a specific domain. Renaming the Worker
(`wrangler.jsonc`'s `name`) changes its `*.workers.dev` domain on deploy —
the OAuth App does not follow automatically. The client then hits GitHub's
"Be careful! The `redirect_uri` is not associated with this application"
warning page rather than reaching the server at all.

Fix: on `github.com/settings/developers` → the OAuth App → General, update
both **Homepage URL** and **Authorization callback URL** (and the
**Redirect URI** field further down, which is the actual one enforced) to
the new domain, then **Update application**. Do this before trying to
reconnect any client — the error otherwise looks like a client-side
misconfiguration rather than a stale App setting.

## The connector URL needs the `/mcp` path, not the bare domain

Pointing a client at `https://<worker>.workers.dev` (no path) gets a 404 —
the root path serves nothing. `OAuthProvider`'s `apiHandlers` in
`src/worker.ts` mount the server at `/mcp` and `/sse` specifically. The
connector URL must be the full `https://<worker>.workers.dev/mcp`.

## A large single-commit change can break D1-backed incremental indexing

Not a client-connection issue per se, but it surfaces as one: a "connection
issue" or a tool call failing right after OAuth succeeds can be the server
throwing server-side, not the client failing to connect. Check
`npx wrangler tail --format pretty` against the live Worker during a failing
call before assuming the client is at fault — in this case it revealed
`D1_ERROR: too many SQL variables`, a real bug in `carryForward`'s exclusion
list (see `future/proposals/2026-08-16_carry_forward_breaks_past_d1s_bound_parameter_limit.md`
in the memory repo), triggered by a single commit changing ~130 files (a
folder-wide rename). Cleared the stale `memory_index_state` row to force a
full rebuild as a one-time unblock; the underlying bug is still unfixed.

## What worked without issue

- **Claude (claude.ai custom connector)**: full OAuth flow, `search_memory`
  worked once the callback URL and `/mcp` path were both correct.
- **ChatGPT (Developer Mode custom connector)**: connected via OAuth to the
  same `/mcp` URL, `search` worked. See the "ChatGPT" section for the one
  thing that didn't.

## ChatGPT: write tools are less reliable than read tools

Confirmed working: search-shaped read calls. Confirmed unreliable: a write
call (adding a todo) failed with "the other memory connector disappeared
between calls" — no corresponding server-side error in `wrangler tail` at
the same timestamp (server logged the request as `Ok`). This points to a
client-side connector-session issue in ChatGPT's Developer Mode, not a
server bug — plausibly because ChatGPT's MCP integration is built primarily
around the `search`/`fetch` read-only tool shape (see OpenAI's own MCP docs,
which describe exactly those two tools as the expected shape), and write
tools like `append_memory`/`create_memory_file` sit outside that designed
path. Not yet root-caused further; retry-on-failure was the only workaround
tried.
