# Rust public API

This extractor captures the public API of a Rust library crate—every item
reachable from the crate root through public modules and re-exports, along with
its signature—by reading rustdoc's JSON output. Compared across a pull request,
it answers a practical question: what did this change add, remove, or alter in
the public API, and does it require a major version bump?

<!-- generated: facts -->

- ID: `rust-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `Cargo.toml`, `**/Cargo.toml`

<!-- end generated: facts -->

## When to use it

Use this extractor for Rust library crates when you want to review API changes
as items and signatures instead of scanning raw source diffs—like a new public
field on a struct, a new enum variant, a trait gaining a method, or a type
losing `Send`. Pair it with the
[`api-compatibility`](#classify-changes-as-breaking) comparator file to classify
each change according to the
[Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html).

Because it runs rustdoc, it requires a nightly toolchain and `--trust` (see
[What it reads](#what-it-reads)). Each projection documents a single library
crate; binaries have no public API here. For other languages, see
[`typescript-public-api`](typescript-public-api.md),
[`go-public-api`](go-public-api.md), or
[`dotnet-public-api`](dotnet-public-api.md). To inspect the crates your
workspace depends on instead, use [`cargo-dependencies`](cargo-dependencies.md).

## What it reads

By default, the extractor runs the project's `cargo rustdoc --lib` against the
manifest at `manifestPath` (defaulting to `Cargo.toml`, and targeting `package`
in a workspace) with your chosen features, then parses the JSON documentation
rustdoc emits:

- **A nightly toolchain.** Because rustdoc's JSON format is unstable,
  `toolchain` specifies a rustup nightly passed via `RUSTUP_TOOLCHAIN`. The
  starter definition uses `nightly`, though pinning a date like
  `nightly-2026-09-17` ensures every revision is parsed consistently.
  Projections never installs toolchains for you—pointing it at a stable
  toolchain fails with instructions for picking a nightly.
- **Format 61 only.** It reads rustdoc JSON format 61 (from nightly-2026-09-17)
  and fails with the supported range on other versions rather than misreading
  them.
- **`--trust` and environment setup.** Generating docs compiles build scripts
  and proc macros, so `--trust` is required. Because extractors only see
  environment variables explicitly allowed by the definition, pass `HOME` (or
  `RUSTUP_HOME` and `CARGO_HOME`) in `execution.environment` so rustup and Cargo
  can find toolchains and caches, and bump `execution.timeoutMs` if cold builds
  need more time.
- **Pre-generated JSON.** If you set `rustdocJson`, the extractor reads that
  file from each revision instead—nothing executes and no trust is required.

Every public item becomes an entity: `crate`, `module`, `struct`, `union`,
`enum`, `variant`, `field`, `trait` (and its associated items), `function`,
`method`, `constant`, `static`, `type`, `macro`, `re-export`, and `impl` for
trait implementations—including auto traits (`Send`, `Sync`, `Unpin`,
`UnwindSafe`, and `RefUnwindSafe`).

IDs use public paths (`rust:throttle::Limiter::check`,
`rust:throttle::Limiter: Send`), so moving a definition between files without
changing its public path produces no diff, while a type losing `Send` appears as
a removed implementation. Blanket implementations and `#[doc(hidden)]` items are
excluded. Each item also stores contract metadata (`#[non_exhaustive]`, private
fields, defaults, `repr`, function qualifiers) used by the `api-compatibility`
rules.

## Options

<!-- generated: inputs -->

| Input               | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `allFeatures`       | Enable every feature.                                          |
| `cargoPath`         | Cargo executable.                                              |
| `features`          | Features to enable.                                            |
| `manifestPath`      | Cargo.toml path; default Cargo.toml.                           |
| `noDefaultFeatures` | Disable default features.                                      |
| `package`           | Package to document in a workspace.                            |
| `rustdocJson`       | Pre-generated rustdoc JSON file; otherwise runs cargo rustdoc. |
| `toolchain`         | rustup toolchain with rustdoc JSON, such as a pinned nightly.  |

<!-- end generated: inputs -->

## What a comparison shows

The [`api`](../renderers/api.md) renderer displays every item and its signature
either side by side or as a unified diff:

- **Added, removed, or modified items**, each with an inline signature diff.
- **Renames**, when declared in the definition's `correspondence` (otherwise,
  moving an item to a different public path shows up as a removal and an
  addition).

The summary bar tallies declarations and deltas (`36 declarations +10 −1 ~6`).

### Classify changes as breaking

The default comparator tells you _that_ an item changed. To see whether a change
is major, minor, or patch, use the `api-compatibility` comparator file that
ships with Projections. Copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and reference it in your projection definition:

