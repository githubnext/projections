# NestJS dependency injection

The modules and providers of a NestJS application, and what each provider
injects, as Nest's own container resolves them: every provider and controller in
each module, with its scope and the provider that satisfies each of its
dependencies across module imports. Compared across a pull request, it answers
"which providers did this change add, remove or rewire, and did any scope
change?"

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

Use it for NestJS applications, where a module's `providers`, `imports` and
`exports` decide what every class receives: a new provider and what it injects,
a `useClass` swapped behind an abstract class, a provider made request-scoped
(and every provider that injects it, which Nest re-creates per request too), a
token now resolved from another module. It reads the composition Nest itself
computes, not decorators parsed from source.

It loads the application's modules, so it needs `--trust` (see
[What it reads](#what-it-reads)). For .NET use [`dotnet-di`](dotnet-di.md), for
Spring Boot [`spring-di`](spring-di.md); all three write the same model.

## What it reads

Usually nothing needs configuring:

- **The root module**: the class the bootstrap file (`src/main.ts`, or the one
  source file that calls `NestFactory`) passes to `NestFactory.create`,
  `createApplicationContext` or `createMicroservice`. `entry` names another
  bootstrap file, and `module` names the root module directly
  (`apps/api/src/app.module.ts#AppModule`), for a monorepo with several apps.
- **The project's own toolchain**: Node.js 20 or newer, and the repository's own
  `typescript` (5.x or 6.x) and `@nestjs/core` (9.3 or newer), installed in the
  checkout. Projections bundles neither: run your package manager's install
  first. Sources are transpiled to CommonJS as they load, with the compiler
  options of `tsconfig` (default the nearest to the root module).
- **Nest's preview mode.** The root module is composed with
  `NestFactory.createApplicationContext(root, {preview: true, snapshot: true})`,
  which scans every module and resolves every dependency as startup would, but
  creates no provider and calls no factory; the bootstrap file itself
  (`app.listen`) never runs. Loading the modules still runs their import-time
  code, decorators and module factories (`ConfigModule.forRoot(...)`), which is
  why it needs `--trust`.
- **Or a file.** `snapshot` imports an extraction exported earlier; nothing
  runs, and no trust is needed.

Each provider (or controller) in a module becomes a `service` (its token, in
that module), a `registration` (its scope and kind: `class`, `value`, `factory`
or `alias` for `useExisting`) and an `implementation` (the class, or the factory
function). Dependencies come from Nest's serialized graph, the data Nest
Devtools shows: each constructor, property and factory injection points at the
provider Nest actually resolved, across imports and re-exports. Modules are
entities too, with their declared `imports` and the providers they provide. By
default (`include: application`) it keeps the application's own modules and the
framework providers they inject; `include: all` adds every Nest-internal
provider.

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
folds each provider's token, registration and implementation into one card, with
its lifetime drawn as a line (continuous for the default scope, broken per
request, dotted for transient), an arrow for each injection, and a dotted alias
arrow for each `useExisting`:

- **Providers** added or removed, with their dependencies.
- **Scope changes**, as lifetime changes (`Lifetime Transient → Singleton`).
  Nest's scope bubbling is visible: when a provider becomes request-scoped, each
  default-scoped provider that injects it becomes scoped too, and its accessible
  label says Nest changed the lifetime it declared.
- **Implementations** replaced behind an unchanged token
  (`useClass: StripeGateway` to `AdyenGateway`): the card says so, and what
  injects the token is untouched.
- **Dependencies** added, removed or resolved to another provider, listed on the
  card by the cards they point at.

The summary bar counts the composition (services, registrations,
implementations, modules, dependencies and aliases, each with what was added,
removed and modified), then what changed about cards in both revisions:
lifetimes, implementations, service types and registration counts changed, each
filtering to its cards. A comparison starts as one diff, and plays as side by
side, animated or swipe too. It opens fitted to the frame unless that would draw
text smaller than 8 px; a large application then opens at that size, at its
root, and scrolls, with zoom controls.

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

- Factories are never called, so a `useValue` or `useFactory` provider's class
  is known only when it exists at composition.
- Enhancers bound with decorators (`@UseGuards`, interceptors, pipes, filters)
  and middleware aren't registrations; providers bound to `APP_GUARD` and
  similar tokens are.
- Services belong to their module: moving a provider to another module is a
  removal and an addition. Class tokens are identified by class name, and by
  file only when two classes share a name.
- Applications that run only as native ECMAScript modules aren't supported, and
  neither is Yarn Plug'n'Play (use `nodeLinker: node-modules`).
- Nest's preview mode leaves a few injections unrecorded (property injection
  into a request-scoped tree); those follow Nest's lookup rule and are marked
  `derived`.

## Related

- [`dependency-injection`](../renderers/dependency-injection.md), the renderer
  that draws it.
- [`dotnet-di`](dotnet-di.md) and [`spring-di`](spring-di.md), the same model
  for .NET and Spring Boot.
- [`typescript-public-api`](typescript-public-api.md), which uses the same
  installed TypeScript.
- [The default comparator](../comparators/default.md), which compares it.
- [One model for dependency injection](../../models/dependency-injection-model.md),
  how containers map onto services, registrations and implementations.

## How it works

The [package README](../../../packages/extractors/nestjs-di/README.md) details
preview mode and how each kind of provider is recorded.

## Build your own

Write your own extractor when Nest's container isn't the composition you need to
review:

- **Another container**: InversifyJS, tsyringe, Angular's injectors, or a
  hand-rolled composition root. An extractor that writes the same services,
  registrations and implementations (the `dependency-injection/v0` vocabulary)
  is drawn by the same renderer.
- **Facts the container doesn't have**: the routes each controller serves, the
  guards and interceptors that apply to them, or the team that owns each module.
- **No code execution**: when CI can't load the application with `--trust`,
  export the graph from a test and import it with `snapshot`, or write an
  extractor that reads module metadata statically.

Try the lighter options first: `module` and `entry` pick the application,
`include` widens or narrows what's shown, and `snapshot` imports a graph your
tests already export. To flag changes that matter to you (a provider becoming
request-scoped, say), keep this extractor and add a comparator file; to group
cards by module, write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language: the repository's
toolchain, Node.js (`extract.mjs`), Python or Go. It writes the definition and a
starter extractor under `.github/projections/<id>/`, drawn by the built-in graph
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
