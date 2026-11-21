# .NET dependency injection

This extractor maps the services a .NET application registers in its
`IServiceCollection` along with their lifetimes, implementations, and
constructor dependencies, by building the application's host without starting
it. Compared across a pull request, it shows which services were added, removed,
or rewired, and whether any service lifetime changed.

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

Use this extractor in ASP.NET Core and Generic Host applications where edits to
`Program.cs` or `Startup.ConfigureServices` shape what every request receives.
It makes it easy to spot a new service and its dependencies, an implementation
swapped behind an interface, a scoped service turned into a singleton, or a
second registration that now takes precedence. Because it inspects the
application's actual container, registrations added indirectly by extension
methods and libraries (`AddDbContext`, `AddHttpClient`) show up accurately.

Because extraction runs your application's startup registration code, it
requires `--trust` (see [What it reads](#what-it-reads)). For NestJS use
[`nestjs-di`](nestjs-di.md), and for Spring Boot use
[`spring-di`](spring-di.md)—all three emit the same model.

## What it reads

In most projects, you only need to set `project` to point at your application
project:

- **The project's own build.** It runs `dotnet build` into a scratch directory
  using the .NET SDK (8.0.100 or newer) selected by `global.json`, or the
  executable specified in `dotnet`.
- **The application's host**, discovered the same way `dotnet ef` finds it: a
  `CreateWebHostBuilder` or `CreateHostBuilder` method on the entry point type,
  or the entry point itself for minimal hosting
  (`WebApplication.CreateBuilder`). A final `ConfigureServices` callback
  captures the complete service collection and stops before creating a service
  provider. **The host never starts**, though your registration code (and, in
  minimal hosting, top-level code up to building the host) does execute—which is
  why `--trust` is required.
- **One environment**, configured via `environment` (default `Development`, or a
  granted `DOTNET_ENVIRONMENT` or `ASPNETCORE_ENVIRONMENT`). Just like under
  `dotnet ef`, a `Development` host can load your local user secrets; set a
  different environment if you want to avoid that.
- **Or an adapter.** Set `factoryType` and `factoryMethod` to a public static
  method that returns an `IServiceCollection` (for instance, by calling your
  production registration helper) instead of discovering the host. If you omit
  `project`, `assembly` lets you point at a prebuilt adapter in the repository.
- **Or a file.** Pass `snapshot` to read a previously exported
  extraction—nothing runs, and neither `--trust` nor the .NET SDK is required.

Each `ServiceDescriptor` becomes a `service` (its type and key), a
`registration` (its lifetime, its position among registrations for that service,
and whether it is backed by a type, factory, or instance), and an
`implementation` (the concrete type it constructs). Constructor dependencies are
recorded as `dependsOn` relationships from each implementation to the services
it injects, computed using the container's own rule (the greediest public
constructor whose parameters are all registered or have defaults) and marked
`derived`. `IEnumerable<T>` parameters, open generics, and `[FromKeyedServices]`
resolve the same way the container resolves them. The snapshot is complete and
includes host and framework registrations. Entity IDs use the assembly and full
type name, so renaming or moving a class appears as a removal and an addition.

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
combines each service, its registration, and its implementation into a single
card. A line style indicates lifetime—solid for singleton, dashed for scoped,
dotted for transient—and arrows trace constructor dependencies:

- **Added or removed services** appear alongside their dependencies.
- **Modified registrations** show lifetime shifts directly on the card
  (`Lifetime Scoped → Singleton`) instead of treating them as replacements.
- **Swapped implementations** behind an unchanged service are highlighted on the
  card while leaving downstream dependents untouched.
- **Added, removed, or rewired dependencies** are listed right on the card by
  target (`− IPricing + IPriceCalculator`).
- **Multiple registrations** for the same service stack with a `×n` badge, where
  the last registration is the one resolved for single injections.

The summary bar tallies the container composition
(`10 services +2 −1 · 11 registrations +2 −1 ~1 · 11 implementations +2 −1 · 10 dependencies +3 −2`)
and highlights what changed on cards present in both revisions—such as
`1 lifetime changed` or shifts in implementations, service types, and
registration counts. Clicking any count filters the graph to those cards.
Comparisons open in Diff mode and also support Side by side, Animated, and Swipe
views. The graph fits the frame automatically unless text would shrink below 8
px, in which case large containers open at a readable size near the root with
pan and zoom controls.

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

- Factory registrations (`sp => new Foo(...)`) are delegates whose behavior is
  determined at runtime, so they do not record an implementation or dependency
  arrows. Pre-constructed instances are not serialized.
- Services resolved manually from `IServiceProvider` do not appear as
  dependencies automatically, though a `snapshot` can declare them as `resolves`
  relationships (drawn with dashed arrows).
- Keyed services require `Microsoft.Extensions.DependencyInjection` 8 or newer
  and stable keys (primitives, enums, `Guid`, `Type`, or `KeyedService.AnyKey`);
  custom object keys fail extraction.
- Pre-built hosts (`BuildWebHost`) cannot be intercepted—use a factory adapter
  instead. Decorators and interception proxies are not modeled.
- Compiler-generated lambda names shift when lambdas are reordered, so prefer
  named factory methods if diff stability matters.
- Startup code runs once per revision. With minimal hosting, anything your entry
  point runs before building the host (such as opening a database connection)
  will execute during extraction.

## Related

- [`dependency-injection`](../renderers/dependency-injection.md) is the renderer
  that draws this graph.
- [`nestjs-di`](nestjs-di.md) and [`spring-di`](spring-di.md) produce the same
  model for NestJS and Spring Boot.
- [`efcore-schema`](efcore-schema.md) and
  [`dotnet-public-api`](dotnet-public-api.md) share the same .NET helper.
- [The default comparator](../comparators/default.md) compares extractions
  across revisions.
- [One model for dependency injection](../../models/dependency-injection-model.md)
  explains how different containers map onto services, registrations, and
  implementations.

## How it works

See the [package README](../../../packages/extractors/dotnet-di/README.md) for a
high-level overview, and
[.NET support](../../../packages/extractors/dotnet-support/README.md) for host
discovery, the adapter contract, and NuGet handling.

## Build your own

Consider writing a custom extractor when Microsoft's built-in container does not
capture the wiring you need to review:

- **Another container**, such as Autofac modules, Lamar, Simple Injector,
  MediatR handlers and pipeline behaviors, or Scrutor decorators. Emit the same
  services, registrations, and implementations using the
  `dependency-injection/v0` vocabulary to reuse this renderer.
- **Facts the container does not know**, like which HTTP endpoints reach each
  service, team ownership, or configuration bound into `IOptions<T>`.
- **No code execution**, if CI cannot run startup code under `--trust`. You can
  export the service collection from a test and load it via `snapshot`, or write
  a static extractor that parses registrations from source.

Check the built-in options first: `environment` selects the host environment,
`factoryType` and `factoryMethod` target just the registrations you care about,
and `snapshot` imports test-generated exports. To flag risky changes—such as a
singleton capturing a scoped service—keep this extractor and add a comparator
file; to group cards by project or layer, write a custom renderer.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language (your
repository's toolchain, Node.js, Python, or Go) to scaffold the definition and a
starter extractor under `.github/projections/<id>/`, paired with the built-in
graph renderer. You can also choose **Ask an agent to write it** and describe
what you want to see.

**With the CLI**, scaffold a new extractor while keeping the
`dependency-injection` renderer:

```sh
projections init <id> --language node --renderer dependency-injection
```

Run `projections show -p <id> --trust` while you iterate—an open projection tab
picks up your uncommitted edits ("Your edits") and flags stale results, and the
Testing view runs your projection's checks. Walk through
[Write your first extractor](../../guides/first-extractor.md) to get started,
and check [Extraction schema](../../guides/schemas.md#extraction-schema) for the
output format.
