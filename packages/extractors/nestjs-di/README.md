---
description: "A NestJS application's providers and dependencies (nestjs-di)"
---

# NestJS dependency injection — `nestjs-di`

The providers, modules and dependency graph of a NestJS application, read from
**Nest's own container** through the repository's installed `@nestjs/core`. It
writes `architecture/v0` in the shared
[dependency-injection model](../../../docs/models/dependency-injection-model.md),
for the
[dependency-injection renderer](../../renderers/dependency-injection/README.md).

```json
{
  "id": "services",
  "extractor": "nestjs-di",
  "renderer": "dependency-injection"
}
```

Usually no inputs are needed. The bootstrap file is `src/main.ts` (or the one
source file that calls `NestFactory`), and the root module is the class it
passes to `NestFactory.create`, `createApplicationContext` or
`createMicroservice`.

<!-- prettier-ignore -->
| Input | Meaning |
| --- | --- |
| `entry` | The bootstrap file, when there is no `src/main.ts` and more than one file calls `NestFactory` (a monorepo with several apps) |
| `module` | The root module as `<file>#<exported class>`, for example `apps/api/src/app.module.ts#AppModule`; overrides `entry` |
| `tsconfig` | The tsconfig whose compiler options load the application; default the nearest `tsconfig.json` to the root module |
| `include` | `application` (default): the application's modules' providers and controllers, plus the framework providers they inject. `all`: every module and provider, including Nest's internal core module |
| `snapshot` | A pre-exported `architecture/v0` state to import instead (no trust needed) |

## How it works

The extractor runs in the Node helper shipped with Projections
([TypeScript support](../typescript-support/README.md)) and uses nothing but the
project's own toolchain:

1. The repository's own `typescript` reads the bootstrap file to find the root
   module, and transpiles application sources as they load (CommonJS, with the
   legacy decorators and decorator metadata Nest requires; `paths` aliases and
   `./file.js` specifiers resolve to sources).
2. The root module is loaded and composed with
   `NestFactory.createApplicationContext(root, {preview: true, snapshot: true})`.
   **Preview mode** scans every module and resolves every dependency, exactly as
   startup would, but instantiates no provider and invokes no factory. The
   bootstrap file itself (`app.listen`) never runs.
3. Edges come from Nest's **serialized graph**, the data Nest Devtools reads:
   each constructor and property injection resolved to the provider, in the
   module, that satisfies it. Those are `authoritative`. Preview leaves a few
   injections unrecorded (property injection into a request-scoped tree); those
   follow Nest's module-scoped lookup of the declared token and are `derived`.

Loading the root module runs the application's import-time code, decorators and
module factories (`ConfigModule.forRoot(...)`), so the extractor requires
`--trust`. The working directory is the application's package directory, as when
it starts. Application output never reaches stdout.

## What it writes

<!-- prettier-ignore -->
| Nest | Entities and relationships |
| --- | --- |
| A provider (or controller) in module `M` under token `T` | `service:M:<token>` → `registration` → `implementation` |
| Token | `class:Name`, `string:VALUE` or `symbol:description` in `data.token`, with `data.tokenKind` |
| `useClass` / a class provider | `registrationKind: "class"`; the implementation is the class |
| `useValue` | `registrationKind: "value"`; an implementation only when the value is an instance of a named class |
| `useFactory` | `registrationKind: "factory"`; the implementation is the factory function (`systemClock()`), and its `inject` list is its dependencies |
| `useExisting` | `registrationKind: "alias"` and an `aliases` relationship to the service it forwards to; no implementation |
| Scope `DEFAULT` / `REQUEST` / `TRANSIENT` | `data.scope`, and `data.lifetime` `singleton` / `scoped` / `transient`. A default-scoped provider that injects a request-scoped one is itself re-created per request: `lifetime: "scoped"` with `declaredLifetime: "singleton"` |
| Durable providers | `data.durable: true` |
| Constructor, `@Inject()` and property injection, `@Optional()` | `dependsOn` from the implementation to the resolved service, with `parameter`, `position`, `injection` (`constructor`, `property` or `factory`), the requested `token` and `optional` |
| Modules | `module` entities (`global`, `origin`, `root`), declared `imports` (a global module is not an import of every module) and `provides` to their registrations; `data.exported` on services and registrations |

Services are module-scoped: a token provided in two modules is two services, and
a dependency points at the one Nest actually resolved across module boundaries.
`data.origin` is `application` for providers declared in the application's own
modules and `framework` otherwise.

## Requirements

- Node.js 20 or newer, the repository's own `typescript` (5.x or 6.x) and
  `@nestjs/core` 9.3 or newer (preview mode and the serialized graph), installed
  in the repository checkout. Projections bundles neither.
- CommonJS output: an application that only runs as native ECMAScript modules is
  not supported.

## Limitations

- Enhancers bound with decorators (`@UseGuards`, interceptors, pipes, filters)
  and middleware are not registrations; providers bound to `APP_GUARD` and
  similar tokens are.
- Factories are never invoked, so a value or factory provider's implementation
  type is known only for values that exist at composition.
- Class tokens are identified by class name, disambiguated by defining file only
  when two classes share a name.

## Validation

The sample application under `tests/fixtures/app` (with the `after` overlay
adding a service, making a transient provider a singleton and swapping a payment
gateway) runs against the workspace's lockfile-pinned NestJS 11 in
`npm test --workspace @githubnext/projections-typescript-support`
([`test/nestjs.test.ts`](../typescript-support/test/nestjs.test.ts)).
`tests/fixtures/nestjs.json` is its extraction, imported by the Rust tests.
