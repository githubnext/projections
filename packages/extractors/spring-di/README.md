---
description: "A Spring Boot application's beans and dependencies (spring-di)"
---

# Spring dependency injection — `spring-di`

The beans of a Spring Boot application and the dependencies its **own bean
factory** resolves, read from the application context the application's main
method builds. It writes `architecture/v0` in the shared
[dependency-injection model](../../../docs/models/dependency-injection-model.md),
for the
[dependency-injection renderer](../../renderers/dependency-injection/README.md).

```json
{
  "id": "beans",
  "extractor": "spring-di",
  "renderer": "dependency-injection",
  "inputs": {"project": "services/orders"},
  "execution": {"timeoutMs": 300000, "network": true}
}
```

<!-- prettier-ignore -->
| Input | Meaning |
| --- | --- |
| `project` | The Spring Boot application's project directory (a Gradle project applying the `java` plugin, or a Maven module); default the repository root |
| `build` | `gradle` or `maven`; default detected from `build.gradle(.kts)`/`settings.gradle(.kts)` or `pom.xml` |
| `mainClass` | The main class; default the one `@SpringBootApplication` class with a `main` method in the project's own classes |
| `profiles` | Spring profiles to activate (`spring.profiles.active`) |
| `properties` | Extra Spring properties, name to value; they take precedence over the application's own configuration |
| `include` | `application` (default): beans defined in the application's packages, plus the beans they inject. `all`: every bean, including Spring's infrastructure |
| `snapshot` | A pre-exported `architecture/v0` state to import instead (no trust or JDK needed) |

Builds download dependencies the first time, as the project's own builds do, so
grant `execution.network` and a generous `execution.timeoutMs`.

## How it works

Everything runs with the project's own toolchain, and Projections ships no
Spring and no third-party Java code:

1. **The project's build** reports the runtime classpath. Gradle (the project's
   `gradlew`, else `gradle` on PATH) runs `classes` through a first-party init
   script that redirects every project's build directory into a scratch
   directory. Maven (`mvnw`, else `mvn`) runs `process-classes` and
   `dependency:build-classpath`; Maven writes `target/` as its own build would.
   Dependencies resolve from the user's usual Gradle or Maven caches.
2. **The helper** (`helper/`, about 1,000 lines of first-party Java) is compiled
   from source with the project's own `javac` against that classpath, so it uses
   the application's own Spring. The CLI ships the source, never a compiled
   class.
3. **The application's main method runs** under a `SpringApplicationHook`, the
   mechanism Spring Boot's own AOT processing uses. The hook makes the
   application non-web (`spring.main.web-application-type=none`) and eager
   (`spring.main.lazy-initialization=false`), gives it a bean factory that
   records each dependency Spring resolves, and abandons the run once the
   context has refreshed. No web server starts and no `CommandLineRunner` or
   `ApplicationRunner` runs; the context is then closed.
4. **The bean factory is read**: every bean definition and registered singleton,
   scopes, `@Primary`/`@Fallback`, qualifiers, aliases, factory methods,
   `@DependsOn`, Spring Boot's condition evaluation report, and the recorded
   resolutions. Beans the context did not create (prototypes never requested,
   request- or session-scoped targets, explicitly `@Lazy` beans) are resolved
   from their constructor, factory method and `@Autowired` members with the bean
   factory's own candidate selection, without creating them; those edges are
   `derived`, the recorded ones `authoritative`.

Running `main` and refreshing the context run application code (constructors,
`@PostConstruct`, `@Bean` methods, auto-configuration), so the extractor
requires `--trust`. The working directory is the project directory, and
application output never reaches stdout.

## What it writes

