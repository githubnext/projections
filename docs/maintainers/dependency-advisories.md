# Dependency advisories

`npm run check:advisories` checks the root `package-lock.json` and `Cargo.lock`
against [OSV](https://osv.dev), which covers GitHub advisories for npm and
RustSec advisories for Rust crates. The script sends only package names and
versions to `api.osv.dev` and never touches npm's audit endpoint. CI runs this
check nightly and on every push to `main` via the `advisories` job in
`.github/workflows/ci.yml`, while pull requests rely on dependency review (see
[Vulnerabilities in dependencies](../../CONTRIBUTING.md#vulnerabilities-in-dependencies)).
Fixture lockfiles are test data and aren't scanned.

When an advisory can't be fixed right away, allow it by ID (`--allow`) in the
`check:advisories` script and document it below with the rationale and exit
plan. Remove both the flag and the entry once the fix lands.

## Allowed

- [RUSTSEC-2020-0163](https://rustsec.org/advisories/RUSTSEC-2020-0163) flags
  `term_size` 0.3.2 as unmaintained (not a vulnerability). `tokei` 15.0.0 — the
  latest release, pinned exactly by `packages/extractors/code-statistics` —
  depends on it unconditionally. Only tokei's binary calls it to detect terminal
  width; the library code our extractor links never uses it. **Exit plan:** wait
  for a tokei release without it
  ([XAMPPRocky/tokei#1347](https://github.com/XAMPPRocky/tokei/pull/1347)
  switches to `terminal_size`). Don't fork tokei for this.
- [RUSTSEC-2026-0543](https://rustsec.org/advisories/RUSTSEC-2026-0543),
  [RUSTSEC-2026-0555](https://rustsec.org/advisories/RUSTSEC-2026-0555), and
  [RUSTSEC-2026-0559](https://rustsec.org/advisories/RUSTSEC-2026-0559) flag
  `chrono`, `chrono-tz`, and `chrono-tz-build` as unmaintained (not
  vulnerabilities). They are pulled in only by `tera` 1, a build dependency of
  `tokei` 15.0.0 whose default `builtins` feature includes date filters when
  tokei's build script renders its language table. Nothing compiled into the CLI
  links them (`cargo tree -i chrono -e normal --target all` prints nothing), and
  Cargo doesn't let us disable default features on a transitive build
  dependency. **Exit plan:** wait for a tokei release whose build script drops
  tera or disables its default features. Don't fork tokei for this.
- [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) is a
  ReDoS issue in `picomatch` through 4.0.7 involving single-branch repeated
  extglobs like `+(*)`. Because 4.0.7 is currently the latest release, no
  version bump or override fixes it yet. It is only used by dev build tooling
  (`vite`, `tsdown`, `tinyglobby`, `fdir`, and `@rollup/pluginutils`) against
  globs in our own config files rather than user input, and no published package
  depends on it. **Exit plan:** update once a picomatch release after 4.0.7
  ships, using `npm update picomatch` (adding a scoped override only if a
  dependant's range blocks that version).

## Overrides

The root `package.json` `overrides` block pins transitive dependencies to
patched versions when their direct dependants haven't widened their ranges yet.
Keep each override scoped to the specific dependant that needs it.

- `@joshwooding/vite-plugin-react-docgen-typescript` is pinned to `glob` 14
  (covering GHSA-3g3m-2fjr-6pw4, and transitively `minimatch` 11 for
  GHSA-g3hv-75wg-m249). `@storybook/react-vite` pulls in this plugin, whose
  latest release (0.7.0) still asks for `glob` 13. Storybook docgen is disabled
  (`typescript.reactDocgen` in `tools/storybook/.storybook/main.ts`), and the
  Storybook build passes with the override. Remove it once the plugin supports
  `glob` 14.
- `eslint`, `@eslint/config-array`, and `@typescript-eslint/typescript-estree`
  are pinned to `minimatch` 11 for GHSA-g3hv-75wg-m249.

Note that npm 11 doesn't always re-resolve an existing lockfile entry after you
edit an override. If `npm ls glob` still reports the old version, run
`npm update <dependant>` (here, the docgen plugin) and verify again.
