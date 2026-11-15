# Dependency injection

An application's dependency injection container as it is composed: a card per
registration, joining the service that is requested, the implementation that
satisfies it and the lifetime it lives for, with an arrow for every constructor
dependency. Compared across a pull request, it answers "which services were
added, swapped or rescoped, and what now depends on what?"

<!-- generated: facts -->

- Name: `dependency-injection`
- Draws: [`architecture/v0`](../../reference/schemas/architecture.md) with the
  `dependency-injection/v0` vocabulary
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-dependency-injection`

<!-- end generated: facts -->

## When to use it

Use it to review changes to how an application wires itself: a new service
registered, an implementation swapped behind an interface, a lifetime changed
from scoped to singleton, a dependency added to a constructor. It draws the
[dependency injection model](../../models/dependency-injection-model.md), as the
.NET, NestJS and Spring extractors write it; for other `architecture/v0`
extractions use [`graph`](graph.md).

Built-in extractors that draw with it by default:

<!-- generated: extractors -->

| Built-in extractor                        | Its default `renderer` |
| ----------------------------------------- | ---------------------- |
| [`dotnet-di`](../extractors/dotnet-di.md) | `dependency-injection` |
| [`nestjs-di`](../extractors/nestjs-di.md) | `dependency-injection` |
| [`spring-di`](../extractors/spring-di.md) | `dependency-injection` |

<!-- end generated: extractors -->

## What it draws

A registration is three entities (the requested **service**, the
**registration** that binds it and the **implementation** that satisfies it) but
one decision, so they fold into one card:

- The card's top line names the service's contract (or says `Self-registered`
  when the implementation is registered as its own type), and the implementation
  sits under it; the stacking says one implements the other.
- The **lifetime mark** beside those lines draws its lifetime: solid for a
  singleton, dashed for scoped, dotted for transient. The lifetime is also named
  at the top line's right (`Singleton`, `Scoped`, `Transient`, or the
  container's own scope name when it says more: `Prototype`, `Request`,
  `Session`). The host's legend, beside the view, shows each mark and what it
  means.
- Several registrations of one service stack (`×3`); keyed services show their
  key, and a card shows its container name (a Spring bean name) or its module
  when that tells it apart.
- An alias registration (NestJS's `useExisting`) is a dotted arrow to the
  service it forwards to.
- Constructor dependencies are arrows from the card that injects to the card it
  receives: dashed for a collection, faint when optional, and dashed and muted
  for a service resolved at run time from a scope.

Cards are laid out in layers from the application's roots down. The view opens
fitted, everything in view, unless that would draw its smallest text below 8 px;
then it opens at that size, at the top centre, and you scroll for the rest. At
most 400 cards are drawn.

## Options

It declares no options. The host draws its zoom actions, **Zoom in**, **Zoom
out** and **Fit to view** (`zoom-in`, `zoom-out`, `zoom-fit`), which are actions
rather than options; Ctrl/⌘-wheel and pinch zoom too.

It presents a comparison in every mode: Diff, where a comparison opens, then
Side by side, Animated and Swipe. `presentation.mode` picks another to open in.

## What a comparison shows

- **Side by side and Swipe**: each pane draws one revision; while the host
  highlights changes, each marks its side of them.
- **Animated**: both revisions share one layout, so no card moves while you
  scrub. A card arrives in the earliest step that changes one of its parts and
  leaves in the latest; an existing card's lifetime mark morphs and its text
  crossfades in the step that changes them; an arrow fades in, out or across to
  its new endpoints in its own step.
- **Diff**: both revisions at once in the same layout. Changed cards are drawn
  as the dependency graph's are: filled and edged in their change's hue, with
  their status in a band across the bottom. An added card is green; a removed
  one red, dashed and struck through. A modified card shows each change in
  place, the old value struck through then the new one (`Scoped → Singleton`
  beside the contract), and says it in its band (`Lifetime changed`). A card
  that gained or lost dependencies lists them by the cards they point at
  (`− IPricing + IPriceCalculator`) and says so in its band
  (`Dependencies changed`); the arrows are drawn green, or red and dashed. Text
  is never cut short: long names wrap, and the card grows.

Marks follow the host's highlighting, so Before, After and highlighting off draw
plain (struck text and dashed removed arrows remain in Diff).

The **summary bar** counts the composition, with each kind's changes: services,
registrations, implementations, modules, dependencies, runtime resolutions and
aliases
(`10 services +2 −1 · 11 registrations +2 −1 ~1 · 10 dependencies +3 −2 · 1 runtime resolution +1`).
Then, in a comparison, what changed about cards present in both revisions, each
filtering to its cards: `1 lifetime changed`, `1 implementation changed`,
`1 service type changed`, `1 registration count changed`, and
`1 service renamed`.

Every part of a card, and every arrow, is selectable; selecting a card also
labels its arrows with the constructor parameter each one fills (or "resolved at
runtime", "alias of").

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "dotnet-di",
  "id": "dotnet-di",
  "inputs": {
    "project": "src/App/App.csproj"
  },
  "renderer": "dependency-injection",
  "title": ".NET dependency injection"
}
```

