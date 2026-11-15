# Message handlers — custom extractor sample

A sample [custom extractor](../README.md) that examines a TypeScript project
with the project's own `typescript` package and emits `architecture/v0`,
presented by the built-in graph renderer's `architecture` view: events, the
handlers that consume them, the publishers that emit them and the packages that
register them.

This was a built-in extractor. It is a sample now because it encodes one team's
conventions; copy it into your repository and adapt it. A dedicated messaging
projection built on AsyncAPI documents and framework subscriber registries is
[proposed](../../../docs/design/proposals/messaging-proposal.md).

```json
{
  "id": "message-handlers",
  "title": "Message handlers",
  "extractor": {
    "command": ["node", "tools/projections/message-handlers/extract.mjs"],
    "sources": ["tools/projections/message-handlers", "tools/projections/typescript-common"]
  },
  "renderer": "architecture",
  "inputs": {"handlerApis": [{"module": "@company/bus", "symbol": "subscribe"}], "publishApis": [{"module": "@company/bus", "symbol": "publish"}]}
}
```

## Inputs

At least one nonempty convention array is **required**:

- `handlerApis`: calls shaped as `on("event", handler)`.
- `handlerDecorators`: method/class decorators shaped as `@Handles("event")`.
- `handlerRegistries`: calls shaped as
  `registry({ event: handler, "other": fn })`.

`eventArgument` and `handlerArgument` are optional nonnegative indexes,
defaulting to `0` and `1`; registries always take the mapping as their first
argument.

`publishApis` is optional: calls shaped as `publish("event", payload)` add a
`publishes` edge from the enclosing named function to the event, so a subscribed
event that nothing publishes is visible. `publishArgument` defaults to `0`.

```json
{
  "handlerApis": [{"module":"@company/bus","symbol":"subscribe"}],
  "handlerDecorators": [{"module":"@company/bus","symbol":"Handles"}],
  "handlerRegistries": [{"module":"@company/bus","symbol":"registerHandlers"}],
  "publishApis": [{"module":"@company/bus","symbol":"publish"}]
}
```

Events are string-keyed and scoped to the configured module. Named/imported
handler symbols resolve to their declaration and owning package; inline handlers
receive event-scoped identities. Registries support explicit object properties,
not spreads, computed event keys, or object methods. This does not infer broker
topics from environment values, class-token events, reflection metadata or
runtime subscriptions.

Conventions are `{"module", "symbol"}` objects matched by resolved symbol
identity, so renamed imports, namespace imports and re-exports match and an
unrelated function with the same name doesn't. `symbol` is an export name,
`default` (including `export =`), or a member path such as `client.variation`.
The shared inputs `tsconfig`, `tsconfigs` and `diagnostics` select the program;
see [the samples overview](../README.md).

## Tests

`test/fixtures` holds small TypeScript projects and, for each, the extraction
the former built-in produced (without evidence). The tests require the sample to
reproduce it exactly, and cover warnings and failures:

```sh
npm test --workspace @githubnext/projections-example-extractors
```
