# TypeScript public API

This extractor captures everything consumers can import from your TypeScript
packages—every export of every package entry point, along with its members and
signature as printed by your repository's own TypeScript checker. Compared
across a pull request, it shows what changed in your public API and whether
consumers might break.

<!-- generated: facts -->

- ID: `typescript-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `tsconfig.json`, `**/tsconfig.json`

<!-- end generated: facts -->

## When to use it

Use this extractor for libraries and shared packages—anything published to npm
or imported across a monorepo—where signature changes matter far more than the
internal code diff that produced them. Moving definitions between files,
renaming private helpers, or refactoring a function body creates zero noise
here, while adding a required parameter, narrowing an input type, or dropping an
export stands out immediately. Pair it with the
[`api-compatibility`](#classify-changes-as-breaking) comparator file to classify
changes as breaking, additive, or compatible.

It needs no `--trust`: it loads the TypeScript compiler from your checkout and
type-checks your source files without executing your code, running builds, or
evaluating config scripts.

Because it only inspects exported symbols, applications with no public API won't
have much to show. For other languages, see
[`rust-public-api`](rust-public-api.md), [`go-public-api`](go-public-api.md), or
[`dotnet-public-api`](dotnet-public-api.md).

## What it reads

- **Entry points.** If `inputs.entrypoints` is set, it reads either an array of
  source files (exposed together under `.`) or a map of public subpaths to
  source files (`{".": "src/index.ts", "./testing": "src/testing.ts"}`).
  Otherwise it reads each package's `package.json` `exports` field (including
  subpaths, conditions prioritizing `types`, and wildcards), falling back to
  `types` and `typings` if `exports` is absent. Missing targets such as an
  unbuilt `dist/index.d.ts` are never guessed to mean `src/index.ts`—set
  `entrypoints` explicitly instead.
- **The TypeScript program.** Uses `inputs.tsconfig` (or `inputs.tsconfigs` for
  a list), falling back to a root `tsconfig.json` or a strict default program
  over all source files. Project references are followed, though not built.
- **The compiler.** Uses your repository's installed `typescript` package (5.x
  or 6.x; TypeScript 7 projects also install `@typescript/typescript6`),
  resolved upward from the tsconfig directory in `node_modules`, along with
  Node.js 20+ on `PATH`. Projections doesn't bundle a compiler, so run your
  package manager install (`npm ci`) first. Third-party declarations come from
  your checkout's installed packages, while workspace source files always come
  from the revision being extracted.

Each export becomes an `export` entity (or `type` for interfaces and type
aliases) with `member` children for public or protected instance and static
members, constructors, and index, call, or construct signatures. Overloads
preserve the checker's order. Private members, `#private` fields, and function
bodies are omitted; classes with private members are marked for nominal
comparison without exposing those fields.

Because IDs combine the package name, public subpath, and exported name, moving
a declaration to another file produces no diff, while renaming an export shows
up as a removal and an addition. Every declaration also records contract details
(parameter and return union constituents, modifiers, and heritage clauses) for
`api-compatibility` rules. Type-checking errors fail extraction rather than
silently emitting `any` signatures.

## Options

<!-- generated: inputs -->

| Input         | Meaning                                           |
| ------------- | ------------------------------------------------- |
| `entrypoints` | Source paths or export subpath-to-source map.     |
| `tsconfig`    | tsconfig.json path.                               |
| `tsconfigs`   | Several tsconfig.json paths, instead of tsconfig. |

<!-- end generated: inputs -->

## What a comparison shows

The [`api`](../renderers/api.md) renderer displays every declaration and its
signature side by side or in a unified diff:

- **Added, removed, or modified declarations**, with inline signature diffs
  showing removed text struck through and added text underlined.
- **Renames**, when declared in the definition's `correspondence` (otherwise a
  renamed export appears as a removal and an addition).

The summary bar tallies declarations and deltas (`25 declarations +7 −1 ~8`).

### Classify changes as breaking

The default comparator tells you _that_ a declaration changed. To see what that
change means for consumers, use the `api-compatibility` comparator file shipped
with Projections. Copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and reference it in your definition:

```json
{
  "id": "api",
  "title": "Public API",
  "extractor": "typescript-public-api",
  "renderer": "api",
  "comparator": ".github/projections/api-compatibility.comparator.yaml"
}
```

Every change is then classified as `breaking`, `additive`, `compatible`, or
`unknown`, with an explanation and the rule that fired. Since TypeScript has no
formal breaking-change specification, the rules evaluate assignability over the
resolved types:

