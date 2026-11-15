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
