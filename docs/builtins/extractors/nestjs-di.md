# NestJS dependency injection

This extractor maps the modules, providers, and controllers of a NestJS
application—including each provider's scope and which provider satisfies every
dependency across module imports—exactly as Nest's container resolves them.
Compared across a pull request, it shows which providers were added, removed, or
rewired, and whether any scope changed.

<!-- generated: facts -->

- ID: `nestjs-di`
- Extraction schema:
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Drawn by default with:
  [`dependency-injection`](../renderers/dependency-injection.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*.module.ts`

<!-- end generated: facts -->

## When to use it

Use this extractor in NestJS applications where edits to `providers`, `imports`,
and `exports` shape what every class receives. It makes it easy to spot a new
provider and its dependencies, a `useClass` swapped behind an abstract class, a
provider turning request-scoped (and pulling every dependent into per-request
instantiation along with it), or a token now resolving from a different module.
Because it queries Nest's own container composition, you see the resolved graph
rather than a static parse of decorators.

Loading your application's modules executes import-time code, so extraction
requires `--trust` (see [What it reads](#what-it-reads)). For .NET use
[`dotnet-di`](dotnet-di.md), and for Spring Boot use
[`spring-di`](spring-di.md)—all three emit the same model.

## What it reads

In most repositories, it works out of the box with no extra configuration:

- **The root module** is discovered from your bootstrap file (`src/main.ts`, or
  the single source file calling `NestFactory`) via `NestFactory.create`,
  `createApplicationContext`, or `createMicroservice`. Use `entry` to point at a
  different bootstrap file, or `module` to name the root module directly
  (`apps/api/src/app.module.ts#AppModule`) in a monorepo with multiple apps.
- **The project's own toolchain** must be installed in the checkout: Node.js 20
  or newer, `typescript` (5.x or 6.x), and `@nestjs/core` (9.3 or newer).
  Projections bundles neither, so run your package manager's install first.
  Source files are transpiled to CommonJS on the fly using the compiler options
  from `tsconfig` (defaulting to the nearest one to the root module).
- **Nest's preview mode** composes the root module via
  `NestFactory.createApplicationContext(root, {preview: true, snapshot: true})`,
  scanning modules and resolving dependencies without instantiating providers or
  invoking factories. Your bootstrap file (`app.listen`) never runs, though
  importing modules still executes top-level code, decorators, and dynamic
  module factories (`ConfigModule.forRoot(...)`)—which is why `--trust` is
  needed.
- **Or a file.** Pass `snapshot` to load a previously exported extraction with
  nothing executed and no `--trust` required.

Each provider or controller in a module becomes a `service` (its token within
that module), a `registration` (its scope and kind: `class`, `value`, `factory`,
or `alias` for `useExisting`), and an `implementation` (the class or factory
function). Dependencies come from Nest's serialized graph—the same data Nest
Devtools inspects—so every constructor, property, and factory injection points
to the exact provider Nest resolved across imports and re-exports. Modules are
also captured as entities with their declared `imports` and provided services.
By default (`include: application`), the graph keeps your application's modules
plus the framework providers they inject; set `include: all` to include every
Nest-internal provider as well.

## Options

<!-- generated: inputs -->

| Input      | Meaning                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------ |
| `entry`    | Bootstrap file calling NestFactory; default src/main.ts or the one file that does.         |
| `include`  | application (default: application modules and the framework providers they inject) or all. |
| `module`   | Root module as <file>#<class>, instead of the bootstrap file's.                            |
| `snapshot` | Pre-exported DI state.                                                                     |
| `tsconfig` | tsconfig.json path; default the nearest to the root module.                                |

<!-- end generated: inputs -->

## What a comparison shows

The [`dependency-injection`](../renderers/dependency-injection.md) renderer
combines each provider's token, registration, and implementation into a single
card. A line style indicates scope—solid for default singleton, dashed for
request-scoped, dotted for transient—with solid arrows for injections and dotted
alias arrows for `useExisting`:

- **Added or removed providers** appear alongside their dependencies.
- **Scope changes** appear as lifetime updates
  (`Lifetime Transient → Singleton`). Nest's scope bubbling shows up clearly:
  when a provider turns request-scoped, every default-scoped provider that
  injects it becomes request-scoped too, with an accessible label noting that
  Nest overrode its declared lifetime.
- **Swapped implementations** behind an unchanged token (such as
  `useClass: StripeGateway` to `AdyenGateway`) are called out on the card while
  leaving callers untouched.
- **Added, removed, or rewired dependencies** are listed right on each card by
  target.

The summary bar tallies services, registrations, implementations, modules,
dependencies, and aliases with their deltas, then summarizes changes on cards
present in both revisions (lifetimes, implementations, service types, and
registration counts). Clicking any count filters to the matching cards.
Comparisons open in Diff mode and also support Side by side, Animated, and Swipe
views. The graph fits the frame automatically unless text would shrink below 8
px, in which case large apps open at a readable size near the root with pan and
zoom controls.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "nestjs-di",
  "id": "nestjs-di",
  "renderer": "dependency-injection",
  "title": "NestJS dependency injection"
}
```

<!-- end generated: definition -->

## Limitations

- Because factories are never invoked, a `useValue` or `useFactory` provider's
  runtime class is recorded only when it is already known at composition time.
- Enhancers attached via decorators (`@UseGuards`, interceptors, pipes, filters)
  and middleware are not container registrations, whereas providers bound to
  `APP_GUARD` and similar tokens are included.
- Services are scoped to their owning module, so moving a provider to another
  module appears as a removal and an addition. Class tokens are identified by
  class name, falling back to file path only when two classes share the same
  name.
- Native ESM-only applications and Yarn Plug'n'Play are not supported (use
  `nodeLinker: node-modules` with Yarn).
- Nest's preview mode omits a few edge-case injections (such as property
  injection inside a request-scoped subtree); the extractor fills those in using
  Nest's lookup rules and marks them `derived`.

## Related

- [`dependency-injection`](../renderers/dependency-injection.md) is the renderer
  that draws this graph.
- [`dotnet-di`](dotnet-di.md) and [`spring-di`](spring-di.md) produce the same
  model for .NET and Spring Boot.
- [`typescript-public-api`](typescript-public-api.md) uses the same installed
  TypeScript toolchain.
- [The default comparator](../comparators/default.md) compares extractions
  across revisions.
- [One model for dependency injection](../../models/dependency-injection-model.md)
  explains how different containers map onto services, registrations, and
  implementations.

## How it works

See the [package README](../../../packages/extractors/nestjs-di/README.md) for
details on preview mode and how each provider kind is modeled.

## Build your own

Consider writing a custom extractor when Nest's container is not the composition
you need to review:

- **Another container**, such as InversifyJS, tsyringe, Angular injectors, or a
  hand-rolled composition root. Emit the same services, registrations, and
  implementations using the `dependency-injection/v0` vocabulary to reuse this
  renderer.
- **Facts the container does not track**, like the HTTP routes each controller
  serves, which guards and interceptors apply to them, or team ownership per
  module.
- **No code execution**, if CI cannot load your app under `--trust`. Export the
  graph from a test and load it via `snapshot`, or write a static extractor that
  reads module metadata from source.

Check the built-in options first: `module` and `entry` pick the application,
`include` widens or narrows the graph, and `snapshot` imports test-generated
exports. To flag specific changes—like a provider turning request-scoped—keep
this extractor and add a comparator file; to group cards by module, write a
custom renderer.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language—your
repository's toolchain, Node.js (`extract.mjs`), Python, or Go—to scaffold the
definition and a starter extractor under `.github/projections/<id>/`, paired
with the built-in graph renderer. You can also choose **Ask an agent to write
it** and describe what you want to see.

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