<!-- prettier-ignore -->
| Spring | Entities and relationships |
| --- | --- |
| A bean named `n` | `service:n` → `registration` → `implementation:n` |
| The bean's registered type | `data.type` on the service: a `@Bean` method's return type (the contract), or the component class |
| The instance's class | The implementation (`StripeGateway` behind `PaymentGateway`); generated proxy and lambda classes fall back to the declared type |
| Component scanning, `@Bean` methods, `FactoryBean`s, registered singletons | `registrationKind`: `component`, `factory-method` (with `data.factory`), `factory-bean`, `instance`, or `class` for other definitions |
| `singleton` / `prototype` / `request` / `session` / `application` / custom scopes | `data.scope`, and `data.lifetime` `singleton` / `transient` / `scoped` / `singleton` / `scoped` |
| A scoped proxy and its `scopedTarget.` bean | One registration with the target's scope and `data.proxied: true` |
| Aliases | `data.aliases` on the service; dependencies resolve to the bean's canonical name |
| `@Primary`, `@Fallback`, qualifiers, `@Lazy`, `@DependsOn`, role | `primary`, `fallback`, `qualifiers`, `lazy`, `initializedAfter`, `role` on the registration |
| Conditions that matched | `data.conditions`, from Spring Boot's condition evaluation report |
| Constructor, `@Bean` method, field and method injection | `dependsOn` from the implementation to each resolved bean's service, with `injection`, `parameter`, `position`, the `requestedType`, `qualifier`, `optional`, `collection` (one edge per element bean) and `lazy` (`ObjectProvider`, `Provider`, `@Lazy`) |

A bean's identity is its name, the bean factory's own key: two beans of one type
are two services, and a dependency points at the bean Spring actually chose
(`@Primary`, a qualifier or the parameter name), not at the type that was
requested. `data.origin` is `application` for beans whose class or `@Bean`
method is in the application's auto-configuration packages (the main class's
package by default).

## Requirements

- A JDK 17 or newer with `javac` (`JAVA_HOME`, else `java` and `javac` on PATH),
  as the project's own build uses. Like every extractor, `spring-di` sees only
  the variables the definition grants, so list `JAVA_HOME` (and
  `GRADLE_USER_HOME`, if you set it) in `execution.environment` to use them.
- The project's Gradle (the wrapper, else `gradle` on PATH) or Maven (the
  wrapper, else `mvn` on PATH).
- Spring Boot 3.0 or newer (`SpringApplicationHook`); Spring Boot 3.x and 4.x
  are tested.

## Limitations

- Web-only auto-configuration is absent (the context is not a web application
  context), so the composition shows the application's beans, not an embedded
  server's.
- Dependencies that are not beans (`BeanFactory`, `ApplicationContext`,
  `ResourceLoader`, `ApplicationEventPublisher`) and `@Value` injections are not
  dependencies; an `ObjectProvider` that resolves nothing has no edge.
- The application's main method must run `SpringApplication`; a main class that
  does other work first runs it. Set `mainClass` to choose another.
- A Maven `project` builds with `-f <project>/pom.xml`: sibling modules resolve
  from the local repository, as they do for `mvn -f`.

## Validation

`tests/fixtures/app` is one sample application with a Gradle build on Spring
Boot 4 and a Maven build on Spring Boot 3; the `after` overlay adds a service,
makes a prototype bean a singleton and swaps the implementation a `@Bean` method
returns. The opt-in native suite builds and runs both:

```sh
PROJECTIONS_NATIVE_SPRING=1 cargo test -p projections-cli --test native_tools native_spring
```

It passed on macOS arm64 with Temurin JDK 21.0.13, Gradle 9.8.2 and Maven 3.9.16
(Spring Boot 4.1.2 and 3.5.16). `tests/fixtures/spring.json` is the Gradle
build's extraction, imported by the Rust tests.

The fixture's builds resolve dependencies and plugins from Maven Central and the
Gradle Plugin Portal for now. Microsoft's package feed proxy has a planned Maven
endpoint, `https://packagefeedproxy.microsoft.io/maven/`; switch the fixture to
it once it is live.
