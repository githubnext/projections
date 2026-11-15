# Upstream license texts

Some crates compiled into the native CLI, the Engine and the rules interpreter don't include their license files in
the published crate package. These are the license files from their upstream repositories, at the released
versions, for the builds' `THIRD_PARTY_NOTICES.txt` ([`tools/scripts/crate-notices.mjs`](../tools/scripts/crate-notices.mjs)).

[`notices.json`](notices.json) records each directory's crates, the exact locked versions it covers, the upstream
repository and tag, and its files (with their upstream names where they differ). The table below is written from it
by `node tools/scripts/notices.mjs --write`:

<!-- generated: notices -->
<!-- prettier-ignore -->
| Directory | Crates | Files | Source | Notes |
|---|---|---|---|---|
| `cel/` | `cel` 0.15.0 | `LICENSE` | https://github.com/cel-rust/cel-rust at `v0.15.0` |  |
| `convert_case/` | `convert_case` 0.4.0 | `LICENSE` | https://github.com/rutrum/convert-case at `0.5.0` | A dependency of `verus_builtin_macros`. Its repository has no license file at `0.4.0`; this is the MIT text it added at `0.5.0`. |
| `verus_builtin_macros/` | `verus_builtin_macros` 0.0.0-2026-11-01-0251 | `LICENSE` | https://github.com/verus-lang/verus at `release/0.2026.11.02.8bf68ee` | Erases `packages/engine/verified`'s proofs at build time. Published from `9efe4d9` (merged as `a58c936`), first released in this tag; `LICENSE` is identical at all three. |
| `wasmi/` | `wasmi` 2.0.0<br>`wasmi_collections` 2.0.0<br>`wasmi_core` 2.0.0<br>`wasmi_ir` 2.0.0 | `LICENSE-APACHE`<br>`LICENSE-MIT` | https://github.com/wasmi-labs/wasmi at `v2.0.0` |  |
| `wasmparser/` | `wasmparser` 0.228.0 | `LICENSE-APACHE`<br>`LICENSE-Apache-2.0_WITH_LLVM-exception`<br>`LICENSE-MIT` | https://github.com/bytecodealliance/wasm-tools at `v1.228.0` |  |
| `yaml-rust2/` | `yaml-rust2` 0.13.0 | `LICENSE-APACHE` (upstream `Apache-LICENSE`)<br>`LICENSE-MIT` (upstream `MIT-LICENSE`) | https://github.com/Ethiraric/yaml-rust2 at `v0.13.0` |  |
<!-- end generated: notices -->

A build uses a crate's own license files when it ships them and only falls back to this directory otherwise. A crate
with neither, or at a version `notices.json` doesn't cover, fails the build. `npm run check:notices` (part of
`npm run check`) also fails when an entry covers a version no build needs it for, such as after an upgrade or once a
crate ships its own license files. To move a crate to a new version, fetch its license from the upstream repository at
the matching tag, update `notices.json` and run `node tools/scripts/notices.mjs --write`.
