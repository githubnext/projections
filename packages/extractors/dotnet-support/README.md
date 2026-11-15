---
description: "Shared support for the .NET extractors: their helper"
---

# .NET support

`dotnet-public-api`, `dotnet-di`, and `efcore-schema` use the slim
`Projections.Dotnet` helper (`helper/`), not source-text patterns or an
extractor executable found in the inspected repository. The helper ships
**prebuilt** with Projections as three files (about 110 KB): a
framework-dependent `Projections.Dotnet.dll`, its `.deps.json` and its
`.runtimeconfig.json`. It contains **only first-party code**. Everything else it
uses already belongs to the examined project:

- **Roslyn** comes from the .NET SDK that builds the project, the one the
  repository's `global.json` (or the default SDK) selects:
  `$(RoslynTargetsPath)/bincore`, normally `sdk/<version>/Roslyn/bincore`.
- **MSBuild** is never loaded into the helper. The project's own `dotnet build`
  reports its exact compiler invocation (MSBuild's `CscCommandLineArgs`, through
  `-getItem`), and the helper replays it with that SDK's Roslyn. SDKs whose
  MSBuild supports `-getResultOutputFile` (17.10+, .NET SDK 8.0.300+) write
  these results to a scratch file, read with a 256 MiB bound; older SDKs report
  them on stdout.
- **Microsoft.Extensions.DependencyInjection** and **EF Core** come from the
  examined application's build output and dependency graph (its `.deps.json` and
  the shared frameworks its `.runtimeconfig.json` names, such as
  `Microsoft.AspNetCore.App`). The helper reads them by reflection, so it pins
  no version and works with the application's own.

This crate runs the helper for those three extractors as
`dotnet Projections.Dotnet.dll` with the repository's own `dotnet`; extraction
never restores, builds or downloads anything for the helper. The helper consumes
one complete protocol-v0 `ExtractorRequest` JSON document on stdin and writes
one `Extraction` on stdout. Application console output and diagnostics go to
stderr. Failures exit nonzero; failed builds, failed source generators or
incomplete Roslyn compilations never produce partial graphs.

## Requirements and trust

Extraction needs only the Projections CLI and the repository's own .NET SDK,
**8.0.100 or newer** (the SDK the CI already uses to build the project; a
runtime is enough for prebuilt DI/EF adapters without `project`). Node and NuGet
access for the helper are not required. The helper targets .NET 8 with
`RollForward=LatestMajor`: it runs on the newest installed .NET runtime, because
the selected SDK's Roslyn targets that SDK's runtime. Grant
`DOTNET_ROLL_FORWARD` through `execution.environment` to override this.

The helper is compiled against the Roslyn 4.8 reference assemblies of .NET SDK
8.0.100; a newer SDK's compiler satisfies that reference. A repository that
replaces the compiler (for example with `Microsoft.Net.Compilers.Toolset`)
changes `$(RoslynTargetsPath)`, and the helper then uses that compiler, which
must also be Roslyn 4.8 or newer. The Roslyn extractor supports C# projects and
their referenced projects; select one target framework explicitly for
multi-targeted projects.

**All native collection requires `--trust`.** MSBuild targets, source
generators, module initializers, application startup code and factories are
executable repository code. **Extractors are not network or filesystem
sandboxed:** they run with your user's privileges, can read and write files,
reach the network, and use whatever credentials the granted environment and the
application's own configuration provide. Trust is the control. Review the
repository before trusting it, and do not run unreviewed application composition
in privileged CI jobs. The helper independently checks `capabilities.trusted`,
even when invoked directly rather than by the CLI.

## Configuration

Public API:

```json
{
  "id": "public-api",
  "extractor": "dotnet-public-api",
  "renderer": "api",
  "inputs": {
    "project": "src/Library/Library.csproj",
    "configuration": "Release",
    "framework": "net8.0",
    "dotnet": "/path/to/portable/dotnet"
  },
  "execution": { "timeoutMs": 300000, "reproducibility": "pinned-toolchain" }
}
```

