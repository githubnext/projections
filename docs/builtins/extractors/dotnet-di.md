# .NET dependency injection

The services a .NET application registers with its container, and what each
one's constructor asks for: every registration in the application's
`IServiceCollection`, with its lifetime and implementation, read by building the
application's host without starting it. Compared across a pull request, it
answers "which services did this change add, remove or rewire, and did any
lifetime change?"

<!-- generated: facts -->

- ID: `dotnet-di`
- Extraction schema:
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Drawn by default with:
  [`dependency-injection`](../renderers/dependency-injection.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/Program.cs`, `**/Startup.cs`

<!-- end generated: facts -->

## When to use it

Use it for ASP.NET Core and Generic Host applications, where a change to
`Program.cs` or `Startup.ConfigureServices` changes what every request gets: a
new service and what it depends on, an implementation swapped behind an
interface, a scoped service made a singleton, a second registration that now
wins. Because it asks the application's own container, registrations made by
extension methods and libraries (`AddDbContext`, `AddHttpClient`) appear as they
really are.

It runs the application's startup code, so it needs `--trust` (see
[What it reads](#what-it-reads)). For NestJS use [`nestjs-di`](nestjs-di.md),
for Spring Boot [`spring-di`](spring-di.md); all three write the same model.

## What it reads

Usually only `project`, the application project:

- **The project's own build.** It runs `dotnet build` for the project into a
  scratch directory, with the .NET SDK 8.0.100 or newer that `global.json`
  selects (or the `dotnet` input).
- **The application's host, found as `dotnet ef` finds it**: a
  `CreateWebHostBuilder` or `CreateHostBuilder` method on the entry point's
  type, or the entry point itself for minimal hosting
  (`WebApplication.CreateBuilder`). A last `ConfigureServices` callback captures
  the complete service collection, and the build stops before any service
  provider exists: **the host never starts**, but your registration code (and,
  for minimal hosting, the entry point up to building the host) runs, which is
  why it needs `--trust`.
- **One environment**, `environment` (default `Development`, or a granted
  `DOTNET_ENVIRONMENT` or `ASPNETCORE_ENVIRONMENT`). A `Development` host can
  read your user secrets, as it does under `dotnet ef`; set another environment
  to avoid that.
- **Or an adapter.** `factoryType` and `factoryMethod` name a public static
  method that returns the `IServiceCollection` (for example by calling the same
  registration function production uses), instead of the host. Without
  `project`, `assembly` is a prebuilt adapter in the repository.
- **Or a file.** `snapshot` imports an extraction exported earlier; nothing
  runs, and no trust or SDK is needed.

Each `ServiceDescriptor` becomes a `service` (its type and key), a
`registration` (its lifetime, its order among the service's registrations and
how it is made: type, factory or instance) and an `implementation` (the type it
constructs). Constructor dependencies are `dependsOn` relationships from an
implementation to the services it injects, worked out by applying the
container's own rule (the greediest public constructor whose parameters are all
registered or defaulted), so they are `derived`. `IEnumerable<T>` parameters,
open generics and `[FromKeyedServices]` resolve as the container resolves them.
The collection is complete: host and framework registrations are included. IDs
are the assembly and full type name, so renaming or moving a class is a removal
and an addition.

## Options

<!-- generated: inputs -->

| Input           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `assembly`      | Application assembly; default the project's build output.                |
| `dotnet`        | The dotnet executable path, not a shell command; default dotnet on PATH. |
| `environment`   | Context environment; default Development.                                |
| `factoryMethod` | Optional static factory method.                                          |
| `factoryType`   | Optional factory type full name; default the application's host.         |
| `project`       | Application project path.                                                |
| `snapshot`      | Pre-exported DI state.                                                   |

<!-- end generated: inputs -->

## What a comparison shows

The [`dependency-injection`](../renderers/dependency-injection.md) renderer
folds each service, its registration and its implementation into one card, with
its lifetime drawn as a line (continuous for a singleton, broken per scope,
dotted for transient) and an arrow for each constructor dependency:

- **Services** added or removed, with their dependencies.
- **Registrations** modified: a lifetime change modifies the registration rather
  than replacing it (`Lifetime Scoped → Singleton`).
- **Implementations** replaced behind an unchanged service: the card says so,
  and everything that depends on the service is untouched.
- **Dependencies** added, removed or rewired, listed on the card by the cards
  they point at (`− IPricing + IPriceCalculator`).
- **Several registrations** of one service stack as `×n`; the last is the one a
  single injection gets.

The summary bar counts the composition
(`10 services +2 −1 · 11 registrations +2 −1 ~1 · 11 implementations +2 −1 · 10 dependencies +3 −2`),
then what changed about cards in both revisions: `1 lifetime changed`, and
implementations, service types and registration counts changed, each filtering
to its cards. A comparison starts as one diff, and plays as side by side,
animated or swipe too. It opens fitted to the frame unless that would draw text
smaller than 8 px; a large container then opens at that size, at its root, and
scrolls, with zoom controls.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "dotnet-di",
  "id": "dotnet-di",
  "inputs": {
    "project": "src/App/App.csproj"
  },
  "renderer": "dependency-injection",
  "title": ".NET dependency injection"
}
```

<!-- end generated: definition -->

## Limitations

- Factory registrations (`sp => new Foo(...)`) are delegates: what they resolve
  is decided when they run, so they have no implementation and no dependency
  arrows. Instances aren't serialized.
- A service resolved by hand from `IServiceProvider` isn't a dependency; a
  `snapshot` can declare it as a `resolves` relationship, drawn dashed.
- Keyed services need the application's
  `Microsoft.Extensions.DependencyInjection` 8 or newer, and only stable keys
  (primitives, enums, `Guid`, `Type`, `KeyedService.AnyKey`); custom object keys
  fail.
- A host that is already built (`BuildWebHost`) can't be read; use an adapter.
  Decorators and interception aren't modelled.
- Compiler-generated factory names change when lambdas are reordered; prefer
  named factory methods where that matters.
- Startup code runs for each revision: with minimal hosting, whatever the entry
  point does before it builds the host (connecting to a database, say) happens
  during extraction.

## Related

- [`dependency-injection`](../renderers/dependency-injection.md), the renderer
  that draws it.
- [`nestjs-di`](nestjs-di.md) and [`spring-di`](spring-di.md), the same model
  for NestJS and Spring Boot.
- [`efcore-schema`](efcore-schema.md) and
  [`dotnet-public-api`](dotnet-public-api.md), which share its .NET helper.
- [The default comparator](../comparators/default.md), which compares it.
- [One model for dependency injection](../../models/dependency-injection-model.md),
  how containers map onto services, registrations and implementations.

## How it works

The [package README](../../../packages/extractors/dotnet-di/README.md)
summarizes it, and
[.NET support](../../../packages/extractors/dotnet-support/README.md) details
host discovery, the adapter contract and NuGet handling.

## Build your own

Write your own extractor when the Microsoft container's registrations aren't the
composition you need to review:

- **Another container**: Autofac modules, Lamar or Simple Injector, MediatR
  handlers and pipeline behaviors, or decorators applied by Scrutor. An
  extractor that writes the same services, registrations and implementations
  (the `dependency-injection/v0` vocabulary) is drawn by the same renderer.
- **Facts the container doesn't have**: which endpoints reach each service, the
  team that owns it, or the configuration bound into `IOptions<T>`.
- **No code execution**: when CI can't run startup code with `--trust`, export
  the collection from a test and import it with `snapshot`, or write an
  extractor that reads registrations statically.

Try the lighter options first: `environment` picks the configuration,
`factoryType` and `factoryMethod` point it at the registrations that matter, and
`snapshot` imports a collection your tests already export. To flag changes that
matter to you (a singleton that now captures a scoped service, say), keep this
extractor and add a comparator file; to group cards by project or layer, write a
renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language: the repository's
toolchain, Node.js, Python or Go. It writes the definition and a starter
extractor under `.github/projections/<id>/`, drawn by the built-in graph
renderer. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, keep the `dependency-injection` renderer:

```sh
projections init <id> --language node --renderer dependency-injection
```

Run it with `projections show -p <id> --trust` as you change it; an open
projection tab uses your uncommitted edits ("Your edits") and says when its
results are out of date, and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
