# One model for dependency injection

Status: **adopted**. Three built-in extractors write this model —
[`dotnet-di`](../../packages/extractors/dotnet-di/README.md) (.NET),
[`nestjs-di`](../../packages/extractors/nestjs-di/README.md) (NestJS), and
[`spring-di`](../../packages/extractors/spring-di/README.md) (Spring Boot) — and
the
[dependency-injection renderer](../../packages/renderers/dependency-injection/README.md)
presents all of them.

From a distance, dependency injection containers all look the same: something
asks for a service, and the container decides how to satisfy it and how long
that instance lives. Up close, they disagree on almost everything — what
identifies a service, whether module boundaries exist, what "transient" means,
and whether a factory is a black box.

This document lays out the shared model Projections uses across all three, why
its boundaries sit where they do, and how we handled the parts that don't line
up neatly. We built the model against real containers (.NET's
`Microsoft.Extensions.DependencyInjection`, NestJS's `@nestjs/core`, and
Spring's `DefaultListableBeanFactory`) and adjusted it only when an ecosystem
couldn't be expressed honestly.

## Ground rules

Every extractor asks **the application's own container**, running the
application's own version, what it will actually do. None of them parse source
code for decorators or annotations and guess:

- `dotnet-di` builds the application host the same way `dotnet ef` does, without
  starting it, and reads the resulting service collection.
- `nestjs-di` composes the root module through `NestFactory` in **preview
  mode**, resolving every dependency without instantiating providers, and reads
  Nest's serialized graph (the same data Nest Devtools displays).
- `spring-di` runs the application's main method with web serving disabled,
  records every dependency the bean factory resolves during context refresh, and
  stops before any runner executes.

Because the model captures _what the container decided_, differences between
ecosystems reflect real container semantics rather than extraction quirks. All
three execute application code and therefore require `--trust`.

## The boundaries

Each registration breaks down into three entities and one decision:

```
  service ──registration──▶ registration ──implements──▶ implementation
     ▲                                                        │
     └──────────────────────────dependsOn─────────────────────┘
                     (from another implementation)
```

<!-- prettier-ignore -->
| Entity | What it is | Why it is separate |
| --- | --- | --- |
| **service** | What a consumer asks the container for: a type, a token or a name | Consumers depend on services, never on implementations. Two consumers asking for the same service get whatever the container decides. |
| **registration** | The binding the container holds: which implementation, with which lifetime, how it is produced | One service can have several registrations (.NET); a registration's lifetime or implementation can change while the service stays the same. That change is the most common thing a pull request does to a container. |
| **implementation** | What the container runs to produce an instance: a class's constructor, or a factory | It is what has dependencies. Swapping it is a different change from changing the contract. |

**Lifetime** belongs to the registration, not the service or implementation,
because the same class can be registered as a singleton in one place and
transient in another.

Dependencies run from an **implementation** to a **service** (`dependsOn`): the
code being constructed asks for a contract. Because the renderer derives
composition from those endpoint kinds rather than relationship names, even an
extractor using different edge names still composes cleanly.

Separating these three entities instead of collapsing them into a single "bean"
or "provider" node is what makes diffs readable. When a pull request swaps
`StripeGateway` for `AdyenGateway` behind `PaymentGateway`, only the
registration changes and the implementation is replaced; everything depending on
`PaymentGateway` stays untouched. With a single node per binding, every
consumer's edge would light up as changed.

## Vocabulary

Everything here is standard `architecture/v0` ([contracts](../contracts.md)) —
entity kinds, relationship kinds, and `data` fields — with unused fields
omitted. Extractions declare `"vocabularies": ["dependency-injection/v0"]`, and
the engine validates the fields renderers rely on (listed in
[`vocabularies/dependency-injection`](../reference/schemas/vocabularies-dependency-injection.md));
the remaining fields are documented here and stay open.

<!-- prettier-ignore -->
| Item | Fields |
| --- | --- |
| `service` | `type` (the contract; the label otherwise), `key` (a keyed service's key), `name` (the container's own name for it), `aliases` (other names), `token`, `tokenKind`, `module`, `exported` |
| `registration` | `lifetime` (`singleton`, `scoped` or `transient`; read case-insensitively), `scope` (the container's own name for it), `declaredLifetime` (when the container overrode the declared lifetime), `ordinal`, `registrationKind`, `implementation`, `factory`, `primary`, `fallback`, `qualifiers`, `lazy`, `proxied`, `conditions`, `initializedAfter`, `module`, `exported`, `role`, `origin` |
| `implementation` | `type`, or `factory` for a factory function |
| `registration` (service → registration) | The binding |
| `implements` (registration → implementation) | What the registration produces |
| `dependsOn` (implementation → service) | `parameter`, `position`, `injection` (`constructor`, `property`, `field`, `method`, `factory`, `factory-method`), the requested `token` or `requestedType`, `qualifier`, `optional`, `collection`, `lazy` |
| `aliases` (registration → service) | A registration that forwards to another service instead of producing an instance |
| `resolves` (implementation → service) | A service looked up from a scope at run time rather than injected |
| `module`, `imports`, `provides` | A module boundary (NestJS), its declared imports and the registrations it provides |

Relationships carry a `confidence` level: `authoritative` when the container
itself recorded the resolution, and `derived` when the extractor applied the
container's own rules to something the container didn't resolve during
extraction (see each extractor's README).

## How each ecosystem maps

<!-- prettier-ignore -->
| | .NET | NestJS | Spring |
| --- | --- | --- | --- |
| **Service identity** | Service type and key | Token, in the module that provides it | Bean name |
| **Contract** | The service type | The token: a class, an abstract class, a string or a symbol | The bean's registered type: a `@Bean` method's return type, or the component class |
| **Registration** | A `ServiceDescriptor`; several per service, in order | A provider in a module; one per token per module | A bean definition (or a registered singleton); one per name |
| **Implementation** | The implementation type, or the instance's type | The `useClass` class, or the `useFactory` function | The instance's class |
| **Implementation granularity** | One per type | One per provider | One per bean |
| **Lifetimes** | `Singleton`, `Scoped`, `Transient` | `DEFAULT`, `REQUEST`, `TRANSIENT` (+ durable) | `singleton`, `prototype`, `request`, `session`, `application`, custom |
| **Factories** | Opaque delegates | `useFactory` with an explicit `inject` list | `@Bean` methods, with parameters |
| **Selection among several** | The last registration wins; `IEnumerable<T>` gets all | One per token in scope; lookup follows module imports | `@Primary`, `@Fallback`, qualifiers, parameter name |
| **Keys and names** | Keyed services (`[FromKeyedServices]`) | String and symbol tokens | Bean names, aliases, qualifiers |
| **Boundaries** | One container | Modules, imports, exports, global modules | One bean factory (parent contexts aside) |

### .NET

Because the model originated with .NET, the mapping is direct: a
`ServiceDescriptor` becomes a registration, its service type and key identify
the service, and its implementation or instance type is the implementation.
Multiple registrations for the same service keep their order (`ordinal`), with
the last one winning for single injections — shown by the renderer as a stacked
`×n` card.

Factory registrations are opaque delegates receiving an `IServiceProvider`.
Because nothing records what they resolve at runtime, they appear as
`registrationKind: "factory"` with no implementation or dependency edges.
Constructor dependencies are derived per type using the container's own
constructor-selection rules.

### NestJS

In NestJS, a **token** defines the contract — typically a class (often an
abstract class standing in for a TypeScript interface, which gets erased at
runtime), a string, or a symbol. Each provider is a registration: `useClass` and
class providers have a class implementation, `useFactory` has a factory
implementation whose `inject` list supplies its dependencies, `useValue` gets an
implementation only if the value is an instance of a named class, and
`useExisting` maps to an alias (see below).

Rather than one global container, Nest scopes providers per **module**: a
provider is visible inside its own module and, if exported, to importing
modules. Registering the same token in two modules creates two distinct
instances. A Nest service is therefore identified by _(module, token)_, and
dependency edges point to the service in the module where Nest actually resolved
it across imports and re-exports. Modules are modeled as their own entities.

### Spring

A Spring bean factory maps **bean names** to bean definitions, and every lookup
— even injection by type — resolves to a name. A Spring service's identity is
therefore its bean name. Its `type` is the registered contract: the return type
of a `@Bean` method (often an interface), or the component class itself for
scanned components. The implementation is the actual class instantiated by the
container, with generated CGLIB and AOP proxies unwrapped back to the user's
class.

Even though consumers usually ask for a _type_ rather than a name, the
`dependsOn` edge records what was requested (`requestedType`, `qualifier`) while
pointing at the **bean Spring actually chose** — showing the real runtime
wiring.

## What doesn't fit, and what we did

### Identity: type, token or name

Rather than forcing a single universal key, the model follows each container's
native key: _(type, key)_ in .NET, _(module, token)_ in NestJS, and bean name in
Spring. Forcing "requested type" everywhere would collapse distinct services —
two `Clock` beans (`systemClock` and `utcClock`) are separate services in Spring
and belong on separate cards. Whenever two cards would otherwise look identical,
the renderer displays the container's own name for each.

### Several candidates and `@Primary`

.NET keeps every registration for a service, letting the last one win for single
injections while `IEnumerable<T>` receives all of them. Spring never has two
registrations under the same name; instead, multiple _beans_ can match a
requested type, and `@Primary`, `@Fallback`, qualifiers, or parameter names pick
the winner.

Because those are genuinely different mechanisms, we represent them differently:
.NET stacks registrations with `ordinal` values, whereas Spring records the
decision where it occurred — pointing `dependsOn` at the selected bean and
attaching `primary`, `fallback`, and `qualifiers` to the registration. Moving
`@Primary` from one bean to another then shows up as dependency arrows moving,
which is exactly what changed at runtime.

### Collections

Collection injections (`IEnumerable<T>`, `List<T>`, `Map<String, T>`) carry
`collection: true`. In .NET, a collection resolves every registration of one
service, so it is a single edge to that service. In Spring, each element is its
own bean, so it becomes one edge per bean sharing the same parameter name.

### Contract and implementation

.NET separates service type from implementation type on every registration.
Spring does so for `@Bean` methods (declared return type vs. instance class),
while scanned components register under their own class and show a single name
on the card. NestJS separates them whenever the token differs from the class
(`{provide: PaymentGateway, useClass: StripeGateway}`). The model handles both
naturally: when implementation equals contract, it's simply "registered as its
own type."

### Per-type or per-registration implementations

Because .NET derives constructor dependencies from the type itself, every
registration of `OrderService` shares one implementation entity and one set of
edges. In NestJS and Spring, dependencies belong to the registration (a
factory's `inject` list, a `@Bean` method's parameters, or module-scoped
resolution), so they emit one implementation per registration. The model
supports both, and the renderer folds whatever implementations a service's
registrations reference into its card.

### Factories

Factories are where the three containers diverge most. A .NET factory is an
opaque delegate whose resolutions happen at runtime, so `dotnet-di` records it
without dependency edges. A Nest `useFactory` declares its `inject` list and
Nest resolves it like a constructor, making the factory function _itself_ the
implementation. A Spring `@Bean` method also declares its parameters, yet
returns an instance of a real class, so its parameters become the dependencies
and that class is the implementation.

One rule reconciles all three: **the implementation is whatever the container
runs to produce an instance, and its dependencies are what the container
resolves for it.**

### Aliases and `useExisting`

"Alias" means two different things across these ecosystems. In NestJS,
`useExisting` is a second _registration_ forwarding to another service — two
tokens sharing one instance. We model it as a registration with
`registrationKind: "alias"`, no implementation, and an `aliases` edge to the
target service, which the renderer draws as a dotted arrow and labels on the
card.

In Spring, an alias is simply an extra _name_ for the same bean definition — one
registration and one service with multiple names. We store those in `aliases` on
the service and resolve dependencies to the canonical name. .NET has neither
feature; a forwarding delegate like `sp => sp.GetRequiredService<Foo>()` stays
an opaque factory.

### Lifetimes: prototype, transient, request and session

`lifetime` stays three-valued — `singleton`, `scoped`, or `transient` — because
that's what the renderer's lifetime badge draws and the first thing a reviewer
wants to know: one instance, one per scope, or a fresh one every time. Each
container's native term lives alongside it in `scope`, and the renderer displays
it whenever it adds useful detail:

| Container | Scope                                | `lifetime`                           |
| --------- | ------------------------------------ | ------------------------------------ |
| .NET      | `Singleton` / `Scoped` / `Transient` | the same                             |
| NestJS    | `DEFAULT` / `REQUEST` / `TRANSIENT`  | `singleton` / `scoped` / `transient` |
| Spring    | `singleton` / `application`          | `singleton`                          |
| Spring    | `prototype`                          | `transient`                          |
| Spring    | `request` / `session` / custom       | `scoped`                             |

Spring's `prototype` and .NET/Nest's transient mean the same thing ("a new
instance per injection"), so they share `transient` while keeping their native
names. `request` and `session` are both "one per scope" with different scopes,
so they map to `scoped` and preserve their names. `application` (one per servlet
context) maps cleanly to `singleton`.

### When the container changes the lifetime

NestJS **bubbles** scope upward: a default-scoped provider that injects a
request-scoped dependency is automatically recreated on every request. Nest's
serialized graph flags it as non-static, so the model records what actually
happens — `lifetime: "scoped"` — alongside `declaredLifetime: "singleton"` so
reviewers can see why it changed.

.NET takes a different approach, rejecting a singleton that captures a scoped
service during scope validation. Spring neither bubbles nor rejects: a prototype
injected into a singleton is created once for that singleton. Neither alters the
declared lifetime, so those cases appear simply as a `dependsOn` edge from a
longer-lived card to a shorter-lived one.

### Scoped proxies

In Spring, a `request`- or `session`-scoped bean using a scoped proxy actually
creates two bean definitions: `scopedTarget.requestContext` (the real scoped
bean) and `requestContext` (the singleton proxy handed to singletons). Since
engineers think of this as one request-scoped service and dependencies point at
the proxy, the extractor merges them into a single registration with the
target's scope and `proxied: true`.

### Modules and exports

NestJS modules are the only true container boundary among the three, and they
sit beside the core triad rather than replacing part of it — a module doesn't
instantiate objects or alter injection beyond controlling visibility. Modules
appear as `module` entities with declared `imports` (including re-exports) and
`provides` edges to their registrations, plus `module`/`exported` fields on
services and registrations. Global modules aren't drawn as explicit imports on
every module even though Nest binds them everywhere, because nobody declared
them. The renderer shows each card's module and leaves module-level grouping to
presentations that want it.

### Optional dependencies

Optional dependencies (`@Optional()`, defaulted .NET parameters, Spring's
`required = false` or `Optional<T>`, `ObjectProvider<T>`) are marked
`optional: true` and drawn faintly. If nothing satisfies an optional dependency,
nothing gets injected and no edge is emitted — the model records actual
composition, not unmet requests. Lazy lookups (`ObjectProvider`, `Provider`,
`@Lazy`) also carry `lazy: true`.

### Circular references

Nest's `forwardRef()` and Spring's circular references (when enabled) simply
form cycles of `dependsOn` edges. No special encoding is needed: the renderer's
layered layout ignores cycle-closing edges during placement and still renders
the arrows.

### Conditional registrations, profiles and environments

Containers wire up different services depending on configuration — .NET by
environment, Spring by profiles and conditions, Nest by module factories. Each
extraction captures one specific configuration (`environment` for .NET,
`profiles` and `properties` for Spring), so a bean excluded by a condition is
simply absent. Spring Boot's condition report lets us attach the matching
`conditions` to each registration so reviewers can see why it was included.

### Framework registrations

Every container includes internal plumbing the application never registered:
hosting services in .NET, `ModuleRef` in every Nest module, and infrastructure
beans in Spring. `dotnet-di` emits the full collection. Nest and Spring default
to application registrations plus any framework beans they directly inject
(`include: "application"`), since their framework footprints are much larger and
mostly not user-injectable; passing `include: "all"` includes everything. Every
registration tags its source in `origin`.

## What changed in the model

Adding NestJS and Spring only extended the model additively; .NET's output did
not have to change:

- `scope` and `declaredLifetime` on registrations to preserve native scope names
  and surface container-overridden lifetimes.
- The `aliases` relationship (registration → service) for forwarding
  registrations.
- `name`, `aliases`, `module`, and `exported` on services, plus `origin`,
  `primary`, `fallback`, `qualifiers`, `proxied`, and `conditions` on
  registrations.
- `injection`, `token` or `requestedType`, `qualifier`, and `lazy` on
  `dependsOn`.
- `module`, `imports`, and `provides` for module boundaries.

The renderer consumes the first three — displaying native scope names,
explaining overridden lifetimes, and drawing alias arrows with a legend entry —
and prints a container name or module whenever it helps distinguish cards.

## Not modelled

- Interception and AOP (Nest guards, interceptors, and pipes bound via
  decorators; Spring advice; .NET decorators from libraries like Scrutor), which
  alter runtime behavior rather than service composition.
- Lifecycle hooks and initialization order beyond Spring's `@DependsOn`
  (`initializedAfter`).
- Child containers and parent application contexts.
- Injected configuration values (`@Value` or `IOptions<T>` bindings), which are
  configuration rather than composition — though an `IOptions<T>` _service_
  itself is still modeled as a service.
