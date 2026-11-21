# Proposal: a messaging projection

Status: **proposal**. Nothing here is implemented yet; this document outlines a
direction for a future built-in projection.

Asynchronous messaging is easy to miss in a code diff. A pull request that adds
a subscriber, renames a topic, or tweaks an event payload might only touch a few
lines in one service, yet it changes the relationship between services that
never call each other directly. A messaging projection should make those links
obvious: who publishes what, on which channel, and who consumes it.

## What we had, and why it was removed

We previously shipped a built-in `messaging` renderer for `architecture/v0`
extractions produced by the `message-handlers` extractor (now a
[custom extractor sample](../../../examples/extractors/message-handlers/README.md)).
That extractor looked for handlers and publishers by matching code _conventions_
— calls like `subscribe("event", handler)`, decorators, and registries
configured per team. That works nicely as a sample, but poorly as a built-in: it
guesses structure from source spelling, only covers one language, and is only as
accurate as its hand-tuned configuration. Meanwhile, the renderer was just a
custom list for data the graph renderer can already display. Both were removed
during the renderer review.

## Proposed sources

A built-in messaging projection should follow the same principle as our
[dependency injection model](../../models/dependency-injection-model.md): read a
declared contract or ask the framework directly, never guess from source text.
Two complementary sources fit that rule:

1. **AsyncAPI documents.**
   [AsyncAPI](https://www.asyncapi.com/docs/reference/specification/latest) (2.x
   and 3.x) is already a declared contract covering servers, channels,
   operations (`send` and `receive` in 3.x; `publish` and `subscribe` in 2.x),
   messages, and payload schemas per application. Reading committed documents
   executes no code, needs no `--trust`, and is deterministic. When a repository
   has multiple AsyncAPI documents (one per service), they join naturally on
   channel addresses and message IDs.
2. **Framework subscriber registries.** When there is no AsyncAPI document — or
   when you want to verify that the code matches it — we can ask the framework
   what it registered without ever connecting to a broker. By analogy with the
   DI extractors, good candidates are NestJS microservice handlers
   (`@MessagePattern`, `@EventPattern`) read from the container in preview mode;
   Spring `@KafkaListener`, `@RabbitListener`, and `@JmsListener` endpoints plus
   Spring Cloud Stream bindings from the bean factory; and .NET MassTransit or
   NServiceBus endpoint and consumer registrations from the built host. Like
   `nestjs-di`, `spring-di`, and `dotnet-di`, these run application code, need
   `--trust`, and could share the same helpers.

Both sources describe static structure, not live traffic. Broker introspection,
consumer lag, throughput, and traced message flows are out of scope because they
depend on the runtime environment and the moment in time, not on the Git
revision (see
[determinism and authority](../../models/domain-model/extension-points.md#determinism-and-authority)).

## Model sketch

Whichever source produces it, the extraction uses one `architecture/v0` model:

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

Because IDs never include versions or file positions, editing a payload shows up
as a single modified message, and moving a handler updates evidence without
changing identity. Channels that have publishers but no consumers (or vice
versa) fall out as ordinary graph facts that the presentation can highlight.

## Presentation

We should start with the graph renderer's `architecture` view — applications as
boundaries with channels between them — rather than building a new renderer. A
comparison will show a new subscriber, a removed publisher, or a rewired channel
as graph changes in step order, and a payload edit as a modified message.
Following the API compatibility comparator's approach (in progress), a
comparator could also flag whether a payload change is compatible or breaking
for each consumer. A dedicated renderer only makes sense if the graph fails to
make those changes clear.

## Open questions

- AsyncAPI 2.x and 3.x frame operations from opposite perspectives, so we will
  need to normalize both to `sends` and `receives` from the application's point
  of view.
- We need a clean way to join channels across services when addresses are
  parameterized or environment-specific (such as `orders.{region}`) without
  inventing fake identity.
- Should registry extraction validate against a committed AsyncAPI document and
  report drift, or simply union the two?
- Which ecosystems should go first? NestJS and Spring are natural starting
  points because they reuse existing helpers.
