# Tools

What a tool definition contains, how results are shaped, and how failures are
reported.

## Definition

```json
{
  "name": "get_weather",
  "title": "Weather Information Provider",
  "description": "Get current weather information for a location",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "City name or zip code" }
    },
    "required": ["location"]
  }
}
```

- **`name`** — unique identifier. Required.
- **`title`** — optional human-readable name for display.
- **`description`** — what the tool does. This is what the model reads when
  deciding whether to call it, so it is prompt text rather than documentation.
- **`inputSchema`** — JSON Schema for the parameters. Required.
- **`outputSchema`** — optional JSON Schema for structured results. If
  present, the server **MUST** return conforming structured results and
  clients **SHOULD** validate them.
- **`annotations`** — optional behavioural hints, below.

Display precedence for a tool differs from everything else: `annotations.title`
wins over `title`, which wins over `name`.

## Annotations

Four boolean hints, all optional, describing how a tool behaves. Their
defaults are not all `false`, which matters:

| Hint | Default | Meaning |
| --- | --- | --- |
| `readOnlyHint` | `false` | The tool does not modify its environment. |
| `destructiveHint` | **`true`** | The tool may perform destructive updates. Only meaningful when `readOnlyHint` is false. |
| `idempotentHint` | `false` | Calling it repeatedly with the same arguments has no additional effect. Only meaningful when `readOnlyHint` is false. |
| `openWorldHint` | `true` | The tool interacts with an open world of external entities, as a web search does, rather than a closed one. |

`destructiveHint` defaulting to `true` means a tool that says nothing is
assumed destructive. A read-only tool should say so rather than rely on the
default.

The spec is explicit that clients **MUST** treat annotations as untrusted
unless the server is trusted. They are a hint for presentation, not a
security boundary.

## Results

### Unstructured content

Returned in `content`, which may hold several items of different types:

```json
{ "content": [{ "type": "text", "text": "Tool result text" }], "isError": false }
```

Content types: `text`, `image` (base64 plus `mimeType`), `audio`,
`resource_link` (a URI the client may fetch or subscribe to), and `resource`
(an embedded resource). All support optional annotations carrying audience,
priority and modification time.

### Structured content

Returned in `structuredContent` as a JSON object. For backwards compatibility a
tool returning structured content **SHOULD** also return the serialised JSON in
a text block.

## Errors

Two mechanisms, and choosing the wrong one loses information.

**Protocol errors** are JSON-RPC errors: unknown tool, invalid arguments, a
server fault. The call did not happen.

```json
{ "jsonrpc": "2.0", "id": 3, "error": { "code": -32602, "message": "Unknown tool: invalid_tool_name" } }
```

**Execution errors** are ordinary results with `isError: true`. The tool ran
and failed: an API was down, the input was rejected, a business rule refused.

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [{ "type": "text", "text": "Failed to fetch weather data: API rate limit exceeded" }],
    "isError": true
  }
}
```

The distinction matters to the model. An execution error reaches it as a
result it can read and act on; a protocol error is a transport failure it may
only see as a broken call. A handler that throws where it should have returned
`isError` gives the model nothing to work with, and a model that cannot tell a
failure from an empty result will report the empty result as the answer.

## Capability and change notifications

A server offering tools **MUST** declare the capability:

```json
{ "capabilities": { "tools": { "listChanged": true } } }
```

With `listChanged`, the server **SHOULD** send
`notifications/tools/list_changed` when the set of tools changes. Note that a
client may cache the tool list at connection time regardless — claude.ai does,
which is why a deployment that adds a tool needs the connector disconnected
and reconnected before the new tool is visible.

`tools/list` supports pagination via `cursor` and `nextCursor`.

## Sources

- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- `@modelcontextprotocol/sdk` — `dist/esm/types.js`, `ToolAnnotationsSchema`
  (line 1173) for the hint defaults