- **Breaking** — adding a required parameter (`required-parameter-added`),
  removing a parameter (`parameter-removed`), narrowing a parameter type
  (`parameter-narrowed`), widening a return type (`return-widened`), adding a
  required member to an interface (`member-added`), making a property required,
  optional, or `readonly`, or narrowing a type alias.
- **Additive** — adding an optional parameter (`parameter-added`), making a
  required parameter optional (`parameter-optional`), widening a parameter type
  or type alias, or adding an optional member.
- **Compatible** — renaming a parameter (`parameter-renamed`, since JavaScript
  arguments are positional) or narrowing a return type (`return-narrowed`).
- **Unknown** — changes requiring structural comparison of two object types,
  generics, or conditional and mapped types.

The summary bar groups counts by severity, breaking changes first
(`6 breaking changes · 9 additive changes · 1 compatible change`), with each
count filtering the list. The diff puts breaking changes at the top with their
reasons, and **Breaking only** (`breakingOnly` in
`presentation.rendererOptions`) hides everything else. Counts are exposed in
`metadata.compatibility` so CI can gate pull requests on breaking changes:

```sh
projections compare main...HEAD -p api --json > api.comparison.json
jq -e '.comparison.metadata.compatibility.counts.breaking == 0' api.comparison.json
```

See
[API compatibility](../../models/api-compatibility.md#typescript-assignability-over-the-checkers-types)
for the complete rule list.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "typescript-public-api",
  "id": "typescript-public-api",
  "renderer": "api",
  "title": "TypeScript public API"
}
```

<!-- end generated: definition -->

![The api renderer comparing a TypeScript package with the api-compatibility comparator: each changed declaration marked Added, Modified or Removed and Breaking, with its reason under the signature, and the summary bar counting 6 breaking, 9 additive and 1 compatible change](../../images/comparators/api-compatibility.png)

## Limitations

- It reflects the type checker's static view through your `tsconfig`, not
  runtime-generated exports, and it does not emit declaration files.
- Compatibility rules can't structurally compare two different object types,
  generic instantiations, or conditional, mapped, and template literal types;
  those come back as `unknown`. Function overloads are matched pairwise by
  position.
- Both revisions in a comparison use the same installed TypeScript compiler, so
  bumping TypeScript in a PR won't create false diffs. Comparing saved
  extractions produced by different TypeScript versions can add formatting
  noise, since compiler versions print some types differently.
- Project references aren't built automatically: unbuilt generated declarations
  need source path mappings or explicit `entrypoints`.
- Conflicting definitions for the same export across export conditions fail
  rather than arbitrarily picking one—give them distinct subpaths instead.
- Yarn Plug'n'Play has no `node_modules` directory; set
  `nodeLinker: node-modules` to use this extractor.

## Related

- [`api`](../renderers/api.md) — the renderer that displays the API diff.
- [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  — the compatibility comparator file, built on
  [the default comparator](../comparators/default.md).
- [`rust-public-api`](rust-public-api.md), [`go-public-api`](go-public-api.md),
  and [`dotnet-public-api`](dotnet-public-api.md) — the same API model for Rust,
  Go, and .NET.
- [`nestjs-di`](nestjs-di.md) — uses the same installed TypeScript compiler to
  inspect NestJS apps.

## How it works

See the
[package README](../../../packages/extractors/typescript-public-api/README.md)
for details on entry-point discovery and recorded fields, and
[TypeScript support](../../../packages/extractors/typescript-support/README.md)
for how the compiler is located.

## Build your own

Consider writing a custom extractor when the TypeScript checker's exports aren't
the surface you need:

- **Another API contract**, such as an OpenAPI spec, a GraphQL schema, CLI
  commands and flags, or emitted events.
- **Metadata the checker doesn't track**, like TSDoc release tags (`@beta`,
  `@internal`), deprecation notices, entry-point ownership, or per-export bundle
  size.
- **Coarser granularity**, emitting one entity per package or entry point rather
  than per declaration.

Check the built-in options first: `entrypoints` limits extraction to published
subpaths (skipping test helpers) and `tsconfig` selects the program. To
customize breaking-change rules, copy and edit
`api-compatibility.comparator.yaml` or write your own comparator file; to change
the presentation, keep this extractor and write a custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language. That creates the
definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, keep the `api` renderer:

```sh
projections init <id> --language node --renderer api
```

Any extractor that emits `api/v0` declarations with `data.signature` works with
the `api` renderer; emitting the same contract facts also unlocks
`api-compatibility` (use `options.ecosystem` to pick the rule set if the
extraction doesn't set `metadata.ecosystem`). Test changes as you go with
`projections show -p <id> --trust`. An open projection tab picks up your
uncommitted edits ("Your edits") and flags stale results, and the Testing view
runs your projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.
