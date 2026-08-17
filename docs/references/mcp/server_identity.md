# Server identity

How an MCP server names itself, and which field a client actually shows.

## `serverInfo`

The server returns `serverInfo` in its response to `initialize`. It carries
three fields, and the distinction between the first two is the one most easily
got wrong.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": { },
    "serverInfo": {
      "name": "ExampleServer",
      "title": "Example Server Display Name",
      "version": "1.0.0"
    },
    "instructions": "Optional instructions for the client"
  }
}
```

`serverInfo` is an `Implementation`, which extends `BaseMetadata` with a
`version`. `BaseMetadata` is where `name` and `title` are defined, and the
SDK's own comments state their purposes plainly:

- **`name`** — "Intended for programmatic or logical use, but used as a display
  name in past specs or fallback." Required.
- **`title`** — "Intended for UI and end-user contexts — optimized to be
  human-readable and easily understood, even by those unfamiliar with
  domain-specific terminology." Optional.
- **`version`** — the server's own version, not the protocol's.

### Which one is displayed

`title` when present; `name` as the fallback. The fallback is why a server
that sets only `name` still shows something sensible, and why a display name
placed in `name` appears to work.

It is still wrong to put a display name in `name`, because `name` is an
identifier elsewhere. Claude Code namespaces tools as
`mcp__<server-name>__<tool-name>`, so a `name` containing spaces or
punctuation ends up inside a generated identifier.

The safe shape:

```ts
new McpServer({
  name: "other-memory",     // slug: matches the package and repository
  title: "Other Memory",    // what a person reads
  version: "0.2.0",
});
```

### What clients actually do

Client behaviour does not always match the spec, and this is worth checking
per client rather than assuming:

- **Claude Code** uses `name` for the tool prefix, as above.
- **claude.ai custom connectors** ask the person adding the connector to type
  a name, and display that. Neither `name` nor `title` from the server
  overrides what was typed. Observed 2026-08-10; the support article does not
  document the name field.
- **Claude Desktop's Cowork surface** has been reported to ignore
  `serverInfo.name` entirely and generate a UUID slug instead.

The lesson: the spec tells you what to send. It does not tell you what a
given client will show. Confirm in the client before changing anything on the
strength of what it ought to do.

## `instructions`

Optional free text returned alongside `serverInfo`, describing how to use the
server. Clients may pass it to the model as context.

## Icons

`Implementation` also carries an optional `icons` field. Claude.ai does not
render icons for custom connectors — every custom connector gets a generic
one, and branded icons are configured by Anthropic for first-party listings
only. So the name carries all the identification.

## Sources

- https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
- `@modelcontextprotocol/sdk` — `dist/esm/types.js`, `BaseMetadataSchema`
  (line 298) and `ImplementationSchema` (line 315)
- https://github.com/anthropics/claude-ai-mcp/issues/167 — Cowork falling back
  to a UUID instead of the advertised name
- https://github.com/anthropics/claude-ai-mcp/issues/152 — icons not rendered
  for custom connectors
