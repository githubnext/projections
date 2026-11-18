# Runner and extractor verification

The native CLI links the Rust Engine; integration tests use that real engine,
not a JavaScript semantic substitute. Built-in extractors run as processes
through the custom-extractor path, and `packages/cli/tests/first_party.rs` runs
every one of them both as itself and as a custom `projections __extract <id>`
command, requiring byte-identical extractions;
`packages/cli/test/first-party.test.mjs` requires the CLI's default comparisons
to equal the browser engine's.

## Reproducible checks

After building the workspace, run from the public root:

```sh
npm run test --workspace @githubnext/projections-typescript-support
npm run test --workspace @githubnext/projections-cli
npm run test:rust
```

The real-Git integration suite requires Git, Python 3 and the configured Node
runtime. It commits different historical extractor implementations, executes
each selected revision, validates extractions with Rust, exports immutable
manifests, detects byte/semantic tampering and compares saved extractions
offline. It also covers working-tree/index preservation, archive attributes,
definition duplicates/symlinks, actual extraction file/byte limits, strict raw
JSON, allowlisted environments, missing tools, invalid output, timeouts,
cancellation, descendant cleanup and local failure output. HTTP tests separately
cover fixed startup authorization, token/Host/Origin checks, offline execution
prohibition, job concurrency and cancellation cleanup.

After the full workspace build, an explicit installed-package check packs the
seven public browser and SDK packages, installs their tarballs into a fresh
temporary directory without workspace links, copies the self-contained CLI
executable alone into another directory, and executes the Python/Node,
native-engine, saved document, comparison, batch/bookmark, untrusted
controlled-transport PR and Inspector paths:

```sh
npm run test:installed --workspace @githubnext/projections-cli
```

