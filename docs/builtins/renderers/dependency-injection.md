# Dependency injection

This renderer maps out an application's composed dependency injection container:
one card per registration pairing the requested service, the implementation that
satisfies it, and its lifetime, connected by arrows for constructor
dependencies. Across a pull request, it shows which services were added,
swapped, or rescoped, and how the dependency graph shifted.

<!-- generated: facts -->

- Name: `dependency-injection`
- Draws: [`architecture/v0`](../../reference/schemas/architecture.md) with the
  `dependency-injection/v0` vocabulary
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-dependency-injection`

<!-- end generated: facts -->

## When to use it

Use this renderer to review changes to how your application wires its services:
new registrations, swapped implementations behind an interface, lifetime shifts
from scoped to singleton, or new constructor dependencies. It draws the
[dependency injection model](../../models/dependency-injection-model.md)
produced by the .NET, NestJS, and Spring extractors. For other `architecture/v0`
extractions, use [`graph`](graph.md).

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                        | Its default `renderer` |
| ----------------------------------------- | ---------------------- |
| [`dotnet-di`](../extractors/dotnet-di.md) | `dependency-injection` |
| [`nestjs-di`](../extractors/nestjs-di.md) | `dependency-injection` |
| [`spring-di`](../extractors/spring-di.md) | `dependency-injection` |

<!-- end generated: extractors -->

## What it draws

In the underlying extraction, a registration spans three entities—the requested
**service**, the **registration** binding it, and the **implementation**
satisfying it—but because they represent a single wiring decision, this renderer
folds them into one card:

- **Service and implementation.** The top line names the service contract (or
  `Self-registered` when a class is registered as its own type), with the
  implementation right underneath to show what satisfies it.
- **Lifetime mark.** A stroke beside the lines encodes the lifetime visually:
  solid for singleton, dashed for scoped, and dotted for transient. The lifetime
  name also appears on the top right (`Singleton`, `Scoped`, `Transient`, or a
  container-specific scope like `Prototype`, `Request`, or `Session`), and the
  host's legend explains each mark.
- **Multiple, keyed, and named registrations.** Multiple registrations for the
  same service stack with a count (`×3`). Keyed services display their key, and
  cards show their container name (such as a Spring bean name) or module when
  needed to tell them apart.
- **Aliases and dependencies.** Alias registrations (such as NestJS
  `useExisting`) draw a dotted arrow to the target service. Constructor
  dependencies draw arrows from the injecting card to the service it receives:
  dashed for collections, faint when optional, and dashed and muted for services
  resolved at runtime from a scope.

Cards are arranged in layers from the application's roots downward. The view
opens fitted to the viewport unless that would shrink the smallest text below 8
px, in which case it opens at 8 px at the top center so you can scroll. At most
400 cards are drawn.

## Options

This renderer has no options. The host provides **Zoom in**, **Zoom out**, and
**Fit to view** (`zoom-in`, `zoom-out`, `zoom-fit`) as interactive actions, and
Ctrl/⌘-wheel and pinch gestures work too.

All four comparison modes are supported—Diff (the default), Side by side,
Animated, and Swipe. Set `presentation.mode` to open in a different mode.

## What a comparison shows

- **Side by side and Swipe** draw each revision in its own pane and mark its
  changes when the host's highlighting is on.
- **Animated** shares a single layout across both revisions so cards never jump
  while you scrub. A card enters on the earliest step that touches any of its
  parts and exits on the latest; existing cards morph their lifetime mark and
  crossfade text on the step that changes them, while arrows fade in, fade out,
  or rewire in their own steps.
- **Diff** overlays both revisions in the same layout. Changed cards are filled
  and bordered in their change color with a status band across the bottom: green
  for added cards, red and dashed with struck-through text for removed cards.
  Modified cards show old values struck through beside new ones (such as
  `Scoped → Singleton` next to the contract) and state the change in their
  bottom band (`Lifetime changed`). Cards whose dependencies changed list them
  directly (`− IPricing + IPriceCalculator`) with `Dependencies changed` in the
  band, alongside green added arrows and red dashed removed arrows. Long names
  wrap rather than truncating, expanding the card as needed.

All marks follow the host's highlighting toggle, so Before, After, and
unhighlighted views render plain (struck-through text and dashed removed arrows
remain visible in Diff).

The **summary bar** totals the container's parts with their deltas—services,
registrations, implementations, modules, dependencies, runtime resolutions, and
aliases
(`10 services +2 −1 · 11 registrations +2 −1 ~1 · 10 dependencies +3 −2 · 1 runtime resolution +1`).
In a comparison, it also lists in-place changes on surviving cards, each acting
as a filter: `1 lifetime changed`, `1 implementation changed`,
`1 service type changed`, `1 registration count changed`, and
`1 service renamed`.

Every part of a card and every arrow is selectable. Selecting a card also labels
its connected arrows with the constructor parameter each one fills (or "resolved
at runtime" / "alias of").

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

- It only shows registrations the extractor actually observes—conditional
  runtime registrations or code paths the extractor doesn't execute won't
  appear.
- At most 400 cards are drawn; for larger containers, filter the extraction (for
  example, with the NestJS and Spring extractors' `include` input).
- Layout is automatic; cards can't be grouped by module or feature.
- It flags that a lifetime changed, but doesn't judge whether that change is
  safe (such as a singleton capturing a scoped service)—use a comparator file
  for those checks.

## Related

- Default extractors: [`dotnet-di`](../extractors/dotnet-di.md),
  [`nestjs-di`](../extractors/nestjs-di.md), and
  [`spring-di`](../extractors/spring-di.md).
- The [dependency injection model](../../models/dependency-injection-model.md)
  that those extractors emit.
- [`graph`](graph.md) — its `architecture` presentation draws other component
  graphs.
- [The default comparator](../comparators/default.md) — determines the step
  order for animations.

## How it works

See the
[package README](../../../packages/renderers/dependency-injection/README.md) for
how registrations fold into cards and how transitions are staged.

## Build your own

This renderer draws one card per registration, arranged by dependency direction.
Build a custom renderer when reviewers need a different lens on the container:

- **Module or feature grouping** — registrations organized by module or assembly
  side by side, highlighting cross-boundary dependencies.
- **Lifetime lanes** — all singletons together, then scoped services, making
  captive dependencies obvious at a glance.
- **Framework-specific views** — Angular's injector tree, Dagger's components
  and subcomponents, or a web framework's request pipeline.

Check the lighter options first. If you just want to flag risky changes (a
singleton depending on a scoped service, or a dropped registration), add a
comparator file—its summaries show up in the host's details panel, and its
ordering controls which steps animate first. You can also set
`presentation.mode` to pick the opening mode, or switch to [`graph`](graph.md)
to draw the same extraction as plain cards and arrows.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. VS Code scaffolds the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite, and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), then
opens both the definition and the projection tab. You can also choose **Ask an
agent to write it** and describe what you want shown.

**With the CLI**:

```sh
projections init <id> --extractor nestjs-di --renderer custom
```

Inside the generated renderer package, run `npm install`, then use `npm run dev`
for a hot-reloading dev server, `npm run workbench` to preview your scenarios in
the browser, and `npm test` to run renderer checks across every scenario.

In VS Code, an open projection tab picks up your uncommitted definition edits
("Your edits"), and saving renderer source files automatically rebuilds and
reloads the view in a trusted workspace (using its `watch` or `build` script).
Run projection and renderer checks from the Testing view or via
`projections check -p <id>`. For a full walkthrough, see
[Develop a renderer](../../guides/develop-a-renderer.md), the
[renderer kit guide](../../guides/renderer-kit.md), and the
[renderer kit API](../../reference/renderer-kit.md).
