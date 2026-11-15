# Go public API

The exported API of a Go module's packages: every exported constant, variable,
function and type, with the method sets and selectable fields of its types, read
with `go/types` and the project's own Go toolchain. Compared across a pull
request, it answers "what did this change add, remove or change in what
importers can use, and does it break them?"

<!-- generated: facts -->

- ID: `go-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `go.mod`, `**/go.mod`

<!-- end generated: facts -->

## When to use it

Use it for Go modules other code imports, to review API changes as declarations
instead of a source diff: a method that moved from the value to the pointer
receiver, a struct that stopped being comparable, an interface that gained a
method. With the [`api-compatibility`](#classify-changes-as-breaking) comparator
file, each change is classified by the rules of the Go team's `apidiff`.

It needs `--trust` (see [What it reads](#what-it-reads)). Packages under
`internal/` and `main` packages can't be imported, so they aren't API and aren't
shown. For TypeScript use [`typescript-public-api`](typescript-public-api.md),
for Rust [`rust-public-api`](rust-public-api.md), for .NET
[`dotnet-public-api`](dotnet-public-api.md).

## What it reads

The packages `patterns` matches (default `./...`, from the repository root),
loaded the way the Go toolchain loads them:

- **The project's own Go**, 1.24 or newer, as `go` on `PATH` or `goPath`.
  `go list -export -compiled -deps` resolves the packages and builds export data
  for their dependencies, then the matched packages are type-checked from
  source. Running the toolchain over your module (including any cgo) is why it
  needs `--trust`.
- **A small helper** that ships with Projections as source and uses only the Go
  standard library, built with `go run` (or a prebuilt one at `goHelperPath`),
  so nothing is downloaded for it.
- **Your existing caches.** Go never downloads another toolchain
  (`GOTOOLCHAIN=local`), and it uses the module and build caches your own Go
  configuration reports. An extractor sees only the variables its definition
  grants, so list `HOME` (and any of `GOPATH`, `GOMODCACHE`, `GOCACHE` or
  `GOFLAGS` you set) in `execution.environment`. Without network access the
  module's dependencies must already be downloaded or vendored.

Each importable package is a `package` entity, and each exported name a
`constant`, `variable`, `function` or `type`, with a `method` for each exported
method in its method set and a `field` for each exported field a selector
reaches, promoted ones included. IDs use the import path
(`go:example.com/ledger.Ledger.Len`), so moving a declaration to another file of
the package is no change. Every declaration carries its contract (its type
without parameter names, a constant's exact value, a method's receiver,
comparability, numeric sizes), the facts the `api-compatibility` rules read.
Load and type errors fail the extraction rather than producing a partial API.

## Options

<!-- generated: inputs -->

| Input          | Meaning                                 |
| -------------- | --------------------------------------- |
| `goHelperPath` | Optional compatible helper executable.  |
| `goPath`       | Go executable.                          |
| `patterns`     | Go package patterns; default ["./..."]. |

<!-- end generated: inputs -->

## What a comparison shows

The [`api`](../renderers/api.md) renderer lists every declaration with its
signature, side by side or as one diff:

- **Declarations** added, removed or modified, each with its signature diff.
- **Renames** only when the definition's `correspondence` declares them;
  otherwise a renamed or moved declaration is a removal and an addition.

The summary bar counts declarations: `36 declarations +10 −1 ~6`.

### Classify changes as breaking

The default comparator says _that_ a declaration changed. The
`api-compatibility` comparator file, which ships with Projections, says whether
it breaks importers. It is a comparator file, not the default comparator: copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and name it in the definition:

```json
{
  "id": "api",
  "title": "Public API",
  "extractor": "go-public-api",
  "renderer": "api",
  "comparator": ".github/projections/api-compatibility.comparator.yaml",
  "execution": {"timeoutMs": 300000, "environment": ["HOME"]}
}
```

Each change is then `breaking`, `additive`, `compatible` or `unknown`, with a
reason and the rule that decided it, following `apidiff` and the Go 1
compatibility guarantee:

- **Breaking**: an exported name, method or field removed (`removed`), a name
  that now denotes another kind of object (`kind`), a changed type or constant
  value (`type`, `value`), a method added to an interface that outside packages
  can implement (`interface-method-added`), a method moved to the pointer method
  set (`method-set`), a struct no longer comparable (`comparable`), a type that
  stops implementing one of the package's exported interfaces (`implements`).
- **Additive**: a new exported name, method or field (`added`), a method added
  to an interface with an unexported method, a method that moved to the value
  method set.
- **Compatible**: a numeric type grown within its family, a channel that lost a
  direction, and a renamed parameter: parameter names aren't part of a Go type,
  so only the signature shown changes.

The summary bar then counts each level, breaking first
(`2 breaking changes · 5 additive changes`), each filtering to its changes; the
diff lists breaking changes first with each reason, and the renderer's
**Breaking only** control (`breakingOnly` in `presentation.rendererOptions`)
hides the rest. A workflow can fail a pull request on
`metadata.compatibility.counts.breaking`.
[API compatibility](../../models/api-compatibility.md#go-apidiffs-rules) lists
every rule.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "go-public-api",
  "id": "go-public-api",
  "renderer": "api",
  "title": "Go public API"
}
```

<!-- end generated: definition -->

## Limitations

- Build tags and the platform of the machine running it decide which files are
  in the program; declarations for other platforms aren't seen.
- The rules are `apidiff`'s, reproduced, not `apidiff` run on your module: a
  variable whose type changes to a renamed unexported type is reported as a type
  change, and packages renamed relative to the module root aren't matched.
- Each revision is loaded and type-checked, so the module's dependencies must
  resolve as your own `go build` would.

## Related

- [`api`](../renderers/api.md), the renderer that draws it.
- The
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  comparator file, and [the default comparator](../comparators/default.md) it
  builds on.
- [`typescript-public-api`](typescript-public-api.md),
  [`rust-public-api`](rust-public-api.md) and
  [`dotnet-public-api`](dotnet-public-api.md): the same model for other
  languages.

## How it works

The [package README](../../../packages/extractors/go-public-api/README.md)
details what each declaration records, and
[Go support](../../../packages/extractors/go-support/README.md) how the
toolchain and caches are used.

## Build your own

Write your own extractor when exported Go declarations aren't the surface you
need to review:

- **Another surface**: a gRPC service from its `.proto` files, HTTP routes
  registered on a router, a CLI's commands and flags (Cobra, `flag`), or the
  environment variables a service reads.
- **Facts the type checker doesn't have**: deprecation comments, which packages
  are covered by your stability promise, or owners from `CODEOWNERS`.
- **Another grain**: one entity per package, or packages and their imports as a
  graph.

Try the lighter options first: `patterns` limits the API to the packages you
publish. To change what counts as breaking (for a `v0` module, say), copy
`api-compatibility.comparator.yaml` and edit its rules; to draw the API
differently, keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language: the repository's
toolchain, Node.js, Python or Go (`extract.go`). It writes the definition and a
starter extractor under `.github/projections/<id>/`, drawn by the built-in graph
renderer. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, write it in Go and keep the `api` renderer:

```sh
projections init <id> --language go --renderer api
```

An extractor that writes `api/v0` declarations with a `data.signature` is drawn
by the `api` renderer. Run it with `projections show -p <id> --trust` as you
change it; an open projection tab uses your uncommitted edits ("Your edits") and
says when its results are out of date, and the Testing view runs the
projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
