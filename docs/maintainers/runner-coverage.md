# Runner and extractor verification

The native CLI links directly to the Rust Engine, so integration tests exercise
the real engine rather than a JavaScript substitute. Built-in extractors run as
subprocesses through the exact same custom-extractor pipeline:
`packages/cli/tests/first_party.rs` runs every built-in both directly and as a
custom `projections __extract <id>` command and asserts byte-identical output,
while `packages/cli/test/first-party.test.mjs` verifies that the CLI's default
comparisons match the browser engine's.

## Reproducible checks

After building the workspace, run the core test suites from the public root:

```sh
npm run test --workspace @githubnext/projections-typescript-support
npm run test --workspace @githubnext/projections-cli
npm run test:rust
```

The real-Git integration suite needs Git, Python 3, and the configured Node
runtime. It commits multiple historical extractor implementations, runs each
selected revision, validates extractions with Rust, exports immutable manifests,
verifies byte and semantic tamper detection, and compares saved extractions
offline. It also tests working-tree and index preservation, archive attributes,
duplicate definitions and symlinks, extraction file and byte limits, strict raw
JSON, environment allowlists, missing tools, invalid output, timeouts,
cancellation, descendant process cleanup, and local failure diagnostics.
Separate HTTP tests cover startup authorization, token/Host/Origin checks,
offline execution bans, job concurrency, and cancellation cleanup.

Once the full workspace is built, you can run the installed-package proof:

```sh
npm run test:installed --workspace @githubnext/projections-cli
```