<!-- end generated: definition -->

## Limitations

- It draws what the container composes: registrations made conditionally at run
  time, or by code the extractor doesn't execute, aren't there.
- It draws at most 400 cards; for larger containers, narrow the extraction (the
  NestJS and Spring extractors' `include`).
- Layout is automatic: cards can't be grouped by module or feature.
- It shows that a lifetime changed, not whether the change is safe (a singleton
  now capturing a scoped service); a comparator file can say so.

## Related

- The extractors it draws by default: [`dotnet-di`](../extractors/dotnet-di.md),
  [`nestjs-di`](../extractors/nestjs-di.md) and
  [`spring-di`](../extractors/spring-di.md).
- The [dependency injection model](../../models/dependency-injection-model.md)
  they write.
- [`graph`](graph.md), whose `architecture` presentation draws other component
  graphs.
- [The default comparator](../comparators/default.md), which decides the steps
  the animation plays.

## How it works

The [package README](../../../packages/renderers/dependency-injection/README.md)
covers how registrations fold into cards and how the transition is staged.

## Build your own

This renderer draws one card per registration, laid out by what depends on what.
Write your own renderer when your reviewers need another view of the container:

- **Grouped by module or feature**: the registrations each module or assembly
  contributes, side by side, with the dependencies that cross them.
- **Organized by lifetime**: every singleton, then every scoped service, to spot
  captive dependencies at a glance.
- **Your framework's own notation**: Angular's injector tree, Dagger's
  components and subcomponents, or the request pipeline a web framework builds.

Try the lighter options first. To call out the changes that matter (a singleton
that now depends on a scoped service, a service no longer registered), add a
comparator file: its summaries reach the host's details, and its order changes
which step plays first. `presentation.mode` sets the mode a comparison opens in,
and [`graph`](graph.md) draws the same extraction as plain cards and arrows.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. It writes the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), and
opens the definition and the projection's tab. Or choose **Ask an agent to write
it** and describe what the projection should show.

**With the CLI**:

```sh
projections init <id> --extractor nestjs-di --renderer custom
```

Then, in the renderer package, run `npm install`, then `npm run dev` for a
development server with hot updates, `npm run workbench` to open its scenarios
in the fixtures workbench in a browser, and `npm test` to run the renderer
checks on every scenario. In VS Code an open projection tab uses your
uncommitted definition edits ("Your edits"), and saving the renderer's sources
rebuilds it (in a trusted workspace, while its tab is open, with its `watch` or
`build` script) and reloads the view; the Testing view runs each projection's
checks (`projections check -p <id>`, renderer checks included).
[Develop a renderer](../../guides/develop-a-renderer.md) walks through it; the
[renderer kit guide](../../guides/renderer-kit.md) and the
[renderer kit API](../../reference/renderer-kit.md) cover the pieces.
