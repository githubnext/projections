---
description: The built-in extractors, one Rust crate each
icon: pickaxe
---

# Extractors

Each built-in extractor is its own Rust crate, `projections-extractor-<id>`,
with its code, README, fixtures and any ecosystem helper together:

<!-- prettier-ignore -->
| Directory | Contents |
| --- | --- |
| `<id>/` | One built-in extractor: `src/lib.rs` (descriptor, trust rule, `collect`), `README.md`, `tests/fixtures/` and, when it runs an ecosystem program, `helper/` |
| `sdk/` | The public Rust [extractor SDK](sdk/README.md), the only Projections library extractors depend on |
| `catalog/` | The registry of the built-in extractors, in published order ([catalog](catalog/README.md)) |
| `dotnet-support/` | The shared .NET helper and build orchestration for `dotnet-public-api`, `dotnet-di` and `efcore-schema` ([.NET support](dotnet-support/README.md)) |
| `typescript-support/` | Builds the self-contained Node helper for `typescript-public-api` and `nestjs-di`, and the Rust code that runs it ([TypeScript support](typescript-support/README.md)) |
| `go-support/` | The shared Go helper and toolchain runner for Go extractors ([Go support](go-support/README.md)) |

Built-in extractors are deterministic: the same revision produces the same
extraction, in a stable order, from declared or resolved structure rather than
observed behavior (see
[determinism and authority](../../docs/models/domain-model/extension-points.md#determinism-and-authority)).

Extractors depend on the SDK, never on the CLI, runner or Engine. Each built-in
runs as its own process, `projections __extract <id>`, which reads the public
extractor request, dispatches through `catalog` and writes the extraction; the
runner starts it, supervises it and normalizes its extraction exactly as it does
a custom extractor's.

## Embedded helpers

A source build resolves helpers from their crates. The released executable (and
`npm run build`'s `packages/cli/dist/projections`) embeds them; the first
extraction that needs one unpacks the complete set into the per-user cache and
verifies it on every use (see
[helper cache](../../docs/runner/caches.md#helper-cache)).
`PROJECTIONS_COLLECTOR_ASSETS` names a directory with the same layout instead:

<!-- prettier-ignore -->
| Path | Source |
| --- | --- |
| `helpers/go` | `go-support/helper`, which uses only the Go standard library |
| `helpers/dotnet` | The slim prebuilt `dotnet-support/helper` (`Projections.Dotnet.dll`, `.deps.json` and `.runtimeconfig.json`, first-party code only), published by `dotnet-support/scripts/publish.mjs` |
| `helpers/python` | `django-schema/helper` |
| `helpers/spring` | `spring-di/helper`, first-party Java source compiled with the project's own JDK |
| `helpers/node/extractor.mjs` | `typescript-support/dist/extractor.mjs` (one bundled file) |

## Runtime requirements

Every built-in extractor needs only the Projections executable and the toolchain
the examined project already uses. Helpers ship with the executable and never
download dependencies while extracting; a missing or unsupported toolchain fails
with an explicit error, never a fallback.

<!-- prettier-ignore -->
| Extractors | Requires |
| --- | --- |
| `typescript-public-api` | Node.js 20+ and the repository's own installed `typescript` 5.x/6.x (or `@typescript/typescript6` beside TypeScript 7) ([TypeScript support](typescript-support/README.md)) |
| `nestjs-di` | Node.js 20+, the repository's own installed `typescript` 5.x/6.x and `@nestjs/core` 9.3+ ([NestJS](nestjs-di/README.md)) |
| `go-public-api` | Go 1.24+ ([Go public API](go-public-api/README.md), [Go support](go-support/README.md)) |
| `rust-public-api` | The project's Cargo with a nightly toolchain for rustdoc JSON format 61 ([Rust public API](rust-public-api/README.md)) |
| `dotnet-public-api`, `dotnet-di`, `efcore-schema` | .NET SDK 8.0.100+; the slim helper ships prebuilt and uses the SDK's Roslyn and the application's own dependency injection and EF Core ([.NET support](dotnet-support/README.md)) |
| `django-schema` | Python with the project's Django ([Django](django-schema/README.md)) |
| `spring-di` | A JDK 17+ with `javac` and the project's Gradle or Maven (wrapper or on PATH); Spring Boot 3.0+ ([Spring](spring-di/README.md)) |
| `cargo-dependencies`, `nuget-dependencies`, `terraform-infrastructure`, `azure-what-if` | The ecosystem's tool when not importing a pre-exported model |
| `scip-file-references` | The project's own SCIP indexer (`scip-typescript`, `rust-analyzer`, `scip-go`, `scip-python`, …) when not reading an existing index ([SCIP](scip-file-references/README.md)) |
| `command-output` | Whatever the configured repository commands run |
| `tetragon-policies` | Nothing, or the repository's own `helm` or `kustomize` when it renders a chart or kustomization ([Tetragon policies](tetragon-policies/README.md)) |
| All others | Nothing beyond the executable |

`prisma-schema` parses Prisma schemas itself instead of using the project's
`prisma` installation, a deliberate exception: Prisma has no stable public API
for its schema ([Prisma](prisma-schema/README.md)).

The examined project's installed Node packages are resolved from the repository
checkout, because materialized revisions omit ignored files such as
`node_modules`; one installation examines every compared revision, as a
toolchain on `PATH` does. For `typescript-public-api` this includes the types of
installed dependencies, while workspace packages linked there are read from the
examined revision; `nestjs-di` loads the application's packages from there too.
The project's own dependencies (its NuGet packages, Go modules) remain the
project's. .NET restores follow the repository's NuGet configuration and
otherwise reuse your NuGet global packages folder; grant a prepared cache
through `execution.environment` to extract offline.

Extractors are **not** network or filesystem sandboxed. Built-in and custom
extractors, the ecosystem tools they run and the repository code those tools
execute have your user's privileges: they can read and write files, reach the
network and use any credentials in the granted environment. `--trust` is the
control; an environment allowlist limits what is passed along, not what the
process can do. Optional container isolation (`--container-image`) is the only
stronger boundary.

## Ecosystem extractors

`cargo-dependencies`, `nuget-dependencies`, `terraform-infrastructure`,
`azure-what-if`, `github-actions-jobs` and `scip-file-references` share these
rules. All imported JSON/YAML paths are repository-relative regular files,
disallow traversal and symlinks, and are limited to 32 MiB. Imports do **not**
require trust. Native tools require `--trust`, run without a shell, and honor
the projection execution timeout. Tool failure, malformed input, unknown schema
versions, and unresolved required dependencies are errors—not empty or
source-regex-derived approximations.

Configure these keys inside a projection's `inputs`. Paths to executable tools
can be absolute, including portable SDK installations. SDK environment variables
must be listed in `execution.environment` (for example `RUSTUP_HOME`,
`CARGO_HOME`, `GOCACHE`, `GOMODCACHE`, `GOOS`, `GOARCH`, `GOFLAGS`). Tool
execution can compile repository code and download dependencies; only trust
reviewed repositories. Normal fixture tests do not execute ecosystem tools.

### Verification and CI

Hermetic tests read captured real Cargo and Terraform models, realistic NuGet
restore assets and Actions YAML from each extractor's `tests/fixtures`:

```sh
cargo test -p projections-cli --test collectors
```

Opt-in native tests **fail**, rather than skip, when a dependency is missing:

```sh
PROJECTIONS_NATIVE_ECOSYSTEMS=1 \
PROJECTIONS_GO=/portable/go/bin/go \
PROJECTIONS_TERRAFORM=/portable/terraform \
PROJECTIONS_DOTNET_EXECUTABLE=/portable/dotnet/dotnet \
PROJECTIONS_CARGO=/portable/cargo/bin/cargo \
PROJECTIONS_SCIP_TYPESCRIPT=/portable/scip-typescript \
CARGO_HOME=/portable/cargo \
cargo test -p projections-cli --test native_tools
```

The executable variables default to PATH when omitted. The Go helper uses only
the standard library, so the Go suite runs with `GOPROXY=off` and empty module
caches. Tests create and clean scratch repositories under
`packages/cli/target/native-tool-tests`, not system temp paths. The native NuGet
test requires the .NET 8 SDK (or a newer SDK with the .NET 8 targeting pack). It
creates a small project, actually executes `dotnet restore` with
`Microsoft.Extensions.DependencyInjection` 8.0.1, then collects the generated
`obj/project.assets.json` without trust. Assertions cover the direct package,
its transitive Abstractions dependency, resolved versions and graph
relationships. Restore uses the existing NuGet cache or the official NuGet feed;
`NUGET_PACKAGES` can select a prepopulated CI cache. Package vulnerability
auditing is disabled for this bounded restore test. Missing SDKs or failed
restores fail the native suite.

These suites were ported from the former TypeScript extractor tests to Rust,
which now runs the shipped extractors. The Cargo, Go and NuGet suites were
verified locally on macOS arm64 with Cargo 1.97.1, Go 1.27.1, .NET SDK 9.0.318
and Node 26.12.1. The Terraform suite was verified with OpenTofu 1.12.6
(`PROJECTIONS_TERRAFORM=$(command -v tofu)`); it also runs where CI selects
`PROJECTIONS_NATIVE_ECOSYSTEMS=1` with Terraform provisioned.
