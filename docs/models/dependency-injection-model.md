# One model for dependency injection

Status: **adopted**. Three built-in extractors write it —
[`dotnet-di`](../../packages/extractors/dotnet-di/README.md) (.NET),
[`nestjs-di`](../../packages/extractors/nestjs-di/README.md) (NestJS) and
[`spring-di`](../../packages/extractors/spring-di/README.md) (Spring Boot) — and
the
[dependency-injection renderer](../../packages/renderers/dependency-injection/README.md)
presents any of them.

Dependency injection containers look alike from a distance: something asks for a
service, the container decides what satisfies it and how long that instance
lives. Up close they disagree about almost everything — what identifies a
service, whether a module boundary exists, what "transient" means, whether a
factory is a black box. This document explains the model Projections uses for
all of them, why its boundaries are where they are, and what we did with the
parts that don't fit. It was written by building three extractors against the
real containers (.NET's `Microsoft.Extensions.DependencyInjection`, NestJS's
`@nestjs/core` and Spring's `DefaultListableBeanFactory`) and changing the model
only where one of them could not be expressed honestly.

## Ground rules

Each extractor asks **the application's own container**, in the application's
own version, what it would do. None of them parses source code for decorators or
annotations and guesses:

- `dotnet-di` builds the application's host the way `dotnet ef` does, without
  starting it, and reads the complete service collection.
- `nestjs-di` composes the root module with `NestFactory` in **preview mode**,
  which resolves every dependency without instantiating a provider, and reads
  Nest's serialized graph (the data Nest Devtools shows).
- `spring-di` runs the application's main method with web serving off, records
  every dependency the bean factory resolves while the context refreshes, and
  abandons the run before any runner executes.

So the model describes _what the container decided_, and disagreements between
ecosystems are real differences in how the containers work, not artifacts of
extraction. All three run application code and require `--trust`.

## The boundaries

A registration is three entities and one decision:

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

The **lifetime** is a property of the registration, not of the service or the
implementation: the same class can be a singleton in one registration and
transient in another.

Dependencies are relationships from an **implementation** to a **service**
(`dependsOn`): the thing that is constructed asks for a contract. The renderer
derives composition from these endpoint kinds, not from relationship names, so
an extractor that names a relationship differently still composes.

Keeping these as separate entities, rather than one "bean" or "provider" node,
is what makes comparisons useful: a pull request that swaps `StripeGateway` for
`AdyenGateway` behind `PaymentGateway` modifies the registration and replaces
the implementation, while everything that depends on `PaymentGateway` is
untouched. A single node per binding would report every consumer's edge as
changed.

## Vocabulary

Everything below is ordinary `architecture/v0` ([contracts](../contracts.md)):
entity kinds, relationship kinds and `data` fields. Fields an ecosystem has no
use for are absent. Extractions declare the vocabulary,
`"vocabularies": ["dependency-injection/v0"]`, and the engine checks the fields
renderers rely on
([`vocabularies/dependency-injection`](../reference/schemas/vocabularies-dependency-injection.md)
lists them); the others are documented here and stay open.

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

Relationships carry `confidence`: `authoritative` when the container itself
recorded the resolution, `derived` when the extractor applied the container's
own rule to something the container did not do during extraction (see each
extractor's README).

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

The model started here, so .NET maps directly: a `ServiceDescriptor` is a
registration, its service type and key are the service, and its implementation
type or instance type is the implementation. Registrations of one service are
ordered (`ordinal`) and the last one is what a single injection resolves, which
the renderer draws as one card stacked `×n`. Factory registrations are delegates
the container calls with an `IServiceProvider`; nothing records what they will
resolve, so they are recorded as `registrationKind: "factory"` with no
implementation and no dependency edges. Constructor dependencies are derived by
applying the container's own constructor-selection rule to each implementation
type, so they are per type.

### NestJS

A Nest **token** is the contract: a class (often an abstract class standing in
for an interface, which TypeScript erases), a string or a symbol. A provider is
a registration: `useClass` and class providers have a class implementation,
`useFactory` has a factory implementation whose `inject` list is its
dependencies, `useValue` has an implementation only when the value is an
instance of a named class, and `useExisting` is an alias (below).

Nest's container is not one container but one per **module**: a provider is
visible in its module and, if exported, in modules that import it. The same
token provided in two modules is two different instances. So a Nest service's
identity is _(module, token)_, and a dependency points at the service in the
module where Nest actually found it, across imports and re-exports. Modules are
entities of their own (below).

### Spring

A Spring bean factory is a map from **bean names** to bean definitions, and
every lookup — including injection by type — ends at a name. So a Spring
service's identity is its bean name. The service's `type` is what the bean is
registered as: for a `@Bean` method, the method's return type (the contract,
often an interface), and for a scanned component, its class. The implementation
is the class of the instance the container made, with generated CGLIB and AOP
proxy classes unwrapped to the user's class.

Consumers usually ask for a _type_, not a name. The `dependsOn` edge keeps what
was asked for (`requestedType`, `qualifier`) but points at the **bean Spring
chose**, which is the composition that actually runs.

## What doesn't fit, and what we did

### Identity: type, token or name

Each container keys its services differently, and the model follows each
container's own key rather than forcing one: .NET's _(type, key)_, Nest's
_(module, token)_, Spring's bean name. Forcing a common key (say, "the requested
type") would merge services the container keeps apart — two `Clock` beans,
`systemClock` and `utcClock`, are two services in Spring and must stay two
cards. When two cards would read the same, the renderer shows the container's
name for each.

### Several candidates and `@Primary`

.NET keeps every registration of a service, and a single injection gets the last
one; `IEnumerable<T>` gets them all. Spring never has two registrations of one
name; instead several _beans_ match a requested type, and `@Primary`,
`@Fallback`, a qualifier or the parameter name chooses one. These are different
mechanisms, so they are different data: .NET's stack is several registrations
with `ordinal`s, and Spring's choice is recorded where it happened — the
`dependsOn` edge points at the chosen bean, and the registration carries
`primary`, `fallback` and `qualifiers`. Moving `@Primary` from one bean to
another therefore shows as dependency edges moving, which is what changed.

### Collections

A collection injection (`IEnumerable<T>`, `List<T>`, `Map<String, T>`) is
`collection: true`. In .NET the collection is all registrations of one service,
so it is one edge to that service. In Spring each element is a separate bean, so
it is one edge per element bean, sharing a parameter name.

### Contract and implementation

.NET separates the service type from the implementation type in every
registration. Spring separates them only for `@Bean` methods (the declared
return type versus the instance's class); a scanned component is registered as
its own class, so its contract and implementation are the same and the card
shows one name. Nest separates them when the token is not the class
(`{provide: PaymentGateway, useClass: StripeGateway}`). The model needed no
change: an implementation equal to its contract is "registered as its own type".

### Per-type or per-registration implementations

.NET derives constructor dependencies from a type, so every registration of
`OrderService` shares one implementation entity and one set of edges. In Nest
and Spring the dependencies belong to the registration: a factory's `inject`
list or a `@Bean` method's parameters, and module-scoped resolution. Their
implementations are therefore one per registration. The model allows both; the
renderer folds whatever implementations a service's registrations point at into
that service's card.

### Factories

Factories are the clearest disagreement. A .NET factory is a delegate: what it
resolves is decided when it runs, so `dotnet-di` records it and draws no
dependencies. A Nest `useFactory` declares what it injects, and Nest resolves it
like a constructor, so the factory function _is_ the implementation, with
dependencies. A Spring `@Bean` method is also declared, but it produces an
instance of a real class; its parameters are the bean's dependencies and the
instance's class is the implementation. The rule that reconciles them: **the
implementation is what the container runs to produce the instance, and its
dependencies are what the container resolves for it.**

### Aliases and `useExisting`

The word means two different things. A Nest `useExisting` provider is a second
_registration_ that forwards to another service: two tokens, one instance. It is
modelled as a registration with `registrationKind: "alias"`, no implementation,
and an `aliases` relationship to the service it forwards to; the renderer draws
a dotted alias arrow and names the target on the card. A Spring alias is a
second _name_ for the same bean definition: one registration, one service,
several names. It is `aliases` data on the service, and dependencies resolve
through it to the canonical name. .NET has neither; a forwarding factory
(`sp => sp.GetRequiredService<Foo>()`) is an opaque factory.

### Lifetimes: prototype, transient, request and session

`lifetime` stays three-valued — `singleton`, `scoped`, `transient` — because
that is what the renderer's lifetime mark draws and what a reader needs first:
one instance, one per scope, or a new one each time. Every container's own name
is kept beside it in `scope`, and the renderer shows that name when it says more
than the lifetime:

| Container | Scope                                | `lifetime`                           |
| --------- | ------------------------------------ | ------------------------------------ |
| .NET      | `Singleton` / `Scoped` / `Transient` | the same                             |
| NestJS    | `DEFAULT` / `REQUEST` / `TRANSIENT`  | `singleton` / `scoped` / `transient` |
| Spring    | `singleton` / `application`          | `singleton`                          |
| Spring    | `prototype`                          | `transient`                          |
| Spring    | `request` / `session` / custom       | `scoped`                             |

Spring's `prototype` and .NET's or Nest's transient both mean "a new instance
for each injection", so they share a lifetime and differ in name. `request` and
`session` are both "one per scope" with different scopes, so they share `scoped`
and keep their names. `application` (one per servlet context) is a singleton for
this purpose.

### When the container changes the lifetime

Nest **bubbles** scope: a default-scoped provider that injects a request-scoped
one is itself re-created for every request. The serialized graph reports it as
non-static, and the model records what actually happens: `lifetime: "scoped"`,
with `declaredLifetime: "singleton"` so the reader can see why. .NET instead
rejects a singleton that captures a scoped service (scope validation), and
Spring neither bubbles nor rejects: a prototype injected into a singleton is
created once, for that singleton. Those are not modelled as lifetime changes
because the containers don't change the lifetime; they are visible as a
`dependsOn` edge from a longer-lived card to a shorter-lived one.

### Scoped proxies

A Spring `request`- or `session`-scoped bean with a scoped proxy is two bean
definitions: `scopedTarget.requestContext`, the real request-scoped bean, and
`requestContext`, a singleton proxy that singletons receive. Readers think of it
as one request-scoped service, and dependencies name the proxy, so the two fold
into one registration with the target's scope and `proxied: true`.

### Modules and exports

Nest modules are the only real boundary among the three, and they are not a
fourth part of the triad: a module does not produce instances or change what is
injected beyond deciding visibility. They are `module` entities with their
declared `imports` (whether re-exported), `provides` relationships to their
registrations, and `module`/`exported` data on services and registrations. A
global module is not drawn as an import of every module, even though Nest binds
it into each one, because nobody declared that import. The renderer shows a
card's module; grouping cards by module is left to presentations that need it.

### Optional dependencies

An optional dependency (`@Optional()`, a defaulted .NET parameter, Spring's
`required = false` or `Optional<T>`, an `ObjectProvider<T>`) is `optional: true`
and drawn faint. When nothing satisfies it, nothing is injected, so there is no
edge: the model records compositions, not wishes. Lazy lookups
(`ObjectProvider`, `Provider`, `@Lazy`) are also `lazy: true`.

### Circular references

Nest's `forwardRef()` and Spring's circular references (when allowed) are cycles
of `dependsOn` edges. Nothing special is recorded; the renderer's layered layout
ignores cycle-closing edges when it places cards and still draws them.

### Conditional registrations, profiles and environments

Containers register different services under different configuration: .NET hosts
by environment, Spring by profile and condition, Nest by whatever module
factories decide. An extraction is the container for one configuration
(`environment` for .NET, `profiles` and `properties` for Spring), so a condition
that excluded a bean simply means the bean is absent. Spring Boot's condition
report adds the conditions that _matched_ to a registration (`conditions`), so a
reader can see why it is present.

### Framework registrations

A container holds many registrations the application never wrote: hosting
services in .NET, `ModuleRef` in every Nest module, Spring's infrastructure
beans. `dotnet-di` reports the complete collection. The Nest and Spring
extractors default to the application's own registrations plus the framework
registrations those inject (`include: "application"`), because their framework
share is far larger and mostly not injectable by the application;
`include: "all"` reports everything. Every registration says where it came from
in `origin`.

## What changed in the model

Building the second and third extractors changed the model only additively; the
.NET extractor's output is unchanged:

- `scope` and `declaredLifetime` on registrations, so container lifetimes keep
  their own names and overridden lifetimes are visible.
- The `aliases` relationship (registration → service), for forwarding
  registrations.
- `name`, `aliases`, `module` and `exported` on services, and `origin`,
  `primary`, `fallback`, `qualifiers`, `proxied` and `conditions` on
  registrations.
- `injection`, `token` or `requestedType`, `qualifier` and `lazy` on
  `dependsOn`.
- `module`, `imports` and `provides` for module boundaries.

The renderer reads the first three (scope names on the card, an explanation of
an overridden lifetime, alias arrows and a legend entry) and shows a container
name or module when it tells cards apart.

## Not modelled

- Interception and AOP (Nest guards, interceptors and pipes bound with
  decorators; Spring advice; .NET decorators applied by Scrutor-like libraries)
  change what an instance does, not how it is composed.
- Lifecycle hooks and initialization order beyond Spring's `@DependsOn`
  (`initializedAfter`).
- Child containers and parent application contexts.
- Values: a configuration value injected with `@Value` or `IOptions<T>` binding
  is configuration, not composition (an `IOptions<T>` _service_ is a service).
