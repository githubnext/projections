---
description: The Node helper the TypeScript extractors run
---

# TypeScript support

This package builds the **Node extractor helper**: one self-contained file,
`dist/extractor.mjs`, that the CLI distribution ships at
`collectors/helpers/node/extractor.mjs`. The native CLI runs it for
`typescript-public-api` and `nestjs-di`. Every other built-in extractor is
native Rust. The package is private and is never installed by users. Its Rust
crate, `projections-extractor-typescript-support` (`src/lib.rs`), runs the
helper for those extractors with the [extractor SDK](../sdk/README.md): it
passes the extractor request on stdin and the working checkout, where the
project's own `typescript` is installed, as an argument.

## Runtime requirements

`typescript-public-api` examines Node projects, so it uses **the project's own
toolchain** and nothing else:

- **Node.js 20 or newer**, as `node` on the PATH the CLI passes to tools. An
  older Node.js fails with an explicit error.
- **The repository's own `typescript` package**, TypeScript 5.x or 6.x. A
  TypeScript 7 project, whose `typescript` package is the native compiler
  without the JavaScript compiler API, also installs `@typescript/typescript6`
  (the TypeScript 6 API package published for this purpose); the helper uses it
  when `typescript` is 7 or newer. So does a project that has only the native
  compiler's preview package (`@typescript/native-preview`, `tsgo`) and no
  `typescript`.

The helper imports only Node.js built-ins. Projections bundles no compiler and
no npm packages, never installs dependencies, and never falls back to an
approximation: a missing or unsupported installation fails the extraction with
an explicit error, for example

```text
typescript-public-api uses the TypeScript 5.x or 6.x compiler API from the repository's own
installation, resolved from . in the repository checkout. No `typescript` package is installed
there. Run your package manager's install (for example `npm ci`), or, if the project doesn't
depend on TypeScript, add it: `npm install --save-dev typescript@6`. Projections does not
bundle a TypeScript compiler.
```

The suggested command uses the package manager whose lockfile the checkout has
(`pnpm add --save-dev --workspace-root`, `yarn add --dev`, `bun add --dev` or
`npm install --save-dev`). With only `@typescript/native-preview` installed, it
names `@typescript/typescript6` instead. The check runs before any source is
read, so it fails at once.

Run your package manager's install before Projections, as the project's own
build does.

### Where packages are resolved

The CLI materializes each revision without ignored files, so `node_modules` is
never part of an extraction root. Packages are resolved from the **repository's
working checkout** instead (the one the CLI runs in, or `-C`), and the same
installation examines every compared revision, exactly as an ecosystem toolchain
on `PATH` does for other extractors:

- TypeScript is looked up in `node_modules` directories from the directory of
  `inputs.tsconfig` (or the first `inputs.tsconfigs` entry) up to the checkout
  root, so a workspace package with its own compiler uses it; otherwise from the
  checkout root.
- Lookup never leaves the checkout: global and ancestor installations are not
  used, and a linked installation whose real path is outside the checkout is
  rejected. Workspace links inside the checkout (pnpm's store) work. Yarn
  Plug'n'Play has no `node_modules`; use `nodeLinker: node-modules`.

### Version behavior

The extractor uses stable compiler and checker APIs available since TypeScript
5.0. Signatures are printed by the project's own checker, so different compiler
versions can print the same declaration differently (for example a new
TypeScript release may change how it prints a type). Comparisons use one
installation for both revisions, so upgrading TypeScript between two compared
commits does not create spurious changes; upgrading the installed compiler
between separately saved extractions can. Output is identical across 5.0, 5.4,
5.9, 6.0 and TypeScript 7 with `@typescript/typescript6` for the qualification
fixture.

`nestjs-di` additionally uses the repository's own **`@nestjs/core`** (9.3 or
newer), resolved the same way, and loads the application with it; see
[NestJS](../nestjs-di/README.md).

## Extractors

The helper reads one extractor request on stdin and writes one state on stdout:

```sh
node extractor.mjs <extractor> <absolute repository checkout> < request.json
```

`typescript-public-api` uses real TypeScript programs and checker symbols. It
does not import repository JavaScript, evaluate configuration scripts, run
builds, install dependencies, or need trust/network capabilities. It writes
`api/v0`: `export`, `type` and `member` entities with `data.signature`, and
`contains` relationships. Repository-relative evidence contains source
locations; absolute source paths and line numbers are not semantic data. Exports
are checker-authoritative, not a claim about arbitrary runtime-generated
exports.

`nestjs-di` composes the application's root module with its own NestJS in
preview mode, so it requires trust: application sources are transpiled with the
repository's `typescript` as they load, and their packages resolve from the
repository checkout only (never above it). It writes the shared
[dependency-injection model](../../../docs/models/dependency-injection-model.md);
see [NestJS](../nestjs-di/README.md).

