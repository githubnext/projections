# Rust public API

The public API of a Rust library crate: every item reachable from the crate root
through public modules and re-exports, with its signature, read from rustdoc's
JSON output. Compared across a pull request, it answers "what did this change
add, remove or change in the crate's public API, and does it need a major
version?"

<!-- generated: facts -->

- ID: `rust-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `Cargo.toml`, `**/Cargo.toml`

<!-- end generated: facts -->

## When to use it

Use it for library crates, to review API changes as items and signatures instead
of a source diff: a public field added to a struct, a variant added to an enum,
a trait that gained a method, a type that stopped being `Send`. With the
[`api-compatibility`](#classify-changes-as-breaking) comparator file, each
change is classified by the rules of the
[Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html).

It needs a nightly toolchain and `--trust` (see
[What it reads](#what-it-reads)). It documents one library crate per projection;
binaries have no public API here. For TypeScript use
[`typescript-public-api`](typescript-public-api.md), for Go
[`go-public-api`](go-public-api.md), for .NET
[`dotnet-public-api`](dotnet-public-api.md); for the crates your workspace
depends on, [`cargo-dependencies`](cargo-dependencies.md).

## What it reads

It runs the project's own `cargo rustdoc --lib` on the manifest at
`manifestPath` (default `Cargo.toml`), for `package` in a workspace, with the
selected features, and reads the JSON documentation rustdoc writes:

- **A nightly toolchain.** rustdoc's JSON output is unstable, so `toolchain`
  names a rustup nightly, passed as `RUSTUP_TOOLCHAIN`. The starter definition
  says `nightly`; pin a date (`nightly-2026-09-17`) so every revision is read
  the same way. Projections never installs a toolchain: a stable one fails and
  says how to select a nightly.
- **One rustdoc JSON format.** It reads format 61 (rustdoc from
  nightly-2026-09-17); any other fails with the supported range rather than
  being misread.
- **`--trust`**, because building documentation compiles the crate's build
  scripts and procedural macros. rustup and Cargo find their toolchains and
  caches through `HOME` (or `RUSTUP_HOME` and `CARGO_HOME`); an extractor sees
  only the variables its definition grants, so list them in
  `execution.environment`, and raise `execution.timeoutMs` for a cold build.
- **Or a file.** `rustdocJson` reads a rustdoc JSON file at that path in each
  revision instead; nothing runs, and no trust is needed.

Each public item is an entity: `crate`, `module`, `struct`, `union`, `enum`,
`variant`, `field`, `trait` and its items, `function`, `method`, `constant`,
`static`, `type`, `macro`, `re-export`, and `impl` for trait implementations,
including the auto traits `Send`, `Sync`, `Unpin`, `UnwindSafe` and
`RefUnwindSafe`. IDs are public paths (`rust:throttle::Limiter::check`,
`rust:throttle::Limiter: Send`), so moving an item's definition while its public
path stays the same is no change, and a type losing `Send` is a removed
implementation. Blanket implementations and `#[doc(hidden)]` items are left out.
Every item carries its contract (`#[non_exhaustive]`, private fields, defaults,
`repr`, function qualifiers), the facts the `api-compatibility` rules read.

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

The [`api`](../renderers/api.md) renderer lists every item with its signature,
side by side or as one diff:

- **Items** added, removed or modified, each with its signature diff.
- **Renames** only when the definition's `correspondence` declares them;
  otherwise an item moved to another public path is a removal and an addition.

The summary bar counts declarations: `36 declarations +10 −1 ~6`.

### Classify changes as breaking

The default comparator says _that_ an item changed. The `api-compatibility`
comparator file, which ships with Projections, says whether it is a major, minor
or patch change. It is a comparator file, not the default comparator: copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and name it in the definition:

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

Each change is then `breaking`, `additive`, `compatible` or `unknown`, with a
reason and the SemVer reference's section as its rule:

- **Breaking**: a public item, field, variant or trait implementation removed
  (`item-remove`), a variant added to an exhaustive enum (`enum-variant-new`), a
  public field added to a struct with no private fields, `#[non_exhaustive]`
  added, an item without a default added to an unsealed trait
  (`trait-new-item-no-default`), a function's parameter count changed
  (`fn-change-arity`), a function made `unsafe`, a `repr` changed, a non-generic
  type changed (`type-changed`).
- **Additive**: a new public item (`item-new`), a trait item with a default.
- **Compatible**: a generic parameter added with a default, a function no longer
  `unsafe`, a parameter renamed (`parameter-renamed`: Rust has no named
  arguments).
- **Unknown**: type changes involving generics, changed bounds, and a constant's
  new value (it breaks only code that uses it in a type).

The summary bar then counts each level, breaking first
(`2 breaking changes · 5 additive changes`), each filtering to its changes; the
diff lists breaking changes first with each reason, and the renderer's
**Breaking only** control (`breakingOnly` in `presentation.rendererOptions`)
hides the rest. A workflow can fail a pull request on
`metadata.compatibility.counts.breaking`.
[API compatibility](../../models/api-compatibility.md#rust-the-cargo-semver-reference)
lists every rule.

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

- One crate, one feature set and the platform of the machine running it per
  projection; items behind other features or `cfg`s aren't seen.
- The rules are the SemVer reference's, reproduced over rustdoc's facts, not
  cargo-semver-checks run on your crate: generic bound changes and layout beyond
  `repr` are `unknown`, and Cargo features aren't compared.
- rustdoc's JSON format changes often; a toolchain that writes another format
  fails until Projections supports it, so pin the nightly.
- A full documentation build runs for each revision, so it is slower than the
  manifest-only extractors.

## Related

- [`api`](../renderers/api.md), the renderer that draws it.
- The
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  comparator file, and [the default comparator](../comparators/default.md) it
  builds on.
- [`typescript-public-api`](typescript-public-api.md),
  [`go-public-api`](go-public-api.md) and
  [`dotnet-public-api`](dotnet-public-api.md): the same model for other
  languages.
- [`cargo-dependencies`](cargo-dependencies.md), the crate's resolved
  dependencies.

## How it works

The [package README](../../../packages/extractors/rust-public-api/README.md)
details the rustdoc requirements and what each kind of item records.

## Build your own

Write your own extractor when rustdoc's public items aren't the surface you need
to review:

- **Another surface**: a C ABI exported with `#[no_mangle]` and `cbindgen`, a
  WebAssembly module's exports, a gRPC or OpenAPI contract generated from the
  crate, or a binary's command-line flags.
- **Facts rustdoc doesn't have**: which items are covered by your stability
  policy or behind an `unstable` feature, MSRV per item, or owners.
- **Another grain**: one entity per crate across a whole workspace.

Try the lighter options first: `package`, `features`, `allFeatures` and
`noDefaultFeatures` choose what is documented, and `rustdocJson` reads
documentation your CI already generates. To change what counts as breaking (for
a pre-1.0 policy, say), copy `api-compatibility.comparator.yaml` and edit its
rules; to draw the API differently, keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language: the repository's
toolchain, Node.js, Python or Go. It writes the definition and a starter
extractor under `.github/projections/<id>/`, drawn by the built-in graph
renderer. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, keep the `api` renderer:

```sh
projections init <id> --language node --renderer api
```

An extractor that writes `api/v0` declarations with a `data.signature` is drawn
by the `api` renderer. Run it with `projections show -p <id> --trust` as you
change it; an open projection tab uses your uncommitted edits ("Your edits") and
says when its results are out of date, and the Testing view runs the
projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
