# TypeScript public API

What consumers of your TypeScript packages can import: every export of each
package entry point, with its members and its signature as the repository's own
TypeScript checker prints it. Compared across a pull request, it answers "what
did this change add, remove or change in the public API, and does it break the
people who use it?"

<!-- generated: facts -->

- ID: `typescript-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `tsconfig.json`, `**/tsconfig.json`

<!-- end generated: facts -->

## When to use it

Use it for libraries and shared packages: anything published to npm or imported
by other packages in a monorepo, where a changed signature matters more than the
source diff that caused it. Moving code between files, renaming private helpers
or rewriting a function body changes nothing here; adding a required parameter,
narrowing an accepted type or removing an export does. With the
[`api-compatibility`](#classify-changes-as-breaking) comparator file, each
change is also classified as breaking, additive or compatible.

It runs without `--trust`: it loads the TypeScript compiler installed in your
checkout and type-checks your sources, but never imports your code, runs a build
or evaluates configuration scripts.

It reads what can be imported, so an application with no exported API has little
to show. For other languages use [`rust-public-api`](rust-public-api.md),
[`go-public-api`](go-public-api.md) or
[`dotnet-public-api`](dotnet-public-api.md).

## What it reads

- **Entry points.** `inputs.entrypoints` when set: an array of source files
  (exported together as the package's `.`), or an object mapping public subpaths
  to source files (`{".": "src/index.ts", "./testing": "src/testing.ts"}`).
  Otherwise each package's `package.json` `exports`, with its subpaths,
  conditions (`types` first) and wildcards, or `types` and `typings` when there
  is no `exports`. A target that doesn't exist, such as an unbuilt
  `dist/index.d.ts`, is never guessed to mean `src/index.ts`: set `entrypoints`
  instead.
- **The program.** `inputs.tsconfig` (or `inputs.tsconfigs`, a list), else a
  root `tsconfig.json`, else a strict default program over every source file.
  Project references are followed but not built.
- **The compiler.** The repository's own `typescript` package, 5.x or 6.x (a
  TypeScript 7 project also installs `@typescript/typescript6`), found in
  `node_modules` from the tsconfig's directory up to the checkout root, and
  Node.js 20 or newer on `PATH`. Projections bundles no compiler: run your
  package manager's install (`npm ci`) first. Installed packages' declarations
  are read from the checkout; workspace sources always come from the revision
  being extracted.

Each export is an `export` entity, or a `type` for interfaces and type aliases,
with a `member` for each public or protected instance and static member,
constructor, and index, call or construct signature. Overloads keep the
checker's order. Private members, `#private` fields and implementation bodies
are left out; a class that has private members is marked as compared nominally,
without revealing them. IDs are the package name, the public subpath and the
exported name, so moving a declaration to another file is no change, and
renaming an export is one removal and one addition.

Every declaration also carries its contract (parameters and return types as
union constituents, modifiers, heritage clauses), the facts the
`api-compatibility` rules read. A compiler error fails the extraction rather
than publishing an `any` signature.

## Options

<!-- generated: inputs -->

| Input         | Meaning                                           |
| ------------- | ------------------------------------------------- |
| `entrypoints` | Source paths or export subpath-to-source map.     |
| `tsconfig`    | tsconfig.json path.                               |
| `tsconfigs`   | Several tsconfig.json paths, instead of tsconfig. |

<!-- end generated: inputs -->

## What a comparison shows

The [`api`](../renderers/api.md) renderer lists every declaration with its
signature, side by side or as one diff:

- **Declarations** added, removed or modified, each with its signature diff:
  removed runs struck out, added runs underlined.
- **Renames** only when the definition's `correspondence` declares them;
  otherwise a renamed export is a removal and an addition.

The summary bar counts declarations: `25 declarations +7 −1 ~8`.

### Classify changes as breaking

The default comparator says _that_ a declaration changed. The
`api-compatibility` comparator file, which ships with Projections, says what the
change means for consumers. It is a comparator file, not the default comparator:
copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and name it in the definition:

```json
{
  "id": "api",
  "title": "Public API",
  "extractor": "typescript-public-api",
  "renderer": "api",
  "comparator": ".github/projections/api-compatibility.comparator.yaml"
}
```