Installation uses an empty temporary npm cache and the workspace's registry (the
package feed proxy) for third-party dependencies, with lifecycle scripts
disabled. The throwaway consumer has no workspace/root overrides. It does not
rely on previously cached dependency metadata. Known vulnerabilities are gated
by dependency review and Dependabot, not here (see
[Vulnerabilities in dependencies](../../CONTRIBUTING.md#vulnerabilities-in-dependencies)).
Artifact review and comparison remain offline after installation. The test
verifies actual packaged HTML/JavaScript/Wasm serving, trusted server jobs and
offline review, and removes its temporary install.

The separate opt-in `npm run test:gh --workspace @githubnext/projections-cli`
also installs the source-built launcher (`tools/gh-projections`) using actual
`gh extension install .` in a throwaway public-root layout. Its
HOME/XDG/GH_CONFIG_DIR and offline token sentinel are isolated, update checks
disabled, and a refusing proxy verifies zero GitHub API/update requests. It
exercises identical standalone/extension help, native-validated collection,
trust rejection, caller-relative output and explicit missing-build errors.
Ordinary CLI tests do not require `gh`; choosing this proof makes missing `gh`
an error, never a skipped success.

The installed-binary proof is cross-platform and runs on every release target:

```sh
npm run test:binary --workspace @githubnext/projections-cli -- --binary FILE --gh-extension
```

It copies the executable alone into an empty directory and runs it with only Git
on PATH (no Node): `--version`, `licenses`, `list`, `show`, `compare` with the
default comparator and a custom comparator file, `--output` and `validate` of
saved extractions and comparisons, and Inspector startup with a comparison job.
It then proves that no helper was unpacked before first use, and runs each
embedded helper whose toolchain is on PATH (Django's Python helper, TypeScript
with Node, .NET) from the platform's default per-user cache, including
replacement of an altered cached helper.
`PROJECTIONS_PROOF_REQUIRE=dotnet,python,typescript` makes each named helper
mandatory. `--gh-extension` installs the binary as an isolated, offline local
GitHub CLI extension and runs it through `gh`.

## Platform coverage

Projections ships for Linux, macOS and Windows, so CI runs each kind of suite on
the platforms where its result can differ. A suite that reads only text (format,
lint, types, file standards, generated documentation) gives the same result
everywhere and runs on Linux and macOS.

| What                                                       | Linux                                  | macOS                      | Windows                                             |
| ---------------------------------------------------------- | -------------------------------------- | -------------------------- | --------------------------------------------------- |
| Rust suites (`cargo test --workspace`)                     | `public-product`                       | `public-product`           | `windows`                                           |
| Node suites (`npm test`)                                   | `public-product`                       | `public-product`           | `windows-node`                                      |
| Installed-package proof (`test:installed`)                 | `public-product`                       | `public-product`           | `windows-node`                                      |
| `gh` extension proof (`test:gh`)                           | `public-product`                       | `public-product`           | release proof (`test:binary --gh-extension`)        |
| Release executable without Node (`test:binary`)            | release proof                          | release proof              | release proof                                       |
| Portability, boundaries, casing, links and READMEs         | `public-product`                       | `public-product`           | `windows-node`                                      |
| Format, lint, types, file standards, TSDoc and notices     | `public-product`                       | `public-product`           | —                                                   |
| Generated reference documentation                          | `public-product`                       | —                          | —                                                   |
| Native tool suites (.NET, Django, Spring, SCIP) and Docker | `public-product`                       | —                          | —                                                   |
| Browser suites, Chromium                                   | `browser`, every suite                 | —                          | `windows-integration`: the CLI's and one renderer's |
| Browser suites, WebKit                                     | `browser`, every suite                 | `browser-macos`: renderers | —                                                   |
| VS Code extension                                          | unit suites; release proof installs it | the same                   | unit suites; smoke test in VS Code (`test:vscode`)  |
| GitHub Action end to end (`.github/actions/action-e2e`)    | `public-product`                       | `public-product`           | `windows-integration`                               |

The browser suites run in full on Linux, sharded. On Windows the CLI's own
browser suite runs in full, since it exercises the CLI's server and processes,
and one renderer's suite runs as a smoke test: a renderer draws the same on
every operating system, so the rest would cost Windows build time without new
coverage. A test that can't run on a platform says why in its skip or `ignore`
reason; for example, the Rust suites that run `/bin/sh` extractors or stand-ins
for `gh` and Git are ignored on Windows, and `tests/windows.rs` covers what they
cover there (Job Object supervision, output bounds, export and validation).

Known gap: on Windows, the .NET extractors' `dotnet` fails in the environment
extractors get (`PATH`, `SystemRoot` and its own variables) with "An issue was
encountered verifying workloads", so the installed proof runs the .NET helper
only on Linux and macOS. Whether extractors should get Windows' machine
locations (`ProgramData`, `ProgramFiles`) is open.

### The portability check

`npm run check:portability` (part of `npm run check`) reads shipped code, which
is everything in `packages/` except tests, fixtures and snapshots (the CLI's
templates included), and the GitHub Action, for operating-system assumptions:

| Rule                 | Flags                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `posix-shell`        | `/bin/sh`, `/usr/bin/...` and `Command::new("sh")`                                                 |
| `shell-string`       | `shell: true`, and `exec` of a command string                                                      |
| `bare-launcher`      | Spawning `npm`, `npx`, `pnpm`, `yarn` (or their `.cmd` shims) or `python3` by name                 |
| `rust-bare-launcher` | `Command::new("npm")` and kin, and `Command::new("python3")`, which bypasses the Python resolution |
| `posix-path-module`  | `path.posix` on what may be a native path                                                          |
| `native-path-slash`  | A native path split on `'/'`                                                                       |
| `file-text-lf`       | File text split on `'\n'` alone, which leaves CR in a CRLF checkout                                |
| `path-equality`      | Resolved paths compared with `===`, which ignores case-insensitive file systems                    |
| `rust-path-slash`    | `Path::join("a/b")`, which mixes separators on Windows                                             |
| `npm-script-posix`   | npm scripts that `cmd.exe` can't run: `rm`, `cp`, `VAR=value`, single quotes, `$VAR`               |

A match that is right on every platform, such as `path.posix` on a repository
path or a URL, goes in `.portability.yaml` with the file, the rule and the
reason; an entry that no longer matches fails the check, so the list stays true.
The rules' own tests are `tools/scripts/check-portability.test.mjs`.

A bare `python3` or `python` in an extractor or prepare command runs whichever
Python 3 the machine has (`python3`, `python`, then the Windows `py -3`
launcher), so definitions stay portable
([process](../contracts/extractors.md#process)).

## Preserved adapter capabilities

All 21 adapters retain independent descriptors, executable worker registrations
and their domain-specific evidence. Available language tools are optional at
runtime. Missing tools or enabled-but-broken native tests fail explicitly.

- `workspace-dependencies`, `repository-map`: npm, pnpm, Yarn classic and Yarn
  Berry workspaces with lockfiles written by each manager (negated globs,
  `workspace:` and `npm:` protocols, aliases) and an explicit missing-manifest
  failure; file hierarchy implementation retained.
- `typescript-public-api`: Actual TypeScript checker exports, overload order,
  nominal brands, mapped/conditional types, package exports, guarded module
  resolution and diagnostics.
- [Custom extractor samples](../../examples/extractors/README.md): feature
  flags, HTTP routes, message handlers, Redux slices: Symbol-resolved
  conventions, slices, registrations and Express/Fastify routes, reproducing the
  former built-ins' output on fixtures, with explicit limitations.
- `cargo-dependencies`: Stored authoritative metadata fixtures plus actual Cargo
  workspace resolution.
- `nuget-dependencies`: Resolved assets versions 3/4, framework aliases, RID
  graphs, direct/transitive/project edges and malformed input rejection.
- `go-support` (shared Go helper; no registered extractor yet): The
  standard-library-only helper built offline with the project's Go: user or
  granted caches, `GOTOOLCHAIN=local`, multi-package loading and type checking,
  narrower patterns.
- `terraform-infrastructure`: Real Terraform 1.14 and OpenTofu 1.12 plan and
  state JSON plus a production-like AWS change: sensitive and unknown masks
  (including unmarked copies of sensitive values), count and for_each instances,
  nested modules, module outputs and input variables followed to resources,
  `depends_on`, replacement, destruction, moves and imports; native `plan` and
  `show` with the user's Terraform or OpenTofu.
- `azure-what-if`: What-if results for a Bicep deployment compiled with Bicep
  0.48 (no network): resource-ID parsing including child and extension
  resources, containment, references from payload resource IDs with read-only
  back-references dropped, Bicep `dependsOn` through a small ARM expression
  evaluator, Create/Modify/NoChange/Ignore/Delete, secret-named property
  redaction, failed results, and the native `az deployment … what-if` and
  `az bicep build` argv.
- `github-actions-jobs`: Declared jobs and `needs` from workflow YAML; malformed
  YAML, duplicate keys, dangling `needs`, expressions and cycles rejected.
- `github-agentic-workflows`: Golden extractions of real gh-aw and agentics
  workflows and of synthetic pull requests compiled by gh-aw v1.3.0: imports
  merged with their provenance, groups, classes, renamed and unknown fields, and
  lock files checked current, stale and missing; the lock check matches gh-aw
  for every workflow of a gh-aw checkout in an opt-in test (`GH_AW_CHECKOUT`).
- `tetragon-policies`: Golden extractions of Tetragon-validated policies
  covering every hook family, lists, selector macros, monitor mode, workload and
  node scope, version skew and templated values; deterministic across file
  order; CRD validation (matching Tetragon's own published CRDs in an opt-in
  test), agent values, kernel profile findings, workload coverage, and Helm and
  Kustomize rendering through a recording runner with trust enforced; malformed
  YAML, duplicate keys and identities, undefined lists and macros, Tetragon's
  selector and action limits and unrendered templates rejected.
- `dotnet-public-api`, `dotnet-di`, `efcore-schema`: Validated pre-exported
  imports plus the SDK's actual Roslyn, service composition, relational EF model
  execution and host/design-time conventions.
- `nestjs-di`: Validated pre-exported import plus NestJS 11's actual
  preview-mode container and serialized graph: class/string/symbol tokens,
  value/factory/alias providers, all three scopes and implicit request scoping,
  property and optional injection, module imports and exports, root-module
  discovery, trust and a before/after service, lifetime and implementation
  change.
- `spring-di`: Validated pre-exported import plus a real Spring Boot 4 (Gradle)
  and Spring Boot 3 (Maven) build of one sample application with the user's JDK:
  `@Bean` contracts and implementations, component scanning, prototype and
  request scopes with scoped proxies, aliases, `@Primary` and qualifiers,
  collections, `Optional` and field injection, matched conditions, runners never
  run, trust and a before/after service, lifetime and implementation change.
- `prisma-schema`: Native Prisma Schema Language parsing checked against Prisma
  6.19.3 schema-engine output: multi-file schemas and folders, mapped/native
  types, defaults, indexes, keys, relations, views, composite types, semantic
  changes and malformed schemas.
- `rails-schema`: Static `db/schema.rb` reading of a Rails 7.1 PostgreSQL dump
  and a Rails 6 MySQL dump: implicit, typed and composite primary keys, sized,
  array, virtual and enum columns, lambda defaults, expression, partial and
  fulltext indexes, checks, foreign keys with default columns from the
  application's inflections, Rails 7's datetime precision, multiple databases,
  skipped statements, a migration's before and after, and malformed files.
- `rails-routes`: Static routing-DSL evaluation checked against the route tables
  ActionPack 6.1.7.10's own router builds from two fixture applications (names,
  verbs, paths, controllers, actions and order): resources, singular resources,
  shallow nesting, namespaces, scopes, concerns, `draw`, mounts, redirects,
  constraints, API-only applications and custom inflections; plus unresolved gem
  macros, loops, computed arguments and conditions.
- `django-schema`: Actual Django registry execution, implicit objects, stable
  model moves, constraints, semantic changes, explicit settings precedence and
  database-access rejection.
- `code-statistics`: Golden tokei counts across Rust, Python, TypeScript, Go,
  Markdown, HTML and shell fixtures, test-file classification, language
  overrides, excludes and explicit skipped-file diagnostics.
- `scip-file-references`: A real `scip-typescript` index fixture, indexer
  execution with private or default output, trust, version-free symbol identity,
  stale/malformed index rejection, and an opt-in native `scip-typescript` run.
- `command-output`: Actual argv execution, exact stdout identity, malformed
  commands, process failure and output bounds.

## Explicit native coverage and gaps

The .NET native suites passed on macOS arm64 with SDKs 9.0.318 and 8.0.425
(selected through `global.json`), with the slim helper on runtimes 9.0.20 and
8.0.31. They cover the SDK's Roslyn with source generators, application-owned
dependency injection and EF Core, and the `CreateHostBuilder`,
`CreateWebHostBuilder`, minimal-hosting and `IDesignTimeDbContextFactory<T>`
conventions. Helper/application outputs are disposable, and shared
compiler/MSBuild servers are disabled:

```sh
PROJECTIONS_NATIVE_DOTNET=1 cargo test -p projections-cli --test native_tools native_dotnet
```

The Django native registry check passed on macOS with Python 3.9.6 and Django
4.2.30 in an isolated validation environment. It executes the actual helper,
including unchanged model moves, mapped-column changes, constraints and
rejection of database access. From the public root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r packages/extractors/django-schema/helper/requirements.txt
PROJECTIONS_DJANGO_PYTHON="$PWD/.venv/bin/python" \
  cargo test -p projections-cli --test native_tools native_django
```

Real projects should supply their own compatible Python environment; collection
does not install or repair their dependencies.

The Spring native suite passed on macOS arm64 with Temurin JDK 21.0.13 (from the
Adoptium API), Gradle 9.8.2 and Maven 3.9.16 (official distributions, checksums
verified), building one fixture on Spring Boot 4.1.2 through Gradle and on
Spring Boot 3.5.16 through Maven. CI installs the same versions:

```sh
PROJECTIONS_NATIVE_SPRING=1 cargo test -p projections-cli --test native_tools native_spring
```

The `nestjs-di` suite runs with every `npm test`, against the workspace's
lockfile-pinned NestJS 11 installed into a separate checkout.

Cargo, Go and NuGet tests passed with installed toolchains. Select those tests
explicitly when Terraform is absent:

```sh
PROJECTIONS_NATIVE_ECOSYSTEMS=1 \
CARGO_HOME="$HOME/.cargo" \
cargo test -p projections-cli --test native_tools -- \
  native_cargo native_go native_nuget
```

These suites were ported to Rust when the TypeScript extractor duplicates were
removed; the receipts below predate that port and exercised the former
TypeScript implementations.

Canonical Linux CI, before the repository's publication, completed all **78
extractor cases with zero skips**, including actual Terraform execution, the
separate native NuGet-assets fixture, .NET/Roslyn/EF, Django, Go, Cargo, nightly
rustdoc and the effective pipeline producer. The same run, and the next one,
also passed macOS. Native suites remain opt-in for ordinary local runs; enabling
them does not silently skip missing tools. Stored domain fixtures alone are not
substituted for this native execution evidence.

That Linux CI also passed the real Docker daemon check with a separately
prepared Node image. Its extractor verifies actual read-only root/repository
mounts, failed repository writes, loopback-only interfaces, zero effective
capabilities, no-new-privileges and host-user mapping inside the container. The
native engine must produce the same extraction digest as local collection:

```sh
export PROJECTIONS_CONTAINER_IMAGE=node:26.12.1-bookworm-slim@sha256:88e480776c6149ff1d098cd304f44bf18057fb5d284a3329b78162d29821e28c
docker pull "$PROJECTIONS_CONTAINER_IMAGE"
npm run test:container
```

Linux CI provisions the optional .NET, Python/Django, Go and Terraform
toolchains, enable every native extractor test and ran this Docker check in the
receipts above. Missing or broken enabled tools fail instead of skipping. Podman
is not established by Docker evidence. The collector-publication workflow is
parsed and policy-checked but has not been deployed. No paid providers or
deployment are involved.

Inspector browser/Worker/Wasm verification uses the production client and actual
loopback backend. The Inspector integration suite passed 24 cases across
Chromium/WebKit desktop/mobile, including real Git/native comparison,
cancellation, denied startup trust, failure output/diagnostics and offline saved
artifacts, plus readonly static scenarios and forged-document/path rejection
under a non-root HTTP prefix. Backend API tests and asset serving alone do not
establish page rendering.

Batch/scenario regressions use real Git and native Engine validation, including
historical implementations, per-item unknown/trust/tool failures, working-tree
bookmarks, sibling mutation isolation and cancellation. PR tests use real local
Git plus controlled metadata/fetch transports, with exact commit/merge-base and
checkout/index preservation. A separate authenticated operator-`gh` acceptance
also completed default metadata/HTTPS acquisition, exact immutable revision
binding and a nonempty `code-statistics` comparison with untrusted execution and
no failed projections. This does not establish fork/SSO coverage.