Dependency injection and EF Core usually need only the application project,
found the way `dotnet ef` finds it (see [Conventions](#conventions)):

```json
{
  "id": "services",
  "extractor": "dotnet-di",
  "renderer": "dependency-injection",
  "inputs": { "project": "src/WebApp/WebApp.csproj" },
  "execution": { "timeoutMs": 300000 }
}
```

```json
{
  "id": "schema",
  "extractor": "efcore-schema",
  "renderer": "schema",
  "inputs": { "project": "src/WebApp/WebApp.csproj", "context": "OrdersContext" },
  "execution": { "timeoutMs": 300000 }
}
```

An explicit adapter overrides the conventions:

```json
{
  "id": "services",
  "extractor": "dotnet-di",
  "renderer": "dependency-injection",
  "inputs": {
    "project": "tools/ProjectionAdapter/ProjectionAdapter.csproj",
    "assembly": "bin/ProjectionAdapter/release/ProjectionAdapter.dll",
    "factoryType": "MyApp.ProjectionAdapter",
    "factoryMethod": "Services"
  },
  "execution": { "timeoutMs": 300000 }
}
```

<!-- prettier-ignore -->
| Input | Meaning |
| --- | --- |
| `project` | The project to build and examine; required for `dotnet-public-api`. Must stay inside the checkout. |
| `assembly` | The application assembly. With `project` it defaults to the build's `$(TargetPath)` and is relative to the build's artifacts directory; without `project` it is a prebuilt assembly relative to the repository root. |
| `factoryType`, `factoryMethod` | An explicit adapter (both or neither); otherwise the conventions apply. |
| `context` | `efcore-schema`: the `DbContext` (full or simple type name) when the application has several. |
| `environment` | Conventions: the host environment (`DOTNET_ENVIRONMENT`/`ASPNETCORE_ENVIRONMENT`); default the granted variable, else `Development`, as `dotnet ef` uses. `Development` hosts can read your user secrets. |
| `configuration` | Build configuration; default `Release`. |
| `framework` | One target framework of a multi-targeted project. |
| `dotnet` | The `dotnet` executable path (not a shell command); default `dotnet` on PATH. |

The project is always restored/built with
`dotnet build --artifacts-path <external-directory>` and
`CopyLocalLockFileAssemblies=true`, so even class-library adapters carry their
runtime dependencies. An explicit `assembly` is **relative to that artifacts
directory**: the SDK normally uses
`bin/<project-name>/release/<assembly-name>.dll`, and multi-targeted projects
use a pivot such as `release_net8.0`. For prebuilt DI/EF adapters, omit
`project`: `assembly` is then relative to the repository root. Include its
`.deps.json`, `.runtimeconfig.json` and runtime dependencies alongside it.

Every historical revision builds its own checked-out version of the configured
project, with a fresh application artifacts directory. Commit adapter source,
project references, `global.json`, NuGet lock/config files and any
code-generation inputs needed by that version. Environment variables are not
inherited indiscriminately: list required names under `execution.environment`
(for example proxy variables, `DOTNET_ENVIRONMENT`, or an application-specific
configuration selector). Configuration-specific values may also be supplied as
additional `inputs` and read by an explicit factory.

Application build outputs use a fresh temporary directory inside the disposable
revision materialization, removed after collection, failure or abort. There is
no application result cache and no host cache override.

### NuGet packages

The repository's own NuGet configuration decides first, then your existing
cache, with NuGet's own precedence:

1. A project's `RestorePackagesPath` always wins (NuGet applies it over
   everything below).
2. `NUGET_PACKAGES` granted through `execution.environment` applies, as it does
   for NuGet itself.
3. A `globalPackagesFolder` set by a `nuget.config` that applies to the project
   (the project directory or a parent): Projections asks NuGet
   (`dotnet nuget locals global-packages --list`, run from the project directory
   without user-level configuration) and leaves the choice to it.
4. Otherwise application restores **reuse your NuGet global packages folder**,
   the same one your own `dotnet build` uses: `.nuget/packages` under the NuGet
   home (`DOTNET_CLI_HOME`, else `HOME`, or `USERPROFILE` on Windows, when the
   definition grants it, as every extractor sees only granted variables), passed
   to the build as `NUGET_PACKAGES`.

Other user-level state is not forwarded (`HOME` reaches the build only when
granted, and `DOTNET_CLI_HOME` is a private directory), so user-level NuGet
configuration and credentials do not apply; the project's `nuget.config` decides
which feeds, if any, may be contacted. Granting `NUGET_PACKAGES` through
`execution.environment` selects a prepared cache explicitly (for example in
offline CI). Only when no home is granted does the restore fall back to a fresh,
empty folder inside the materialization. `DOTNET_ROOT` likewise reaches the SDK
only when granted. NuGet restores are safe to run concurrently against one
shared folder.

### Helper location

The helper is embedded in the Projections executable and unpacked, verified, to
`helpers/dotnet/Projections.Dotnet.dll` in its per-user helper cache (or read
from `helpers/dotnet` under `PROJECTIONS_COLLECTOR_ASSETS`). A build made
without a .NET SDK omits it, and these extractors then fail with an explicit
error. In a source checkout, the extractors use `helper/publish/`, produced by
`node packages/extractors/dotnet-support/scripts/publish.mjs` (or the CLI
build); they fail explicitly rather than building it implicitly. Shared compiler
and MSBuild server reuse is disabled to keep per-invocation builds independent.
Custom application MSBuild targets can still have their own side effects.

## Conventions

Without `factoryType`/`factoryMethod`, the helper discovers the application the
way `dotnet ef` does. **This runs the application's startup code** (its `Main`,
host builder and `Startup.ConfigureServices`, or a design-time factory), so it
requires trust like any other native collection. Conventions run from the
project directory, with `--applicationName=<assembly name>` as the host's
arguments, in the `Development` environment unless `environment` or a granted
`DOTNET_ENVIRONMENT`/`ASPNETCORE_ENVIRONMENT` says otherwise. **In
`Development`, default hosts read your user secrets** (`dotnet user-secrets`,
from your user profile), as they do under `dotnet ef`; set `environment` to
another value to avoid that.

