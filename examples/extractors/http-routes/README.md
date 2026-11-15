# HTTP routes — custom extractor sample

A sample [custom extractor](../README.md) that examines a TypeScript project
with the project's own `typescript` package and emits `architecture/v0`,
presented by the built-in graph renderer's `architecture` view: local method and
path registrations, their handlers and owning packages, connected by
`handled-by` and `owns`. Routes are `inferred`.

This was a built-in extractor. It is a sample now because it encodes one team's
conventions; copy it into your repository and adapt it.

```json
{
  "id": "http-routes",
  "title": "HTTP routes",
  "extractor": {
    "command": ["node", "tools/projections/http-routes/extract.mjs"],
    "sources": ["tools/projections/http-routes", "tools/projections/typescript-common"]
  },
  "renderer": "architecture",
  "inputs": {}
}
```

## Inputs

`routeFactories` is optional; defaults recognize `express`'s default export and
`Router`, plus `fastify`'s default export. Override it with a nonempty
convention array for explicitly compatible factories.

Supported registration shapes on resolved factory-produced receivers:

```ts
app.get("/users", handler);
app.post("/users", middleware, handler);
router.route("/orders").get(handler).post(handler);
server.get("/health", options, handler);
server.route({ method: ["GET", "PUT"], url: "/items", handler });
```

Dot-method registrations support `get`, `post`, `put`, `patch`, `delete`,
`head`, `options`, and `all`. String paths/methods may come from const bindings.
The last argument of shorthand registrations is the terminal handler. Handler
middleware arrays and dynamically composed receivers are not flattened.

Routes are local `(package, method, path)` registrations, **not** guaranteed
final network endpoints. Router mounts, middleware, Fastify plugin prefixes and
runtime control flow are not composed; observed `.use()`/`.register()` calls add
warnings. Regular-expression/array route paths, bracket method calls, Nest/Next
decorators, filesystem routing and arbitrary wrappers are not implicitly
supported.

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
