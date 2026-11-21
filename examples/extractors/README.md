---
description: Custom extractor samples to copy and adapt, using the examined project's own TypeScript
---

# Custom extractor samples

Each directory is a [custom extractor](../../docs/guides/how-it-works.md) you
can copy into a repository and adapt: a command that reads one extractor request
on stdin and writes one `architecture/v0` extraction on stdout. They examine
TypeScript projects with the project's own `typescript` package (TypeScript 5
or 6) through its compiler API, so they resolve imports, aliases and re-exports
by symbol rather than by spelling. They read the request and write the
extraction with `@githubnext/projections/extractor`, which Projections provides
to the extractors it runs with `node`, so no Projections package is required.

<!-- prettier-ignore -->
| Sample | Finds | Renderer |
| --- | --- | --- |
| [`feature-flags`](feature-flags/README.md) | Flags checked through configured flag APIs, and the code checking them | `architecture` |
| [`http-routes`](http-routes/README.md) | Express and Fastify method and path registrations and their handlers | `architecture` |
| [`message-handlers`](message-handlers/README.md) | Events, handlers registered by calls, registries or decorators, and publishers | `architecture` |
| [`redux-slices`](redux-slices/README.md) | Redux Toolkit slices, actions, selectors and slice dependencies | `architecture` |
| [`class-summaries`](class-summaries/README.md) | Classes, each with a summary a model wrote, declared as [generated values](../../docs/design/generated-values.md) | `architecture` |

These were built-in extractors. They became samples because each encodes one
team's conventions (which API registers a route, which function checks a flag),
which is what custom extractors are for. They emit `architecture/v0`, which the
built-in graph renderer presents (`"renderer": "architecture"`), or write your
own renderer for a dedicated view. Like the built-in extractors, keep them
deterministic (see
[determinism and authority](../../docs/models/domain-model/extension-points.md#determinism-and-authority)).

## Using a sample

Copy the sample's directory and
[`typescript-common`](typescript-common/program.mjs), which they share, into
your repository, for example under `tools/projections/`, and add a projection
definition such as `.github/projections/http-routes.json`:

```json
{
  "id": "http-routes",
  "title": "HTTP routes",
  "extractor": {
    "command": ["node", "tools/projections/http-routes/extract.mjs"],
    "sources": ["tools/projections/http-routes", "tools/projections/typescript-common"]
  },
  "renderer": "architecture"
}
```

Custom extractors run only with `--trust`. Projections examines revisions
without their ignored files, so `node_modules` isn't part of
`request.repository.root`. The samples resolve `typescript` from
`request.repository.checkout` instead: your working checkout, where your package
manager installed it. One installation examines every compared revision. Install
dependencies, then run:

```sh
npm ci
projections show -p http-routes --trust
```

## Shared inputs

Besides each sample's own inputs:

- `tsconfig`, or `tsconfigs` (an array): the projects to analyze, with their
  project references. Otherwise the root `tsconfig.json`, or else every source
  file with strict ES2022 defaults.
- `diagnostics`: `"error"` (default) fails the extraction on compiler errors,
  with file, line and code; `"syntax"` permits semantic errors.

The nearest `package.json` owns each source file, and its `name` is the package
identity. Evidence names repository-relative files and lines. Calls whose keys
can't be determined statically are left out with a warning in
`metadata.limitations`, never guessed.

## Tests

Each sample's `test/fixtures` holds small projects and the extraction the former
built-in produced for them; the tests require the sample to reproduce it, and
cover warnings and failures. They run each sample as the CLI runs a custom
extractor and validate the output with the Engine:

```sh
npm test --workspace @githubnext/projections-example-extractors
```