The application's host is found on the entry point's type, in this order:

1. `public static IWebHost BuildWebHost(string[] args)` (EF Core only; the host
   is already built, so `dotnet-di` cannot read its service collection);
2. `public static IWebHostBuilder CreateWebHostBuilder(string[] args)`;
3. `public static IHostBuilder CreateHostBuilder(string[] args)`;
4. otherwise the entry point itself (minimal hosting, such as
   `WebApplication.CreateBuilder` or `Host.CreateApplicationBuilder`), which
   runs until its host reports the `HostBuilding`/`HostBuilt` diagnostic events
   and is then stopped with `HostAbortedException`.

**A host is never started.** `dotnet-di` appends a final `ConfigureServices`
callback and captures the complete `IServiceCollection` (including host defaults
and, for `CreateWebHostBuilder`, everything `Startup.ConfigureServices`
registered), then stops the build before any service provider exists. An entry
point that fails to build a host is an error; configure an explicit factory
instead.

`efcore-schema` chooses the `DbContext` like `dotnet ef`, in this order:

1. an `IDesignTimeDbContextFactory<TContext>` in the application or the projects
   it references; **no host is built** when one applies;
2. a context registered in the built (never started) host, for example with
   `AddDbContext`, resolved from a service scope;
3. a `DbContext` type with a public parameterless constructor.

At each step, `context` selects among several candidates; more than one
candidate without `context` is an error, and a step without a match falls
through to the next.

## Application adapter contract

An explicit adapter chooses exactly one public static method by `factoryType`
(reflection full name) and `factoryMethod`. Supported signatures take no
arguments or one `System.Text.Json.JsonElement` containing the **entire
ExtractorRequest**. The result may also be wrapped in `Task<T>`. Factories run
with the repository root as the working directory and the environment unchanged.

```csharp
public static class ProjectionAdapter
{
    public static IServiceCollection Services(JsonElement input)
    {
        var builder = WebApplication.CreateBuilder();
        // Call the same registration function that production startup uses.
        Startup.ConfigureServices(builder.Services, builder.Configuration);
        return builder.Services;
    }

    public static DbContext Database(JsonElement input)
    {
        // Configure the real provider and mappings, but do not start the server,
        // apply migrations, or connect to a database merely to inspect the model.
        return new AppDbContext(CreateProjectionOptions(input));
    }
}
```

The adapter must return the collection **after all relevant registrations and
replacements**, including host/framework additions if those matter to the
projection. Returned contexts are disposed after reading their design-time
model. Returned `IModel` values must retain relational/design-time metadata,
e.g. `context.GetService<IDesignTimeModel>().Model`; a trimmed runtime model may
lack index/check-constraint metadata and fail rather than silently inventing it.
Factories themselves are invoked; DI descriptor implementation factories are
**not** invoked, and instances are not constructed to infer relationships.