Each change is then `breaking`, `additive`, `compatible` or `unknown`, with a
reason and the rule that decided it. TypeScript has no official breaking-change
standard, so the rules decide assignability over the types the checker resolved:

- **Breaking**: a parameter became required (`required-parameter-added`) or was
  removed (`parameter-removed`), a parameter accepts less
  (`parameter-narrowed`), a return type is wider (`return-widened`), a required
  member was added to an interface (`member-added`), a property became required,
  optional or `readonly`, a type alias accepts less.
- **Additive**: an optional parameter was added (`parameter-added`), a required
  parameter became optional (`parameter-optional`), a parameter accepts more, a
  type alias accepts more, an optional member was added.
- **Compatible**: a parameter was renamed (`parameter-renamed`: arguments are
  passed by position), a return type is narrower (`return-narrowed`).
- **Unknown**: anything that needs structural comparison of two object types,
  generics, or conditional or mapped types.

The summary bar then counts each level, breaking first
(`6 breaking changes · 9 additive changes · 1 compatible change`), each
filtering to its changes; the diff lists breaking changes first, each row states
its level and reason, and the renderer's **Breaking only** control
(`breakingOnly` in `presentation.rendererOptions`) hides the rest. The counts
are in the comparison's `metadata.compatibility`, so a workflow can fail a pull
request that breaks the API:

```sh
projections compare main...HEAD -p api --json > api.comparison.json
jq -e '.comparison.metadata.compatibility.counts.breaking == 0' api.comparison.json
```

[API compatibility](../../models/api-compatibility.md#typescript-assignability-over-the-checkers-types)
lists every rule.

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

- It reads the checker's static view of the exports, not exports created at run
  time, and it is not a declaration emitter: what it shows is what the checker
  sees through your `tsconfig`.
- The compatibility rules can't compare two different object types, generic
  instantiations, or conditional, mapped and template literal types; those
  changes are `unknown`. Overloads are matched pairwise by position.
- Both revisions of a comparison use the one installed compiler, so upgrading
  TypeScript in the pull request doesn't add noise; comparing extractions saved
  with different compiler versions can, because each version prints some types
  differently.
- Project references aren't built: generated declarations that don't exist yet
  need source path mappings or explicit `entrypoints`.
- Conflicting definitions of one export under different conditions fail rather
  than picking one; give them distinct subpaths.
- Yarn Plug'n'Play has no `node_modules`; use `nodeLinker: node-modules`.

## Related

- [`api`](../renderers/api.md), the renderer that draws it.
- The
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  comparator file, and [the default comparator](../comparators/default.md) it
  builds on.
- [`rust-public-api`](rust-public-api.md), [`go-public-api`](go-public-api.md)
  and [`dotnet-public-api`](dotnet-public-api.md): the same model for Rust, Go
  and .NET.
- [`nestjs-di`](nestjs-di.md), which uses the same installed TypeScript to load
  a NestJS application.

## How it works

The
[package README](../../../packages/extractors/typescript-public-api/README.md)
details entry-point discovery and what is recorded, and
[TypeScript support](../../../packages/extractors/typescript-support/README.md)
how the compiler is found.

## Build your own

Write your own extractor when the API you care about isn't what the checker
exports:

- **Another kind of API**: an HTTP API described by OpenAPI, a GraphQL schema,
  your CLI's commands and flags, or the events a package emits.
- **Facts the checker doesn't have**: release tags from TSDoc (`@beta`,
  `@internal`), deprecations, the team that owns each entry point, or bundle
  size per export.
- **Another grain**: one entity per package or entry point instead of per
  declaration.

Try the lighter options first: `entrypoints` limits the API to the subpaths you
publish (leaving out test helpers), and `tsconfig` picks the program. To change
what counts as breaking, copy `api-compatibility.comparator.yaml` and edit its
rules, or write your own comparator file; to draw the API differently, keep this
extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep the `api` renderer:

```sh
projections init <id> --language node --renderer api
```

An extractor that writes `api/v0` declarations with a `data.signature` is drawn
by the `api` renderer; one that also writes the same contract facts can use
`api-compatibility` (its `options.ecosystem` names the rules when the extraction
doesn't declare `metadata.ecosystem`). Run it with
`projections show -p <id> --trust` as you change it; an open projection tab uses
your uncommitted edits ("Your edits") and says when its results are out of date,
and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
