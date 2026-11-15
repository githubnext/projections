---
description: "A Rust crate's public API, from rustdoc JSON (rust-public-api)"
---

# Rust public API — `rust-public-api`

The public API of one library crate, read from rustdoc's JSON output: every item
reachable from the crate root through public modules and re-exports, with its
signature and the contract facts the
[Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html)'s
rules inspect. The
[`api-compatibility` comparator](../../comparators/api-compatibility) classifies
changes from them; see
[API compatibility](../../../docs/models/api-compatibility.md#rust-the-cargo-semver-reference).

```json
{
  "extractor": "rust-public-api",
  "renderer": "api",
  "inputs": {"toolchain": "nightly-2026-09-17", "package": "throttle"},
  "comparator": ".github/projections/api-compatibility.comparator.yaml",
  "execution": {"timeoutMs": 300000, "environment": ["HOME", "RUSTUP_HOME", "CARGO_HOME"]}
}
```

| Input                                          | Meaning                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `manifestPath`                                 | `Cargo.toml` to document; default `Cargo.toml`                                   |
| `package`                                      | The package, in a workspace                                                      |
| `toolchain`                                    | The rustup toolchain, passed as `RUSTUP_TOOLCHAIN`: a nightly, preferably pinned |
| `features`, `allFeatures`, `noDefaultFeatures` | Cargo feature selection                                                          |
| `cargoPath`                                    | Cargo executable; default `cargo`                                                |
| `rustdocJson`                                  | A rustdoc JSON file generated elsewhere; nothing is run, and no trust is needed  |

## Requirements

- The project's own Cargo, with a **nightly** toolchain: rustdoc's JSON output
  (`cargo rustdoc -- -Z unstable-options --output-format json`) is still
  unstable. The extractor never installs a toolchain; on a stable one it fails
  and says how to select a nightly. Pin the nightly so every revision is
  extracted the same way.
- rustdoc JSON **format 61** (rustdoc from nightly-2026-09-17). The format
  changes often; another version fails with the supported range rather than
  being misread.
- `--trust`: `cargo rustdoc` compiles the crate's build scripts and procedural
  macros. Importing `rustdocJson` needs no trust.

## Model

Each item's `data.contract` holds the
[language-neutral contract facts](../../../docs/reference/schemas/api.md#contract):
its `declaration` and, as `term`, rustdoc's kind of item (`trait-method`,
`associated-const`, `type-alias`, …). The facts only the Rust rules read are in
`contract.native`.

<!-- prettier-ignore -->
| Entity kind | Items | Contract facts | `native` |
|---|---|---|---|
| `crate`, `module` | The crate root and public modules | — | — |
| `struct`, `union`, `enum` | Types | `nonExhaustive`, `hiddenMembers` (private fields, stripped variants), `typeParameters` | `shape`, `repr`, `where` |
| `variant`, `field` | Enum variants, public fields (named or `0`, `1`, … for tuples) | `nonExhaustive`, `hiddenMembers`, `value` (the discriminant); `type` | `shape` |
| `trait` and its `method`, `type`, `constant` items | Traits | `sealed` (a supertrait outside the public API), `supertypes` (supertraits), `typeParameters`; items' `abstract` (no default), associated types' `constraints` | `unsafe`, `dynCompatible`, `where` |
| `function`, `method` | Free functions and inherent methods | `signatures` (parameters, `returns`, `typeParameters`) | `const`, `async`, `unsafe`, `abi` (when not `Rust`), `where` |
| `constant`, `static`, `type` | Constants, statics, type aliases | `type`, `value`, `readonly` (not `static mut`), `typeParameters` | `where` |
| `impl` | Trait implementations, including the auto traits `Send`, `Sync`, `Unpin`, `UnwindSafe` and `RefUnwindSafe` | `type` (the implementing type), `supertypes` (the trait), `typeParameters` | `synthetic`, `where` |
| `macro`, `re-export` | Exported macros; a second path to an item, or an external re-export | `source` | — |

IDs are public paths: `rust:throttle::Limiter`, methods
`rust:throttle::Limiter::check`, fields `rust:throttle::Config.rate`, variants
`rust:throttle::Decision::Allow` and implementations
`rust:throttle::Limiter: Send`. Types are shown by their item's own name and
generic arguments, so how the source imports them doesn't matter. Blanket
implementations, compiler-internal marker traits and `#[doc(hidden)]` items are
excluded. The extraction declares `metadata.ecosystem: "rust"`.

`tests/fixtures/compatibility` holds a before and after crate whose every change
the native test classifies:

```sh
PROJECTIONS_NATIVE_RUST=1 PROJECTIONS_RUST_NIGHTLY=nightly-2026-09-17 \
  cargo test -p projections-cli --test native_tools native_rust
```

When cargo-semver-checks is installed, the same test runs it on the pair and
checks that every change it reports is breaking here too; Projections never
installs it.