The former convention extractors (feature flags, HTTP routes, message handlers,
Redux slices) are now
[custom extractor samples](../../../examples/extractors/README.md).

## Shared input contract

Put these fields in the projection's `inputs` object:

- `tsconfig`: repository-relative filename of one JSON/JSONC tsconfig.
- `tsconfigs`: nonempty array of tsconfig filenames; mutually exclusive with
  `tsconfig`. Project references are traversed. A source is analyzed once when
  overlapping programs contain it (the first program wins).
- `entrypoints`: nonempty array of repository-relative filenames, or an object
  mapping public subpaths to filenames. An array combines exports under `"."`
  within each owning package. Object keys preserve separate subpath identities.
  Without a tsconfig these files become program roots and their imports are
  followed. With a tsconfig an API entrypoint must belong to that program.
- Syntax, options, global and semantic compiler errors always fail the
  extraction with relative filenames, line numbers and TS diagnostic codes:
  unresolved dependencies must never be published as success-shaped `any`
  signatures.

Without explicit configs, a tracked root `tsconfig.json` is selected if present.
Otherwise the extractor creates an ES2022/ESNext/Bundler program with strict
checking, `allowJs`, `skipLibCheck`, no implicit ambient `@types` packages, and
all listed TS/JS source files as roots. TS configs may opt into ambient types.
Installed declarations, imports and extended configs are discovered as needed
within the extraction root. Missing dependencies are not installed
automatically.

**Types of installed dependencies come from the checkout.** The CLI's
materialized revisions omit ignored files, so where the examined revision has no
`node_modules`, the compiler reads that `node_modules` path from the repository
checkout instead (`repository.checkout`, the same installation that supplies the
compiler), as `nestjs-di` does. These reads are read-only and confined to the
checkout: links are followed only while they stay inside it. A link into a
workspace package (`node_modules/@scope/package` → `packages/package`) maps back
to that package in the examined revision, so workspace sources are always the
revision's, never the checkout's working copy; only third-party declarations are
the checkout's. A revision that keeps its own `node_modules` uses it. Without a
`repository.checkout` (container isolation), the helper does not run.

Program reads are confined to the repository (`containedPath`): a symlink is
followed only while its real target stays inside the extraction root, so a
workspace package manager's links (`node_modules/@scope/package` →
`packages/package`) resolve to the linked package's sources, and any link that
leaves the root fails. The compiler sees a linked file under its real path, so
it is one source file however it is reached, and linked paths are never program
roots, tsconfig matches or packages. Only the repository compiler's own
declaration libraries (`lib.*.d.ts`) are read outside this boundary. Configs
extending outside the repository are not supported. TypeScript config plugins
are not loaded. No emitted output or repository config JavaScript is executed.

Run directly on a checkout, the helper lists the root's files without
`node_modules` (installed packages are read on demand) and without build caches
tagged with `CACHEDIR.TAG` (such as Cargo's `target`).

The nearest ancestor `package.json` owns each source. The API packages are those
owning the program's root files (the selected tsconfig's files, or the entry
points); other manifests in the tree, such as a monorepo's unrelated packages
and fixtures, are ignored. Package `name` is the stable package identity;
anonymous packages fall back to their relative directory and the root falls back
to `"(root)"`. Two API packages with the same name fail. Use named packages when
package-directory moves must preserve identity.

Missing inputs, empty source programs, invalid configs, compiler errors and
missing API entrypoints throw actionable errors, not success-shaped empty
states.

Details: [public API](../typescript-public-api/README.md).

## Validation

Tests run the bundled helper as the CLI does, against fixture repositories with
the workspace's lockfile-pinned `typescript` (and, for `nestjs-di`, NestJS 11
with its dependency closure) installed into a separate checkout, and assert
explicit failures when they are absent or unsupported. Fixtures are
self-contained TypeScript programs and ambient dependency declarations; tests
never import fixture code.

```sh
npm run build --workspace @githubnext/projections-typescript-support
npm run test --workspace @githubnext/projections-typescript-support
npm run typecheck --workspace @githubnext/projections-typescript-support
npm run test:packed
```

`npm run test:packed` copies the built helper alone into an isolated directory,
checks it imports only Node.js built-ins, and runs it with module resolution
confined to that directory. Every emitted test state is validated by the real
native engine; all semantic comparisons and canonical hashes use that shared
implementation.

The opt-in qualification downloads real releases (`typescript` 5.0.4, 5.4.5,
5.9.3, 6.0.3 and 7.0.2 with `@typescript/typescript6`) and Node.js 20 and 22
builds, and checks identical results across them:

```sh
npm run test:toolchains --workspace @githubnext/projections-typescript-support
```

`PROJECTIONS_TOOLCHAIN_NODES=20.19.5,22.21.1` selects the Node.js versions;
Node.js 18.20.8 is always run to check that it is rejected explicitly.
