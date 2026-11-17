# Dependency advisories

`npm run check:advisories` checks the root `package-lock.json` and `Cargo.lock`
against [OSV](https://osv.dev), which carries GitHub's advisories for npm and
RustSec's for crates. It sends only package names and versions to `api.osv.dev`
and never calls npm's audit endpoint. CI runs it weekly and on `main` (the
`advisories` job in `.github/workflows/ci.yml`); pull requests rely on
dependency review (see
[Vulnerabilities in dependencies](../../CONTRIBUTING.md#vulnerabilities-in-dependencies)).
Fixture lockfiles are test data and aren't scanned.

An advisory that can't be fixed yet is allowed by ID (`--allow`) in the
`check:advisories` script and listed below with the reason and the way out.
Remove both once the way out lands.

## Allowed

- [RUSTSEC-2020-0163](https://rustsec.org/advisories/RUSTSEC-2020-0163):
  `term_size` 0.3.2 is unmaintained (not a vulnerability). `tokei` 15.0.0, the
  latest release, which `packages/extractors/code-statistics` pins exactly,
  depends on it unconditionally. Only tokei's binary calls it, for the terminal
  width; the library code the extractor links never does. Way out: a tokei
  release without it
  ([XAMPPRocky/tokei#1347](https://github.com/XAMPPRocky/tokei/pull/1347)
  replaces it with `terminal_size`). Don't fork tokei for this.
- [RUSTSEC-2026-0543](https://rustsec.org/advisories/RUSTSEC-2026-0543),
  [RUSTSEC-2026-0555](https://rustsec.org/advisories/RUSTSEC-2026-0555) and
  [RUSTSEC-2026-0559](https://rustsec.org/advisories/RUSTSEC-2026-0559):
  `chrono`, `chrono-tz` and `chrono-tz-build` are unmaintained (not
  vulnerabilities). They come only from `tera` 1, a build dependency of `tokei`
  15.0.0: tokei's build script renders its language table with tera, whose
  default `builtins` feature pulls in the date filters. Nothing built into the
  CLI links them (`cargo tree -i chrono -e normal --target all` prints nothing),
  and Cargo can't turn off a build dependency's default features from here. Way
  out: a tokei release whose build script uses tera without default features, or
  no tera. Don't fork tokei for this.
- [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf):
  ReDoS in `picomatch` through 4.0.7 for single-branch repeated extglobs such as
  `+(*)`. 4.0.7 is the latest release, so no version or override fixes it yet.
  Only build tooling uses it (`vite`, `tsdown`, `tinyglobby`, `fdir` and
  `@rollup/pluginutils`, all development dependencies), and they match globs
  written in this repository's own configuration, never user input; no published
  package depends on it. Way out: the first picomatch release after 4.0.7 that
  fixes it, picked up with `npm update picomatch` (add an override scoped to a
  dependant only if its range doesn't allow that release).

## Overrides

The root `package.json` `overrides` move transitive dependencies to patched
versions that their dependants don't allow yet. Each is scoped to the one
dependant that needs it.

- `@joshwooding/vite-plugin-react-docgen-typescript` gets `glob` 14
  (GHSA-3g3m-2fjr-6pw4, and through it `minimatch` 11 for GHSA-g3hv-75wg-m249).
  `@storybook/react-vite` requires the plugin, whose latest release (0.7.0)
  still asks for `glob` 13. Storybook's docgen is off (`typescript.reactDocgen`
  in `tools/storybook/.storybook/main.ts`), and the Storybook build passes with
  the override. Remove it once the plugin allows `glob` 14.
- `eslint`, `@eslint/config-array` and `@typescript-eslint/typescript-estree`
  get `minimatch` 11 for GHSA-g3hv-75wg-m249.

npm 11 doesn't always re-resolve an existing lock entry when an override
changes. If `npm ls glob` still shows the old version, run
`npm update <dependant>` (here the docgen plugin) and check again.