```json
{
  "id": "api",
  "title": "Public API",
  "extractor": "rust-public-api",
  "renderer": "api",
  "inputs": {"toolchain": "nightly-2026-09-17"},
  "comparator": ".github/projections/api-compatibility.comparator.yaml"
}
```

With that comparator enabled, every change is classified as `breaking`,
`additive`, `compatible`, or `unknown`, complete with a reason and the matching
SemVer reference rule:

- **Breaking** — removing a public item, field, variant, or trait implementation
  (`item-remove`); adding a variant to an exhaustive enum (`enum-variant-new`);
  adding a public field to a struct with no private fields; adding
  `#[non_exhaustive]`; adding a required item without a default to an unsealed
  trait (`trait-new-item-no-default`); changing a function's parameter count
  (`fn-change-arity`); making a function `unsafe`; changing a `repr`; or
  changing a non-generic type (`type-changed`).
- **Additive** — adding a new public item (`item-new`) or adding a trait item
  with a default implementation.
- **Compatible** — adding a generic parameter with a default, removing `unsafe`
  from a function, or renaming a parameter (`parameter-renamed`, since Rust has
  no named arguments).
- **Unknown** — type changes involving generics, altered trait bounds, or a
  changed constant value (which only breaks callers using it in type position).

The summary bar then groups counts by severity, breaking changes first
(`2 breaking changes · 5 additive changes`), with each count acting as a filter.
The diff puts breaking changes at the top with their reasons, and you can hide
everything else with the **Breaking only** control (`breakingOnly` in
`presentation.rendererOptions`). CI workflows can also fail a pull request based
on `metadata.compatibility.counts.breaking`. See
[API compatibility](../../models/api-compatibility.md#rust-the-cargo-semver-reference)
for the complete rule list.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "rust-public-api",
  "id": "rust-public-api",
  "inputs": {
    "toolchain": "nightly"
  },
  "renderer": "api",
  "title": "Rust public API"
}
```

<!-- end generated: definition -->

## Limitations

- Each projection covers one crate, one feature set, and the host machine's
  target platform; items behind other features or `cfg` flags aren't included.
- Compatibility checks reproduce the Cargo SemVer reference rules over rustdoc's
  output rather than running cargo-semver-checks directly, so generic bound
  changes and layout details beyond `repr` come back as `unknown`, and Cargo
  features aren't compared.
- Because rustdoc's JSON format evolves frequently, a newer or older toolchain
  will fail until Projections adds support—pin your nightly version to avoid
  surprises.
- Every revision runs a full documentation build, making this slower than
  manifest-only extractors.

## Related

- [`api`](../renderers/api.md) — the renderer that displays the API diff.
- [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  — the compatibility comparator file, built on
  [the default comparator](../comparators/default.md).
- [`typescript-public-api`](typescript-public-api.md),
  [`go-public-api`](go-public-api.md), and
  [`dotnet-public-api`](dotnet-public-api.md) — the same API model for other
  languages.
- [`cargo-dependencies`](cargo-dependencies.md) — your crate's resolved
  dependencies.

## How it works

See the [package README](../../../packages/extractors/rust-public-api/README.md)
for details on rustdoc requirements and what each item kind records.

## Build your own

Consider writing a custom extractor when rustdoc's public items aren't the
surface you need to track:

- **A different API surface**, such as a C ABI exported with `#[no_mangle]` and
  `cbindgen`, WebAssembly exports, a generated gRPC or OpenAPI contract, or a
  binary's CLI flags.
- **Metadata rustdoc doesn't capture**, like stability tiers, items behind an
  `unstable` feature, per-item MSRV, or code owners.
- **Workspace-wide granularity**, emitting one entity per crate across a whole
  workspace.

Before writing one from scratch, check the built-in options: `package`,
`features`, `allFeatures`, and `noDefaultFeatures` control what gets documented,
and `rustdocJson` lets you reuse JSON your CI already builds. If you want
different breaking-change rules (for instance, a pre-1.0 policy), copy and edit
`api-compatibility.comparator.yaml`; to visualize the API differently, keep this
extractor and write a custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language (your repository's
toolchain, Node.js, Python, or Go). That creates the definition and a starter
extractor under `.github/projections/<id>/` paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, keep the `api` renderer:

```sh
projections init <id> --language node --renderer api
```

Any extractor that emits `api/v0` declarations with a `data.signature` works
with the `api` renderer. Test changes as you go with
`projections show -p <id> --trust`. An open projection tab uses your uncommitted
edits ("Your edits") and flags stale results, and the Testing view runs your
projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.
