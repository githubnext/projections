# Go public API

This extractor captures the exported API of a Go module's packages—every
exported constant, variable, function, and type, along with each type's method
set and selectable fields—using `go/types` and the repository's own Go
toolchain. Compared across a pull request, it shows what changed for downstream
importers and whether any change breaks compatibility.

<!-- generated: facts -->

- ID: `go-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `go.mod`, `**/go.mod`

<!-- end generated: facts -->

## When to use it

Use this extractor for Go modules imported by other code when you want to review
API changes as clean declarations instead of a source diff. It makes subtle
breaks easy to spot—a method shifting from a value receiver to a pointer
receiver, a struct losing comparability, or an interface gaining a new method.
Pairing it with the [`api-compatibility`](#classify-changes-as-breaking)
comparator file classifies each change using the Go team's `apidiff` rules.

Extraction requires `--trust` (see [What it reads](#what-it-reads)). Packages
under `internal/` and `main` packages cannot be imported, so they are excluded
from the public API. For TypeScript use
[`typescript-public-api`](typescript-public-api.md), for Rust use
[`rust-public-api`](rust-public-api.md), and for .NET use
[`dotnet-public-api`](dotnet-public-api.md).

## What it reads

The extractor inspects every package matched by `patterns` (default `./...` from
the repository root), loading them the same way the Go toolchain does:

- **The project's own Go toolchain** (1.24 or newer, found as `go` on `PATH` or
  configured via `goPath`). It runs `go list -export -compiled -deps` to resolve
  packages and build export data for dependencies, then type-checks the matched
  packages from source. Running the toolchain over your module (including any
  cgo) is why `--trust` is required.
- **A small standard-library helper** shipped as source with Projections and
  executed with `go run` (or a prebuilt binary at `goHelperPath`), so nothing
  needs to be downloaded to run it.
- **Your existing caches.** Go never downloads another toolchain
  (`GOTOOLCHAIN=local`) and uses the module and build caches configured in your
  Go environment. Because extractors only see environment variables you grant,
  include `HOME` (plus any custom `GOPATH`, `GOMODCACHE`, `GOCACHE`, or
  `GOFLAGS`) in `execution.environment`. In offline environments, module
  dependencies must already be cached or vendored.

Each importable package becomes a `package` entity, and each exported symbol
becomes a `constant`, `variable`, `function`, or `type`, with `method` entities
for exported methods in its method set and `field` entities for exported
selectable fields (including promoted ones). IDs use the import path
(`go:example.com/ledger.Ledger.Len`), so moving a declaration between files in
the same package produces no diff. Every declaration records its full contract
(type without parameter names, exact constant value, method receiver,
comparability, and numeric sizes) so the `api-compatibility` rules can evaluate
it. Load or type-checking errors fail the extraction rather than emitting a
partial API.

## Options

<!-- generated: inputs -->

| Input          | Meaning                                 |
| -------------- | --------------------------------------- |
| `goHelperPath` | Optional compatible helper executable.  |
| `goPath`       | Go executable.                          |
| `patterns`     | Go package patterns; default ["./..."]. |

<!-- end generated: inputs -->

## What a comparison shows

The [`api`](../renderers/api.md) renderer displays every declaration with its
signature, either side by side or in a unified diff:

- **Added, removed, or modified declarations** appear with inline signature
  diffs.
- **Renames** are shown only when declared in `correspondence` in your
  definition; otherwise a renamed or moved symbol appears as a removal and an
  addition.

The summary bar tallies declarations and deltas (for example,
`36 declarations +10 −1 ~6`).

### Classify changes as breaking

By default, the comparator only reports _that_ a declaration changed. To see
whether a change breaks importers, use the `api-compatibility` comparator file
shipped with Projections. Copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and reference it in your definition:

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

Each change is then classified as `breaking`, `additive`, `compatible`, or
`unknown`, paired with a reason and the rule that triggered it, following
`apidiff` and the Go 1 compatibility guarantee:

- **Breaking** covers removed exported names, methods, or fields (`removed`), a
  symbol changing kind (`kind`), type or constant value changes (`type`,
  `value`), adding a method to an interface that external packages can implement
  (`interface-method-added`), moving a method to the pointer method set
  (`method-set`), making a struct non-comparable (`comparable`), or a type
  stopping implementation of an exported interface from the package
  (`implements`).
- **Additive** covers new exported names, methods, or fields (`added`), adding a
  method to an interface that already has an unexported method, or moving a
  method to the value method set.
- **Compatible** covers widening a numeric type within its family, dropping a
  channel direction, or renaming a parameter (parameter names are not part of a
  Go type, so only the displayed signature changes).

The summary bar groups counts by severity with breaking changes first
(`2 breaking changes · 5 additive changes`), and clicking any count filters to
those changes. Breaking changes appear at the top of the diff with their
reasons, and the **Breaking only** toggle (`breakingOnly` in
`presentation.rendererOptions`) hides the rest. CI workflows can fail a pull
request on `metadata.compatibility.counts.breaking`. See
[API compatibility](../../models/api-compatibility.md#go-apidiffs-rules) for the
full rule list.

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

- Build tags and the host platform determine which files are included;
  declarations gated for other platforms are not inspected.
- Compatibility checks reproduce `apidiff`'s rules rather than running `apidiff`
  directly on your module: changing a variable's type to a renamed unexported
  type is reported as a type change, and packages moved relative to the module
  root are not matched automatically.
- Because every revision is loaded and type-checked, module dependencies must
  resolve the same way `go build` requires.

## Related

- [`api`](../renderers/api.md) is the renderer that displays these declarations.
- The
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  comparator file builds on [the default comparator](../comparators/default.md)
  to classify breaking changes.
- [`typescript-public-api`](typescript-public-api.md),
  [`rust-public-api`](rust-public-api.md), and
  [`dotnet-public-api`](dotnet-public-api.md) provide the same model for other
  languages.

## How it works

See the [package README](../../../packages/extractors/go-public-api/README.md)
for what each declaration records, and
[Go support](../../../packages/extractors/go-support/README.md) for how the
toolchain and caches are handled.

## Build your own

Consider writing a custom extractor when exported Go declarations are not the
surface you need to review:

- **Another surface**, such as gRPC services from `.proto` files, HTTP routes
  registered on a router, CLI commands and flags (Cobra or `flag`), or
  environment variables a service reads.
- **Facts the type checker does not track**, like deprecation comments, which
  packages carry a stability guarantee, or owners from `CODEOWNERS`.
- **A different level of detail**, such as one entity per package or a package
  import graph.

Try the lighter options first: `patterns` scopes the API to the packages you
publish. To adjust what counts as breaking (for example, in a `v0` module), copy
`api-compatibility.comparator.yaml` and edit its rules. To change the visual
layout, keep this extractor and write a custom renderer.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language—your
repository's toolchain, Node.js, Python, or Go (`extract.go`)—to scaffold the
definition and a starter extractor under `.github/projections/<id>/`, paired
with the built-in graph renderer. You can also choose **Ask an agent to write
it** and describe what you want to see.

**With the CLI**, scaffold a Go extractor while keeping the `api` renderer:

```sh
projections init <id> --language go --renderer api
```

Any extractor that emits `api/v0` declarations with a `data.signature` works
with the `api` renderer. Run `projections show -p <id> --trust` while you
iterate—an open projection tab picks up your uncommitted edits ("Your edits")
and flags stale results, and the Testing view runs your projection's checks.
Walk through [Write your first extractor](../../guides/first-extractor.md) to
get started, and check
[Extraction schema](../../guides/schemas.md#extraction-schema) for the output
format.
