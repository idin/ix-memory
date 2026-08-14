# Storage options for a search index on Cloudflare

Reference for where a derived search index can live when the server is a
Worker. Written 2026-08-14; the decision recorded at the end is specific to
this project's size and may not survive growth.

## The four options

### D1

SQLite as a service, reached through a Worker binding. Supports **FTS5
virtual tables** for full-text search, including `fts5vocab`. One caveat worth
knowing: **export is not supported for databases containing virtual tables** —
the workaround is to drop them, export, and recreate.

Accessed via `env.BINDING.prepare(sql).bind(...)`. `bind` accepts
`ArrayBuffer`, so binary values such as embedding vectors can be stored
directly rather than encoded as text.

Shared across every request and every session. Survives disconnection.

### Durable Object SQLite

A SQLite database embedded in a Durable Object, available when the class is
declared in `new_sqlite_classes`. Reached through `ctx.storage.sql.exec(query,
...bindings)`, with `ctx.storage.sql.databaseSize` giving the current size in
bytes. Limit is 10 GB per object.

Synchronous, in the same isolate, on local disk — so no network hop.

The `agents` package, which `McpAgent` is built on, exposes a **public `sql`
tagged-template helper** on `Agent`. Its value type is `string | number |
boolean | null`, so **binary cannot pass through it**; reaching
`ctx.storage.sql.exec` directly is necessary for `ArrayBuffer` values. Every
table the `agents` package creates for itself is prefixed `cf_agents_`
(`cf_agents_state`, `cf_agents_schedules`, `cf_agents_queues` and others), so
application tables cannot collide with them by accident.

Scoped to the Durable Object instance. For an MCP server, that means **per
session**: a new connection is a new object with empty storage.

### Vectorize

Cloudflare's distributed vector database, with a Workers binding and a client
API for insert, upsert, query and management. Vectors are queryable "within a
few seconds" of insertion — an eventual-consistency window that matters if a
rebuild is immediately followed by a query.

Designed to be paired with Workers AI, and to reference objects held elsewhere
(R2, KV, D1) from vector search results.

### KV

Eventually consistent key-value storage. Suited to configuration and cached
values, not to anything requiring queries across records.

## Choosing between them

The properties that actually decide it:

**Lifetime.** DO storage is per session. If the indexed data is a pure
function of something stable — a commit SHA, a document version — then a
per-session index recomputes identical data on every connection. Shared
storage lets one build serve every session.

**Binary support.** Embedding vectors are naturally `Float32Array`. D1's
`bind` and `ctx.storage.sql.exec` both accept `ArrayBuffer`; the `agents`
`sql` helper does not.

**Library versus deployment.** A binding that only exists in one deployment
makes any feature depending on it a deployment feature. If the code is a
published package, requiring a new binding is a breaking change for everyone
installing it. The pattern that avoids this is an interface with a no-op
default, implemented by the deployment — the same shape as a logging sink.

**Scale.** Brute-force cosine similarity over vectors held in memory is
sub-millisecond in the hundreds and untenable in the millions. Vectorize earns
its complexity somewhere between, and the crossover is worth measuring rather
than guessing.

## What this project chose, and why

**D1, keyed by commit SHA**, for both the chunk index and the vectors.

The index is a pure function of the commit: the same commit produces the same
chunks and the same vectors, every time. Per-session Durable Object storage
would therefore re-embed the entire store on every new connection, computing
data that a previous session already computed. Keying rows by commit SHA means
the first session to build at a commit builds it for all of them, and a
session arriving at an already-built commit does no work at all.

The counterargument was real and was weighed: D1 is deployment-only, so search
becomes unavailable to anyone installing the library without provisioning a
database. This is handled with a storage interface carrying a no-op default,
so the library degrades to lexical-only search and **says so in its
responses** rather than silently returning fewer results.

**Vectorize was not used.** At roughly 600 chunks, brute-force cosine
similarity in JavaScript is sub-millisecond, while Vectorize would add a
binding, a network hop, an eventual-consistency window between rebuild and
query, and a second store to invalidate. This is recorded here so the decision
is not re-litigated from scratch. It should be revisited above roughly 100,000
chunks, or if vector search becomes latency-critical rather than
correctness-critical.

**FTS5 was not used either**, for the same reason in a different direction:
the entire store fits comfortably in one request, so scoring every chunk
directly is simpler than maintaining an index that has its own invalidation
rules. FTS5 becomes the right answer for the imported dataset — order history,
listening history — which is genuinely large and genuinely structured.

## Sources

- https://developers.cloudflare.com/d1/sql-api/sql-statements/
- https://developers.cloudflare.com/durable-objects/api/storage-api/
- https://developers.cloudflare.com/vectorize/
- https://developers.cloudflare.com/vectorize/reference/client-api/
- https://developers.cloudflare.com/vectorize/get-started/embeddings/
- https://blog.cloudflare.com/building-vectorize-a-distributed-vector-database-on-cloudflare-developer-platform/
- `agents` package, `dist/index.js` (the `cf_agents_*` table definitions)
