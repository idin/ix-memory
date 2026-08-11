# Lifecycle

The three phases of an MCP connection, and what each side may do in them.

1. **Initialization** — version agreement and capability negotiation
2. **Operation** — normal traffic, limited to what was negotiated
3. **Shutdown** — termination, handled by the transport

## Initialization

**MUST** be the first interaction. The client sends `initialize`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "roots": { "listChanged": true }, "sampling": { }, "elicitation": { } },
    "clientInfo": { "name": "ExampleClient", "title": "Example Client Display Name", "version": "1.0.0" }
  }
}
```

The server responds with its own capabilities and `serverInfo` — see
[server_identity.md](server_identity.md). The client then sends
`notifications/initialized`.

Before that notification completes, both sides are constrained: the client
**SHOULD NOT** send anything but pings, and the server **SHOULD NOT** send
anything but pings and logging.

## Version negotiation

The client sends the latest version it supports. If the server supports it, it
**MUST** echo the same version back. Otherwise it responds with a version it
does support, and the client **SHOULD** disconnect if it cannot speak that.

Over HTTP, every subsequent request **MUST** carry an
`MCP-Protocol-Version: <version>` header.

## Capabilities

Both sides declare what they can do, and may only use what was negotiated.

| Side | Capability | Meaning |
| --- | --- | --- |
| Client | `roots` | Can provide filesystem roots |
| Client | `sampling` | Supports LLM sampling requests |
| Client | `elicitation` | Supports server-initiated elicitation |
| Server | `prompts` | Offers prompt templates |
| Server | `resources` | Provides readable resources |
| Server | `tools` | Exposes callable tools |
| Server | `logging` | Emits structured log messages |
| Server | `completions` | Supports argument autocompletion |
| Either | `experimental` | Non-standard features |

Sub-capabilities: `listChanged` for prompts, resources and tools;
`subscribe` for resources only.

## Shutdown

No shutdown message exists. The transport signals it.

**stdio** — the client closes the child process's input stream, waits, then
escalates to `SIGTERM` and `SIGKILL`. The server may instead close its output
stream and exit.

**HTTP** — close the connection.

## Timeouts

Implementations **SHOULD** time out every request and **SHOULD** send a
cancellation notification when one expires. A progress notification **MAY**
reset the clock, but there **SHOULD** always be a maximum regardless, so a
misbehaving peer cannot hold a request open indefinitely.

## Sources

- https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