This packs the seven public browser and SDK packages, installs their tarballs
into a clean temporary directory without workspace links, copies the standalone
CLI binary into a separate directory, and exercises Python/Node extractors, the
native engine, saved documents, comparisons, batch/bookmark runs, untrusted
controlled-transport PRs, and the Inspector. Installation uses an empty temp npm
cache and the workspace's registry (the package feed proxy) for third-party
dependencies, with lifecycle scripts disabled and no root overrides or cached
metadata. (Vulnerability gating happens via dependency review and Dependabot,
not here; see
[Vulnerabilities in dependencies](../../CONTRIBUTING.md#vulnerabilities-in-dependencies).)
After install, review and comparison run completely offline. The test confirms
packaged HTML/JS/Wasm serving, trusted server jobs, and offline review, then
cleans up its temporary directory.

An opt-in `gh` extension check
(`npm run test:gh --workspace @githubnext/projections-cli`) installs the
source-built launcher (`tools/gh-projections`) via `gh extension install .` in a
throwaway public-root layout. It isolates HOME/XDG/GH_CONFIG_DIR and an offline
token sentinel, disables update checks, and uses a refusing proxy to prove zero
GitHub API or update requests occur. It verifies identical standalone and
extension help, native-validated collection, trust rejection, caller-relative
output paths, and explicit missing-build errors. Ordinary CLI tests don't
require `gh`, but running this opt-in proof treats a missing `gh` as a hard
failure rather than skipping.

The standalone binary proof is cross-platform and runs on every release target:

```sh
npm run test:binary --workspace @githubnext/projections-cli -- --binary FILE --gh-extension
```

It copies only the executable into an empty directory and runs it with nothing
but Git on PATH (no Node): testing `--version`, `licenses`, `list`, `show`,
`compare` (both default and custom comparator files), `--output`, `validate` on
saved extractions and comparisons, and Inspector startup with a comparison job.
It verifies that no helper is unpacked before first use, then exercises each
embedded helper whose toolchain is available on PATH (Django's Python helper,
TypeScript with Node, .NET) from the per-user cache — including replacing a
tampered cached helper. Setting
`PROJECTIONS_PROOF_REQUIRE=dotnet,python,typescript` makes each listed helper
mandatory, and `--gh-extension` installs the binary as an offline local GitHub
CLI extension and invokes it through `gh`.

## Platform coverage

Because Projections ships on Linux, macOS, and Windows, CI runs each test suite
on the platforms where behavior can actually differ. Text-only checks (format,
lint, types, file standards, generated docs) behave identically everywhere and
run on Linux and macOS.

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

`public-product` runs as parallel jobs, each building the workspace first: on
Linux, `ubuntu-latest, checks` (static checks, types, lint and the
self-projection), `ubuntu-latest, Node` (the Node suites, installed proofs, the
Action end to end and generated documentation) and `ubuntu-latest, Rust` (the
Rust, native tool and Docker suites); on macOS, `macos-latest, Rust` and
`macos-latest, Node` (everything else). `windows-integration` runs as two
parallel jobs too: `browser` (the browser suites and the Action) and `VS Code`.
This table describes what pushes to `main` and the nightly run cover; pull
requests run only the jobs their changes reach
([what CI runs](../../CONTRIBUTING.md#what-ci-runs)). Browser suites run in full
and sharded on Linux. On Windows, we run the full CLI browser suite (which
exercises the CLI server and process handling) plus one renderer suite as a
smoke test — renderers behave identically across OSes, so running all of them on
Windows would burn CI time without adding coverage. Any platform-specific skip
or `ignore` states its reason; for instance, Rust tests that spawn `/bin/sh`
extractors or mock `gh`/Git scripts are ignored on Windows, where
`tests/windows.rs` covers Job Object supervision, output bounds, export, and
validation instead.

**Known gap:** on Windows, `dotnet` inside the stripped extractor environment
(`PATH`, `SystemRoot`, and its own variables) fails with "An issue was
encountered verifying workloads," so the installed proof runs the .NET helper
only on Linux and macOS. Whether extractors should also inherit Windows machine
locations (`ProgramData`, `ProgramFiles`) is still open.

### The portability check

`npm run check:portability` (included in `npm run check`) scans all shipped code
— everything under `packages/` outside tests, fixtures, and snapshots (including
CLI templates), plus the GitHub Action — for OS-specific assumptions:

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

When a flagged pattern is genuinely cross-platform — such as using `path.posix`
on a repo-relative path or URL — record it in `.portability.yaml` with the file,
rule, and reason. Stale entries that no longer match fail the check so the
allowlist stays accurate. The rules themselves are tested in
`tools/scripts/check-portability.test.mjs`.

In extractor or prepare commands, a bare `python3` or `python` automatically
resolves to whichever Python 3 is installed (`python3`, `python`, or the Windows
`py -3` launcher), keeping definitions portable
([process](../contracts/extractors.md#process)).

## Preserved adapter capabilities

All 21 adapters maintain independent descriptors, worker registrations, and
domain-specific evidence. External language toolchains are optional at runtime,
but missing tools or broken native tests fail explicitly when enabled.

- `workspace-dependencies`, `repository-map`: npm, pnpm, Yarn classic, and Yarn
  Berry workspaces with lockfiles from each manager (negated globs, `workspace:`
  and `npm:` protocols, aliases), explicit missing-manifest errors, and the full
  file-hierarchy map.
- `typescript-public-api`: Real TypeScript type-checker exports, overload order,
  nominal brands, mapped and conditional types, package exports, guarded module
  resolution, and diagnostics.
- [Custom extractor samples](../../examples/extractors/README.md): Feature
  flags, HTTP routes, message handlers, and Redux slices — symbol-resolved
  conventions, slices, registrations, and Express/Fastify routes reproducing the
  former built-ins' fixture outputs with explicit limitations.
- `cargo-dependencies`: Stored authoritative metadata fixtures alongside live
  Cargo workspace resolution.
- `nuget-dependencies`: Resolved assets v3/v4, framework aliases, RID graphs,
  direct/transitive/project edges, and malformed input rejection.
- `go-support` (shared Go helper, no registered extractor yet): Standard-library
  helper built offline with the project's Go, supporting user or granted caches,
  `GOTOOLCHAIN=local`, multi-package loading and type checking, and narrower
  patterns.
- `terraform-infrastructure`: Real Terraform 1.14 and OpenTofu 1.12 plan and
  state JSON plus a production-like AWS change covering sensitive and unknown
  redaction (including unmarked copies of sensitive values), count and for_each
  instances, nested modules, module outputs and input variables traced to
  resources, `depends_on`, replacement, destruction, moves, imports, and native
  `plan`/`show` execution.
- `azure-what-if`: What-if results for a Bicep 0.48 deployment compiled offline:
  child and extension resource-ID parsing, containment, payload resource-ID
  references (dropping read-only back-references), Bicep `dependsOn` via a small
  ARM expression evaluator, Create/Modify/NoChange/Ignore/Delete, secret-named
  property redaction, failed results, and native `az deployment … what-if` /
  `az bicep build` invocation.
- `github-actions-jobs`: Declared jobs and `needs` from workflow YAML, rejecting
  malformed YAML, duplicate keys, dangling `needs`, expressions, and cycles.
- `github-agentic-workflows`: Golden extractions of real gh-aw and agentics
  workflows plus synthetic PRs compiled by gh-aw v1.3.0: merged imports with
  provenance, groups, classes, renamed and unknown fields, and current/stale/
  missing lock checks (verified against every workflow in a gh-aw checkout via
  the opt-in `GH_AW_CHECKOUT` test).
- `tetragon-policies`: Golden extractions of Tetragon-validated policies across
  every hook family, lists, selector macros, monitor mode, workload and node
  scopes, version skew, and templated values; deterministic across file order;
  CRD validation (checked against Tetragon's published CRDs in an opt-in test),
  agent values, kernel profile findings, workload coverage, and Helm/Kustomize
  rendering through a recording runner with trust enforced; rejecting malformed
  YAML, duplicate keys or identities, undefined lists/macros, Tetragon's
  selector/action limits, and unrendered templates.
- `dotnet-public-api`, `dotnet-di`, `efcore-schema`: Validated pre-exported
  imports plus live Roslyn, service composition, relational EF model execution,
  and host/design-time conventions.
- `nestjs-di`: Validated pre-exported import plus NestJS 11's live preview-mode
  container and serialized graph: class/string/symbol tokens,
  value/factory/alias providers, all three scopes plus implicit request scoping,
  property and optional injection, module imports/exports, root-module
  discovery, trust, and before/after service, lifetime, and implementation
  diffs.
- `spring-di`: Validated pre-exported import plus live Spring Boot 4 (Gradle)
  and Spring Boot 3 (Maven) builds with the user's JDK: `@Bean` contracts and
  implementations, component scanning, prototype and request scopes with scoped
  proxies, aliases, `@Primary` and qualifiers, collections, `Optional` and field
  injection, matched conditions, runners never executed, trust, and before/after
  service, lifetime, and implementation diffs.
- `prisma-schema`: Native Prisma Schema Language parsing verified against Prisma
  6.19.3 schema-engine output: multi-file schemas and folders, mapped and native
  types, defaults, indexes, keys, relations, views, composite types, semantic
  changes, and malformed schemas.
- `rails-schema`: Static `db/schema.rb` parsing of Rails 7.1 PostgreSQL and
  Rails 6 MySQL dumps: implicit, typed, and composite primary keys, sized,
  array, virtual, and enum columns, lambda defaults, expression/partial/fulltext
  indexes, checks, foreign keys using application inflections, Rails 7 datetime
  precision, multiple databases, skipped statements, migration diffs, and
  malformed files.
- `rails-routes`: Static routing-DSL evaluation checked against ActionPack
  6.1.7.10's own router tables on two fixture apps (names, verbs, paths,
  controllers, actions, and order): resources, singular resources, shallow
  nesting, namespaces, scopes, concerns, `draw`, mounts, redirects, constraints,
  API-only apps, custom inflections, plus unresolved gem macros, loops, computed
  arguments, and conditions.
- `django-schema`: Live Django registry execution, implicit objects, stable
  model moves, constraints, semantic changes, explicit settings precedence, and
  database-access rejection.
- `code-statistics`: Golden tokei counts across Rust, Python, TypeScript, Go,
  Markdown, HTML, and shell fixtures, test-file classification, language
  overrides, excludes, and explicit skipped-file diagnostics.
- `scip-file-references`: Real `scip-typescript` index fixture, indexer
  execution with private or default output, trust, version-free symbol identity,
  stale/malformed index rejection, and an opt-in native `scip-typescript` run.
- `command-output`: Direct argv execution, exact stdout identity, malformed
  commands, process failure, and output bounds.

## Explicit native coverage and gaps

The .NET native suites passed on macOS arm64 with SDKs 9.0.318 and 8.0.425
(selected via `global.json`) and the slim helper on runtimes 9.0.20 and 8.0.31.
They cover Roslyn with source generators, application-owned DI and EF Core, and
the `CreateHostBuilder`, `CreateWebHostBuilder`, minimal-hosting, and
`IDesignTimeDbContextFactory<T>` conventions, with disposable build outputs and
shared compiler/MSBuild servers disabled:

```sh
PROJECTIONS_NATIVE_DOTNET=1 cargo test -p projections-cli --test native_tools native_dotnet
```

The Django native registry suite passed on macOS with Python 3.9.6 and Django
4.2.30 in an isolated virtualenv, exercising the real helper (unchanged model
moves, mapped-column changes, constraints, and database-access rejection). From
the public root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r packages/extractors/django-schema/helper/requirements.txt
PROJECTIONS_DJANGO_PYTHON="$PWD/.venv/bin/python" \
  cargo test -p projections-cli --test native_tools native_django
```

Real projects should supply their own compatible Python environment; collection
never installs or mutates project dependencies.

The Spring native suite passed on macOS arm64 with Temurin JDK 21.0.13 (from
Adoptium), Gradle 9.8.2, and Maven 3.9.16 (official checksum-verified
distributions), building one fixture on Spring Boot 4.1.2 (Gradle) and Spring
Boot 3.5.16 (Maven). CI installs the exact same versions:

```sh
PROJECTIONS_NATIVE_SPRING=1 cargo test -p projections-cli --test native_tools native_spring
```

The `nestjs-di` suite runs automatically with every `npm test` against the
workspace's lockfile-pinned NestJS 11 installed in a separate checkout.

Cargo, Go, and NuGet tests passed with local toolchains. When Terraform isn't
installed, select those three explicitly:

```sh
PROJECTIONS_NATIVE_ECOSYSTEMS=1 \
CARGO_HOME="$HOME/.cargo" \
cargo test -p projections-cli --test native_tools -- \
  native_cargo native_go native_nuget
```

These suites were ported to Rust when the duplicate TypeScript extractors were
removed; the historical receipts below predate that port and exercised the
former TypeScript implementations.

Before the repository went public, canonical Linux CI completed all **78
extractor cases with zero skips** — including live Terraform, the native NuGet
assets fixture, .NET/Roslyn/EF, Django, Go, Cargo, nightly rustdoc, and the
effective pipeline producer — and passed on macOS as well. Native suites remain
opt-in for local runs, and enabling them fails hard if a required tool is
missing rather than silently skipping. Stored domain fixtures alone never
substitute for native execution evidence.

That same Linux CI run also verified real Docker container isolation using a
pinned Node image, proving read-only root and repo mounts, blocked repo writes,
loopback-only networking, zero effective capabilities, no-new-privileges, and
host-user mapping — with the native engine producing the exact same extraction
digest as a local run:

```sh
export PROJECTIONS_CONTAINER_IMAGE=node:26.12.1-bookworm-slim@sha256:88e480776c6149ff1d098cd304f44bf18057fb5d284a3329b78162d29821e28c
docker pull "$PROJECTIONS_CONTAINER_IMAGE"
npm run test:container
```

Linux CI provisions optional .NET, Python/Django, Go, and Terraform toolchains,
enables every native extractor test, and runs this Docker check; missing or
broken tools fail instead of skipping. Note that Docker evidence does not imply
Podman coverage, the collector-publication workflow is parsed and policy-checked
but not yet deployed, and no paid providers or live deployments are involved.

Inspector browser/Worker/Wasm verification runs the production client against
the real loopback backend. The integration suite passed 24 cases across Chromium
and WebKit on desktop and mobile — covering live Git/native comparisons,
cancellation, denied startup trust, failure diagnostics, offline saved
artifacts, readonly static scenarios, and forged-document/path rejection under a
non-root HTTP prefix. Backend API and asset-serving tests alone never count as
proof of page rendering.

Batch and scenario regressions use real Git and native Engine validation,
covering historical implementations, per-item unknown/trust/tool failures,
working-tree bookmarks, sibling mutation isolation, and cancellation. PR tests
pair real local Git with controlled metadata and fetch transports, verifying
exact commit/merge-base binding and checkout/index preservation. A separate
authenticated operator-`gh` acceptance run also verified default metadata and
HTTPS acquisition, immutable revision binding, and a nonempty `code-statistics`
comparison under untrusted execution with zero failed projections — though that
run does not establish fork or SSO coverage.
