# Redux slices — custom extractor sample

A sample [custom extractor](../README.md) that examines a TypeScript project
with the project's own `typescript` package and emits `architecture/v0`,
presented by the built-in graph renderer's `architecture` view: packages,
slices, actions and selectors, connected by `owns`, `defines`, `depends-on` and
`imports`.

This was a built-in extractor. It is a sample now because it encodes one team's
conventions; copy it into your repository and adapt it.

```json
{
  "id": "redux-slices",
  "title": "Redux slices",
  "extractor": {
    "command": ["node", "tools/projections/redux-slices/extract.mjs"],
    "sources": ["tools/projections/redux-slices", "tools/projections/typescript-common"]
  },
  "renderer": "architecture",
  "inputs": {}
}
```

## Inputs

`sliceApis` is an optional nonempty convention array, defaulting to:

```json
[{"module":"@reduxjs/toolkit","symbol":"createSlice"}]
```

The recognized call takes an object (or statically resolvable const object) as
argument zero, with a literal/const-string `name`. Its `reducers` and
`selectors` checker properties become action/selector entities. References to
other resolved slice variables in reducers, selectors or `extraReducers`
establish `depends-on`. Destructured action/selector exports are tracked too.
Imports of recognized slices or their destructured actions/selectors establish
package-to-slice `imports`.

This models `createSlice` conventions, not all Redux: reducer-builder functions,
`combineReducers`, dynamic injection, RTK Query, runtime-generated action names
and control-flow-dependent state wiring are not inferred as complete application
state.

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
