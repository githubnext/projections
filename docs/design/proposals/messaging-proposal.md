# Proposal: a messaging projection

Status: **proposal**. Nothing here is implemented; it records a direction for a
future built-in projection.

Asynchronous messaging is a system that a diff hides well. A pull request that
adds a subscriber, renames a topic or changes an event's payload touches a few
lines in one service, but what changed is a relationship between services that
never call each other directly. Projections should make that visible: who
publishes what, on which channel, and who consumes it.

## What we had, and why it was removed

The built-in `messaging` renderer presented `architecture/v0` extractions from
the `message-handlers` extractor, now a
[custom extractor sample](../../../examples/extractors/message-handlers/README.md).
That extractor finds handlers and publishers from _conventions_: calls shaped
like `subscribe("event", handler)`, decorators and registries that each team
configures. That makes it a good sample and a weak built-in. It infers the
system from source spelling, covers one language, and its accuracy depends on
how well the configuration matches the code. The renderer was a dedicated list
for data that the graph renderer can already present. Both were removed in the
renderer review.

## Proposed sources

A built-in messaging projection should read the system the way the
[dependency injection model](../../models/dependency-injection-model.md) does:
ask a declared contract or the framework itself, never guess from text. Two
sources complement each other:

1. **AsyncAPI documents.**
   [AsyncAPI](https://www.asyncapi.com/docs/reference/specification/latest) (2.x
   and 3.x) is the declared contract: servers, channels, operations (`send` /
   `receive` in 3.x, `publish` / `subscribe` in 2.x), messages and their payload
   schemas, per application. Reading committed documents executes nothing, needs
   no `--trust`, and is deterministic. Several documents in one repository (one
   per service) join on channel addresses and message IDs.
2. **Framework subscriber registries.** Where no AsyncAPI document exists, or to
   check that the code matches it, ask the framework what it registered without
   connecting to a broker. Candidates, by analogy with the DI extractors: NestJS
   microservice handlers (`@MessagePattern`, `@EventPattern`) from the container
   in preview mode; Spring `@KafkaListener`, `@RabbitListener`, `@JmsListener`
   endpoints and Spring Cloud Stream bindings from the bean factory; .NET
   MassTransit and NServiceBus endpoint and consumer configuration from the
   built host. These run application code and require `--trust`, like
   `nestjs-di`, `spring-di` and `dotnet-di`, and could share their helpers.

Both sources describe structure, not traffic. Broker introspection, consumer
lag, throughput or traced message flows are out of scope: they depend on the
environment and the moment, not the revision (see
[determinism and authority](../../models/domain-model/extension-points.md#determinism-and-authority)).

## Model sketch

One `architecture/v0` model, whichever source wrote it:

<!-- prettier-ignore -->
| Entity kind | ID | Notes |
|---|---|---|
| `application` | `application:<name>` | An AsyncAPI document's application, or the service whose container was read; a module boundary in the graph |
| `channel` | `channel:<address>` | Topic, queue, exchange or subject, by normalized address; parameterized addresses keep their template |
| `message` | `message:<name>` | A message type; `data.schema` holds a normalized payload schema |

<!-- prettier-ignore -->
| Relationship kind | From → to | Meaning |
|---|---|---|
| `contains` | application → channel/message | Declared by, or registered in, the application |
| `sends` | application → channel | The application publishes to the channel (with `data.message`) |
| `receives` | channel → application | The application consumes from the channel (with `data.message`, and the handler as evidence) |
| `carries` | channel → message | Messages the channel transports |

IDs never contain versions or file positions, so changing a payload is one
modified message, and moving a handler is evidence, not a change of identity.
Channels that are sent to but never received (or the reverse) are ordinary graph
facts that the presentation can call out.

## Presentation

Start with the graph renderer's `architecture` view (applications as boundaries,
channels between them), not a new renderer. A comparison then shows a new
subscriber, a removed publisher or a rewired channel as graph changes in step
order. A payload change would show as a modified message. Following the API
compatibility comparator's approach (in progress), a comparator could also
classify a payload change as compatible or breaking for each consumer. A
dedicated renderer is justified only if the graph can't explain those changes.

## Open questions

- AsyncAPI 2.x and 3.x model operations from opposite perspectives; normalize to
  `sends`/`receives` from the application's point of view.
- How to join channels across services when addresses are parameterized or
  environment-specific (`orders.{region}`), without inventing identity.
- Whether registry extraction should validate against a committed AsyncAPI
  document (and report drift) or simply union the two.
- Which ecosystems come first; NestJS and Spring reuse existing helpers.