Adapters that use ASP.NET Core or another shared framework need a
`.runtimeconfig.json` naming it (executables have one; class libraries can set
`GenerateRuntimeConfigurationFiles=true`), so the helper loads the framework's
assemblies, including its dependency injection, from the installed framework.

## Semantic contracts

- **`api/v0`:** assembly, exported type and public/protected member entities all
  have `data.signature` strings. Roslyn supplies overload-aware documentation
  IDs, parameter/default values, generic constraints, nullability, constants,
  visible property accessors and source attributes. The compilation replays the
  build's compiler arguments: sources, references, defines, language version,
  nullable context, warning options, `.editorconfig`/`.globalconfig` severities
  and the project's source generators, so generated members are part of the API.
  Namespace/type/member identity includes the assembly's simple name, not its
  version or file path. Nested private/internal types and private/internal
  members are excluded. Method bodies and private setters do not become
  signatures. Source paths and locations occur only in evidence/metadata and are
  ignored by semantic comparison; generated sources keep their
  generator-relative paths. Assembly renames change identity; type/member
  renames are additions/removals, not guessed correspondence. Only the selected
  project's assembly is exported, not every referenced assembly. Analyzers and
  diagnostic suppressors do not run, as before. MSBuild reports about 1 KB per
  compiler argument; through a results file that allows very large projects,
  while SDKs before 8.0.300 report on stdout, bounded to 8 MiB (roughly 5,000
  source files and references), and fail explicitly beyond it.
- **`architecture/v0`:** actual `ServiceDescriptor` values produce service,
  registration and implementation entities. Each descriptor retains its
  lifetime, keyed/unkeyed status, registration kind and registration order
  **within its service/key group**. Multiple registrations remain separate,
  reflecting both enumerable resolution order and last-registration selection.
  Changing a lifetime modifies, rather than replaces, the registration. Factory
  method and target type identities are recorded without guessing their returned
  type or dependencies. Instance values are not serialized. Constructor
  dependencies become `dependsOn` relationships from an implementation to the
  services it injects, carrying `parameter`, `position`, `collection` and
  `optional`. They are `derived`, not authoritative: the container's own
  selection rule is replayed, picking the greediest public constructor whose
  parameters are all registered or defaulted. `IEnumerable<T>` parameters
  resolve to `T`, closed generic parameters resolve to an open generic
  registration, and `[FromKeyedServices]` resolves to the keyed service.
  Factory, instance and open generic registrations contribute no dependency
  relationships, and any implementation with no viable constructor is listed in
  `metadata.unconstructableImplementations`. Keyed services require the
  application's Microsoft.Extensions.DependencyInjection 8 or newer; earlier
  versions report every registration as unkeyed. Supported stable keys are
  primitives, enums, Guid, Type and `KeyedService.AnyKey`; custom object keys
  fail explicitly. A service resolved manually through `IServiceProvider` will
  not appear as a constructor dependency; an offline pre-exported extraction can
  explicitly declare an implementation-to-service `resolves` relationship for a
  known runtime lookup. The dependency-injection renderer distinguishes that
  dashed runtime link from constructor injection. Compiler-generated factory
  method names can change when lambdas are reordered; prefer named factory
  methods when that stability matters.
- **`database/v0`:** EF's actual relational `IModel` supplies `table` entities,
  `column` entities with string `data.type` and `data.databaseType` (both EF's
  store type, such as `nvarchar(200)`), primary/unique keys, indexes and check
  constraints. Foreign keys become `relation` relationships with ordered
  local/principal columns and delete behavior. Columns include nullability,
  lengths, precision, defaults, computed expressions, collation and value
  generation. IDs use schema/table/column or database constraint names,
  independent of CLR source paths. Table splitting/owned types are read from the
  relational model rather than guessed from entity classes. Views, sequences and
  provider-specific annotations are currently not represented; this is a model
  projection, not a comparison with a running database. The application's EF
  Core 6 or newer with a relational provider is required; fields an older
  version lacks (such as descending index columns before EF Core 7) are `null`.

Already-exported protocol-v0 extractions may be read with
`"inputs": { "snapshot": "snapshots/api.json" }` without trust or an SDK. They
must match the extractor's schema and required API/column data contracts.
Pre-exported extractions are an optional import mode, not the native
implementation.

## Building the helper

