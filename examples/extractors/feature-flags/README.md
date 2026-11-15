# Feature flags — custom extractor sample

A sample [custom extractor](../README.md) that examines a TypeScript project
with the project's own `typescript` package and emits `architecture/v0`,
presented by the built-in graph renderer's `architecture` view: flags, the code
that checks them and the owning packages, connected by `checks` and `owns`.

This was a built-in extractor. It is a sample now because it encodes one team's
conventions; copy it into your repository and adapt it.

```json
{
  "id": "feature-flags",
  "title": "Feature flags",
  "extractor": {
    "command": ["node", "tools/projections/feature-flags/extract.mjs"],
    "sources": ["tools/projections/feature-flags", "tools/projections/typescript-common"]
  },
  "renderer": "architecture",
  "inputs": {"flagApis": [{"module": "@company/flags", "symbol": "isEnabled"}]}
}
```

## Inputs

`flagApis` is **required**: a nonempty convention array. `flagArgument` is an
optional nonnegative argument index, default `0`.

```json
{
  "flagApis": [{"module":"@company/flags","symbol":"isEnabled"}],
  "flagArgument": 0
}
```

String literals, const-string bindings and checker literal types identify flags.
Flag identity includes provider module and key. Enclosing named
functions/classes or a package-level `"module"` consumer reference the flag;
ownership is attributed to the source package. Repeated checks are aggregated
with evidence. This does not query provider configuration or infer whether a
flag is currently enabled.

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
