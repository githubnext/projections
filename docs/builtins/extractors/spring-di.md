# Spring dependency injection

This extractor captures the beans in a Spring Boot application and what each one
injects, exactly as Spring's own bean factory resolves them: every bean's scope
and implementation class, along with the concrete bean chosen for each
dependency. Compared across a pull request, it shows which beans were added,
removed, or rewired, and whether any scope or `@Primary` selection changed.

<!-- generated: facts -->

- ID: `spring-di`
- Extraction schema:
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Drawn by default with:
  [`dependency-injection`](../renderers/dependency-injection.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*Application.java`,
  `**/*Application.kt`

<!-- end generated: facts -->

## When to use it

Use this extractor in Spring Boot applications where component scanning,
auto-configuration, and `@Bean` methods determine what every class actually
receives. It makes wiring changes obvious at a glance—a new bean and its
dependencies, a `@Bean` method returning a different implementation, a prototype
switched to a singleton, or `@Primary` moving to another bean and rewiring every
consumer of that type. Instead of guessing from source annotations, it inspects
the real bean graph Spring builds, including auto-configuration.

Because it runs your application's main method, it requires `--trust` (see
[What it reads](#what-it-reads)). For .NET use [`dotnet-di`](dotnet-di.md) and
for NestJS use [`nestjs-di`](nestjs-di.md); all three produce the same model.

## What it reads

Targeting the application at `project` (defaulting to the repository root), the
extractor uses:

- **Your project's build tool.** For Gradle (using `gradlew` if present, else
  `gradle`), it runs `classes` with build outputs redirected to a scratch
  directory. For Maven (`mvnw` or `mvn`), it runs `process-classes` and queries
  the classpath, writing to `target/` as usual. When both exist, Gradle wins
  unless `build` is set to `maven`. Dependencies come from your local Gradle or
  Maven caches; if a first run needs to download artifacts, enable
  `execution.network` and give `execution.timeoutMs` plenty of headroom.
- **Your JDK** (17 or newer, including `javac` via `JAVA_HOME` or `java` and
  `javac` on `PATH`) and Spring Boot 3.0+. Because extractors only see
  environment variables explicitly allowed by the definition, add `JAVA_HOME`
  (and `GRADLE_USER_HOME` if needed) to `execution.environment`. Projections
  ships a small helper as source and compiles it against your classpath so it
  runs directly against your app's version of Spring.
- **Your application's main method**, identified by `mainClass` (defaulting to
  the sole `@SpringBootApplication` class with a `main` method), launched with
  web serving disabled, `profiles` active, and `properties` applied. Once the
  context refreshes and every resolved dependency is recorded, the process
  exits—no web server starts and no `CommandLineRunner` executes. Constructors,
  `@PostConstruct`, `@Bean` methods, and auto-configuration still run, which is
  why `--trust` is required.
- **A saved snapshot.** Setting `snapshot` imports a previously exported
  extraction instead—nothing runs and neither `--trust` nor a JDK is needed.

Each bean is modeled as three linked pieces: a `service` (its name and
registered type, either the `@Bean` return type or component class), a
`registration` (its scope, definition source, `@Primary`, `@Fallback`,
qualifiers, `@Lazy`, `@DependsOn`, and matched conditions), and an
`implementation` (the concrete class with proxies unwrapped; a scoped proxy and
its target share one registration).

Every injection becomes a `dependsOn` edge pointing to the bean Spring selected
while preserving the requested type (collection injections emit one edge per
element). Beans that the context didn't instantiate—unrequested prototypes,
request-scoped targets, and `@Lazy` beans—are resolved using the bean factory's
own rules without creating instances and marked `derived`. By default
(`include: application`), only beans in your application's packages and the
beans they inject are kept; `include: all` adds Spring's own infrastructure
beans.

## Options

<!-- generated: inputs -->

| Input        | Meaning                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `build`      | gradle or maven; default detected from the project.                                          |
| `include`    | application (default: beans in the application's packages and the beans they inject) or all. |
| `mainClass`  | Main class; default the one @SpringBootApplication class with a main method.                 |
| `profiles`   | Spring profiles to activate.                                                                 |
| `project`    | Application project directory; default the repository root.                                  |
| `properties` | Extra Spring properties, name to value.                                                      |
| `snapshot`   | Pre-exported DI state.                                                                       |

<!-- end generated: inputs -->

## What a comparison shows

The [`dependency-injection`](../renderers/dependency-injection.md) renderer
combines each bean's service, registration, and implementation into a single
card. It displays the bean name whenever it adds context beyond the type, draws
its lifetime as a line style (solid for singletons, dashed for request or
session scope, dotted for prototypes), and connects each injection with an
arrow:

- **Added or removed beans**, along with their dependency arrows.
- **Scope changes**, shown as lifetime updates and labeled with Spring's own
  scope name when helpful (such as a `prototype` bean becoming a singleton).
- **Swapped implementations** behind an unchanged bean—for instance, a `@Bean`
  method that now returns `AdyenGateway`.
- **Rewired dependencies**, where moving `@Primary` or changing a qualifier
  shifts the arrows on every bean injecting that type.

The summary bar counts services, registrations, implementations, and
dependencies with their deltas, followed by clickable filters for cards that
changed lifetime, implementation, service type, or registration count across
revisions. Comparisons open in unified diff mode and also support side-by-side,
animated, and swipe views. Graphs fit to the frame unless text would drop below
8 px, in which case large apps open at readable zoom near the root with scroll
and zoom controls.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "spring-di",
  "id": "spring-di",
  "renderer": "dependency-injection",
  "title": "Spring dependency injection"
}
```

<!-- end generated: definition -->

## Limitations

- Because the application runs without a web context, web-only
  auto-configuration (such as embedded server beans) isn't present.
- Non-bean framework dependencies (`BeanFactory`, `ApplicationContext`,
  `ApplicationEventPublisher`) and `@Value` injections aren't drawn, and an
  `ObjectProvider` that resolves to nothing produces no arrow.
- Beans are identified by name, so renaming a component class changes its
  default bean name and shows up as a removal and an addition.
- Your main method must invoke `SpringApplication`, and any setup code before
  that call runs as well. Maven builds with `project` run
  `-f <project>/pom.xml`, so sibling modules are resolved from your local Maven
  repository.
- Each projection reflects a single set of profiles and properties; beans
  excluded by conditions simply don't appear. AOP aspects and interception
  aren't modeled.

## Related

- [`dependency-injection`](../renderers/dependency-injection.md) — the renderer
  that draws the bean graph.
- [`dotnet-di`](dotnet-di.md) and [`nestjs-di`](nestjs-di.md) — the same model
  for .NET and NestJS.
- [The default comparator](../comparators/default.md) — compares bean graphs
  across revisions.
- [One model for dependency injection](../../models/dependency-injection-model.md)
  — how different DI containers map onto services, registrations, and
  implementations.

## How it works

See the [package README](../../../packages/extractors/spring-di/README.md) for
details on the build step, context execution, and how each bean is recorded.

## Build your own

Consider writing a custom extractor if Spring Boot's bean factory isn't the
graph you need:

- **Another DI container**, such as Micronaut, Quarkus (CDI), Guice, Dagger, or
  a non-Boot Spring app. Emit the same `dependency-injection/v0` vocabulary of
  services, registrations, and implementations and the built-in renderer works
  out of the box.
- **Additional metadata**, like HTTP endpoints per controller, AOP aspects
  applied to beans, bound configuration properties, or package ownership.
- **No code execution in CI**, by exporting the bean graph during your test
  suite and loading it via `snapshot` without `--trust`.

Check the built-in options first: `profiles` and `properties` select the active
configuration, `include` widens or narrows the graph, and `snapshot` imports
pre-exported data. To flag risky wiring changes (like a singleton injecting a
prototype), add a comparator file; to group beans by package or layer, keep this
extractor and write a custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language (your repository's
toolchain, Node.js, Python, or Go). That creates the definition and a starter
extractor under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, keep the `dependency-injection` renderer:

```sh
projections init <id> --language node --renderer dependency-injection
```

Test changes as you go with `projections show -p <id> --trust`. An open
projection tab picks up your uncommitted edits ("Your edits") and flags stale
results, and the Testing view runs your projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.