`npm run build` (`packages/cli/scripts/build.mjs`) runs `scripts/publish.mjs`,
which uses `dotnet publish -c Release` with the .NET 8 SDK or newer (`dotnet` on
PATH or `PROJECTIONS_DOTNET_EXECUTABLE`) in locked mode against
`packages.lock.json`, then embeds `helper/publish/` in
`packages/cli/dist/projections`. The only package references are Roslyn's
reference assemblies with `ExcludeAssets="runtime"`, so publishing fails if any
NuGet package would be redistributed or any file other than the three helper
files appears; the helper therefore adds nothing to `THIRD_PARTY_NOTICES.txt`.
Restoring those reference packages needs NuGet access (or a populated package
cache) at build time only. Without a usable SDK, the build prints a warning and
omits the helper; set `PROJECTIONS_REQUIRE_HELPERS=1` to fail instead (CI does
when `native` is enabled). SDK failures such as restore or compile errors always
fail the build. After changing package references, regenerate the lock file with
`dotnet restore helper/Projections.Dotnet.csproj --force-evaluate`.

## Validation and CI

Ordinary tests exercise validated pre-exported imports and trust checks:

```sh
cargo test -p projections-cli --test collectors
cargo test -p projections-extractor-dotnet-support
```

Native tests publish the helper, prime a package cache with only the fixture
projects' packages, and then extract with no NuGet sources at all, proving the
helper is never restored at extraction time. They compile real C# fixture
projects (`tests/fixtures/application`), run the SDK's Roslyn with its source
generators and `.editorconfig` severities, execute real service composition and
build a SQLite EF relational model without connecting to a database. A
repository `nuget.config` that names its own `globalPackagesFolder` is restored
from that folder, not from the user's. They verify file/body/private-state API
nonchanges, overloads, generic constraints and generated members, changed public
defaults, all registration forms, lifetime changes, keys/indexes/relations and
schema changes. The host fixtures (`tests/fixtures/hosts`) cover
`CreateHostBuilder` (with the `Development` default, an explicit environment and
context selection), `CreateWebHostBuilder` with a `Startup` class and an
`IDesignTimeDbContextFactory<T>` that takes precedence, and minimal hosting
behind a catch-all handler, with ASP.NET Core loaded from the installed shared
framework; none of their hosts may start:

```sh
PROJECTIONS_NATIVE_DOTNET=1 \
PROJECTIONS_DOTNET_EXECUTABLE=/path/to/dotnet \
cargo test -p projections-cli --test native_tools native_dotnet
```

`PROJECTIONS_NODE` selects the Node used to run the publish script.
`PROJECTIONS_DOTNET_SDK_VERSION=8.0.100` writes a `global.json` that selects
another installed SDK for the fixtures; add `DOTNET_ROLL_FORWARD=Major` to also
run the helper on the oldest compatible runtime instead of the newest.

The shared CI switch `PROJECTIONS_NATIVE_TESTS=1` also enables this suite;
`PROJECTIONS_NATIVE_DOTNET=1` remains available for .NET-only runs. The
installed proofs (`npm run test:installed`, and `npm run test:binary` on every
release platform) check that the unpacked helper contains only its three files
and run `dotnet-public-api` from the standalone executable.

An enabled native switch **fails**, rather than skips, when SDKs, NuGet
packages, provider native dependencies or builds are missing/broken. CI should
provision Rust and .NET 8 with `actions/setup-dotnet` (`dotnet-version: 8.0.x`),
then execute the command above with `dotnet` on PATH. Cache NuGet packages, not
historical application binaries. The Projections build needs HTTPS to the
configured NuGet feed (this repository's `nuget.config` selects
packagefeedproxy.microsoft.io; or a prepopulated cache) to publish the helper;
extraction needs feeds only for the inspected project's own restore.
Restore/build failures include stdout and stderr, including `NU1301`/TLS/proxy
diagnostics; do not replace failed execution with pre-exported output. Check
DNS, proxy allowlisting and CA trust before retrying NuGet failures; do not
disable TLS validation.

Local verification used macOS arm64 with SDKs 8.0.425 and 9.0.318 (runtimes
8.0.31 and 9.0.20): SDK 9 with the helper on runtime 9.0.20 (the default), SDK 8
(Roslyn from `sdk/8.0.425`) on runtime 9.0.20, and SDK 8 with
`DOTNET_ROLL_FORWARD=Major` (runtime 8.0.31). Shared compiler and build-server
reuse are disabled so independent runs do not inherit another SDK's Roslyn
assemblies.
