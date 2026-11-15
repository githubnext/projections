# Spring dependency injection

The beans of a Spring Boot application and what each one injects, as the
application's own bean factory resolves them: every bean with its scope and
class, and the bean Spring chose for each dependency. Compared across a pull
request, it answers "which beans did this change add, remove or rewire, and did
any scope or `@Primary` choice change?"

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

Use it for Spring Boot applications, where component scanning,
auto-configuration and `@Bean` methods decide what every class receives: a new
bean and what it injects, a `@Bean` method that now returns another
implementation, a prototype made a singleton, `@Primary` moved from one bean to
another so every consumer of the type is rewired. It reads the composition
Spring itself made, including auto-configuration, not annotations parsed from
source.

It runs the application's main method, so it needs `--trust` (see
[What it reads](#what-it-reads)). For .NET use [`dotnet-di`](dotnet-di.md), for
NestJS [`nestjs-di`](nestjs-di.md); all three write the same model.

## What it reads

The application at `project` (default the repository root):

- **The project's own build.** Gradle (the project's `gradlew`, else `gradle`)
  runs `classes` with its build directories redirected to a scratch directory;
  Maven (`mvnw`, else `mvn`) runs `process-classes` and reports the classpath,
  writing `target/` as its own build would. Gradle is used when both builds are
  present, unless `build` says `maven`. Dependencies come from your usual Gradle
  or Maven caches; the first build may download them, so grant
  `execution.network` and a generous `execution.timeoutMs`.
- **The project's own JDK**, 17 or newer with `javac` (`JAVA_HOME`, else `java`
  and `javac` on `PATH`), and Spring Boot 3.0 or newer. An extractor sees only
  the variables its definition grants, so list `JAVA_HOME` (and
  `GRADLE_USER_HOME` if you set it) in `execution.environment`. A small
  first-party helper ships with Projections as source and is compiled against
  your classpath, so it uses your application's own Spring.
- **The application's main method**, `mainClass` (default the one
  `@SpringBootApplication` class with a `main` method), run with web serving
  off, `profiles` active and `properties` overriding its configuration. The
  context refreshes, every dependency the bean factory resolves is recorded, and
  the run stops: no web server starts and no `CommandLineRunner` runs.
  Constructors, `@PostConstruct`, `@Bean` methods and auto-configuration do run,
  which is why it needs `--trust`.
- **Or a file.** `snapshot` imports an extraction exported earlier; nothing
  runs, and no trust or JDK is needed.

Each bean becomes a `service` (its name and registered type: a `@Bean` method's
return type, or the component class), a `registration` (its scope, how it was
defined, and `@Primary`, `@Fallback`, qualifiers, `@Lazy`, `@DependsOn` and the
conditions that matched) and an `implementation` (the instance's class, with
proxies unwrapped). A scoped proxy and its target are one registration. Each
injection is a `dependsOn` relationship to the bean Spring chose, keeping the
type that was asked for; a collection injection has one per element bean. Beans
the context didn't create (prototypes never requested, request-scoped targets,
`@Lazy` beans) are resolved with the bean factory's own rules, without creating
them, and marked `derived`. By default (`include: application`) it keeps beans
in the application's packages and the beans they inject; `include: all` adds
Spring's infrastructure.

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
folds each bean's service, registration and implementation into one card,
showing the bean name when it says more than the type, with its lifetime drawn
as a line (continuous for a singleton, broken per request or session, dotted for
a prototype) and an arrow for each injection:

- **Beans** added or removed, with their dependencies.
- **Scope changes**, as lifetime changes, labelled with Spring's own scope name
  when it says more than the lifetime (a `prototype` bean made a singleton).
- **Implementations** replaced behind an unchanged bean (a `@Bean` method now
  returning `AdyenGateway`): the card says so.
- **Dependencies** rewired: moving `@Primary` or a qualifier moves the arrows of
  every bean that injects the type, listed on each card by the cards they point
  at.

The summary bar counts the composition (services, registrations, implementations
and dependencies, each with what was added, removed and modified), then what
changed about cards in both revisions: lifetimes, implementations, service types
and registration counts changed, each filtering to its cards. A comparison
starts as one diff, and plays as side by side, animated or swipe too. It opens
fitted to the frame unless that would draw text smaller than 8 px; a large
application then opens at that size, at its root, and scrolls, with zoom
controls.

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

- The context isn't a web application context, so web-only auto-configuration
  (the embedded server's beans) is absent.
- Dependencies that aren't beans (`BeanFactory`, `ApplicationContext`,
  `ApplicationEventPublisher`) and `@Value` injections aren't drawn, and an
  `ObjectProvider` that resolves nothing has no arrow.
- A bean's identity is its name: renaming a component class renames its default
  bean name, which is a removal and an addition.
- The main method must run `SpringApplication`; whatever it does first runs too.
  A Maven `project` builds with `-f <project>/pom.xml`, so sibling modules come
  from the local repository.
- One set of profiles and properties per projection; beans excluded by a
  condition are simply absent. Aspects and interception aren't modelled.

## Related

- [`dependency-injection`](../renderers/dependency-injection.md), the renderer
  that draws it.
- [`dotnet-di`](dotnet-di.md) and [`nestjs-di`](nestjs-di.md), the same model
  for .NET and NestJS.
- [The default comparator](../comparators/default.md), which compares it.
- [One model for dependency injection](../../models/dependency-injection-model.md),
  how containers map onto services, registrations and implementations.

## How it works

The [package README](../../../packages/extractors/spring-di/README.md) details
the build, the run and how each bean is recorded.

## Build your own

Write your own extractor when Spring's bean factory isn't the composition you
need to review:

- **Another container**: Micronaut, Quarkus (CDI), Guice or Dagger, or a Spring
  application that isn't a Boot application. An extractor that writes the same
  services, registrations and implementations (the `dependency-injection/v0`
  vocabulary) is drawn by the same renderer.
- **Facts the bean factory doesn't have**: the endpoints each controller maps,
  the aspects that apply to a bean, the configuration properties bound into it,
  or the team that owns each package.
- **No code execution**: when CI can't run the application with `--trust`,
  export the graph from a test and import it with `snapshot`.

Try the lighter options first: `profiles` and `properties` pick the
configuration, `include` widens or narrows what's shown, and `snapshot` imports
a graph your tests already export. To flag changes that matter to you (a
singleton that now injects a prototype, say), keep this extractor and add a
comparator file; to group beans by package or layer, write a renderer.

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
