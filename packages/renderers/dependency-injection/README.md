---
description: "Built-in DI renderer: registrations and their lifetime marks"
---

# Dependency-injection renderer

`@githubnext/projections-renderer-dependency-injection` presents an
`architecture/v0` container composition, or a comparison of two, as one card per
registration. It handles the definition renderer name `dependency-injection` and
is built with the [renderer kit](../kit/README.md).

## What it shows

A container registration is three entities — the requested **service**, the
**registration** that binds it and the **implementation** that satisfies it —
but one decision, so they fold into one card:

- A card is a kit graph card (the kit's card metrics and text styles): its kind
  line names the contract (or says `Self-registered` when the implementation is
  registered as its own type) with the **lifetime** at its right, and the
  implementation sits under it; the stacking says one implements the other.
- The **lifetime mark** beside those two lines draws the lifetime: solid for a
  singleton, dashed for scoped, dotted for transient, faint dots for an
  implementation no registration resolves. The host's legend shows each mark
  with what it means (`Singleton: one per app`).
- Several registrations of one service stack (`×n`); keyed services show their
  key.
- The lifetime label is the container's own scope name when it says more than
  the lifetime (`Prototype`, `Request`, `Session`), from the registration's
  `data.scope`. A registration whose container changed its lifetime
  (`data.declaredLifetime`, NestJS's implicit request scoping) says so in its
  accessible label.
- An alias registration (a `registration → service` relationship, NestJS's
  `useExisting`) names the service it forwards to and is drawn as a dotted alias
  arrow, called out in the legend.
- A card shows its container name (`data.name`, a Spring bean name) when it is
  not the one derived from its type, or when another card would otherwise read
  the same, and otherwise its module (`data.module`).
- Constructor dependencies (`implementation → service` relationships) are arrows
  from the card that injects to the card it receives. A collection dependency is
  dashed, an optional one faint, and a `resolves` relationship (resolved at run
  time from a scope) is dashed and called out in the legend, which the host
  draws once beside every pane (`diLegend`).

Composition is derived from endpoint kinds (`service`, `registration`,
`implementation`), not relationship kinds. The last registration of a service
(by `data.ordinal`) is the one the container resolves. Every card part, and
every arrow, is a keyboard-focusable button that selects its entity or
relationship row.

## Timeline

The comparison decides the order; this renderer follows its steps on the kit's
schedule (`scheduleSteps`, with the kit's holds between steps) and reports their
ends to the host. A card arrives in the earliest step that changes one of its
parts (service, registration or implementation), leaves in the latest, and an
existing card's lifetime mark morphs between its patterns, and its text
crossfades, in the latest step that changes it. A dependency arrow is a
relationship row: it fades in, out, or across to its new endpoints in its own
step. A custom comparator's order (for example the `priority-order` example)
therefore changes what happens first, and an explicit reverse order is followed
when playing backward.

Both revisions share one layered layout, so no card moves while scrubbing, and
the view box covers both endpoints, so the composition never zooms. It opens
fitted to the frame and never magnified, unless that draws its text below the
kit's 8 px opening floor: then it opens at the floor, at the top centre (its
root), and scrolls; the host draws the kit's `zoomControls` (Zoom out stops at
the fit, Fit to view returns to it, Zoom in enlarges it), and Ctrl/⌘-wheel or
pinch zooms too. Arrows never outlive or precede their cards. Change emphasis
uses the host's `highlighting` only, so both endpoints are neutral. Identity
comes only from the comparison. At most 400 cards are drawn.

## Diff mode

Besides side by side, animated and swipe, the renderer declares the host's
`diff` comparison mode: both revisions at once, in the same union layout the
transition uses. The host's summary bar, along the bottom of every view, counts
the composition
(`10 services +2 −1 · 11 registrations +2 −1 ~1 · 11 implementations +2 −1 · 10 dependencies +3 −2 · 1 runtime resolution +1`),
then what changed about units in both revisions, by the field it is read from
(`1 lifetime changed`; `implementation`, the service's `type`, the registration
count) and units renamed, each filtering to its cards. A registration is counted
once, as an entity: the relationships that fold a service's parts into its card
(`registration`, `implements`, `provides`, `imports`) are structure. The view
draws no summary line.

Every changed card takes the kit graph card's change marks (the kit's
`CardChangeMarks`, as the dependency graph's cards do): filled with its change's
hue under a strong edge of it, and its status in a band across its bottom. The
fill is drawn in slices, one per part (the lifetime, the contract and the
implementation), so a part that changed tints its own slice with its own change.

- An added card is green, a removed one red, dashed and struck through.
- A modified card shows each change in place, its old value struck through then
  the new one: a lifetime at the kind line's right (`Scoped → Singleton`), an
  implementation as the old name above the new. Other changes (the service type,
  the registration count) are listed under the name. Its band says what changed
  (`Lifetime changed`).
- A card in both revisions that gained or lost links takes the modified hue,
  lists them under its name by the cards they point at
  (`− IPricing + IPriceCalculator`) and says so in its band
  (`Dependencies changed`, `Runtime resolution added`); the links are drawn
  green, or red and dashed, and a rewired link shows both.
- Text is never cut short: long contracts, implementations, keys, notes, link
  names and old and new values wrap onto more lines (breaking long identifiers
  after `_ . / - , :` first), and a lifetime or key stays beside its name when
  it fits, or takes a line of its own. Wrapped text and change lines make a card
  taller and move the layers below it down, so nothing overlaps.

The diff opens fitted, the whole composition in view, as the transition and a
single revision do, or at the 8 px opening floor on its top row's leftmost card;
Zoom in enlarges it.

Every change is in each part's accessible label too ("lifetime changed, was
Scoped, now Singleton"). Colors follow the host's highlighting, so turning it
off draws the marks plain; struck text and dashed removed links remain.

## Development

```sh
npm run build -w @githubnext/projections-renderer-dependency-injection
npm test -w @githubnext/projections-renderer-dependency-injection
# Dense scrubbing in the real host frame (Chromium and WebKit, desktop and mobile)
npm run test:browser -w @githubnext/projections-renderer-harness -- dependency-injection/
```

`test/fixtures/` holds synthetic before/after pairs of plain protocol-v0
extractions (`orders`, `scoring`) and real `nestjs-di` and `spring-di` output
for their sample applications (`nestjs-orders`, `spring-orders`; see
`test/fixtures.mjs`). The model all of them follow is
[one model for dependency injection](../../../docs/models/dependency-injection-model.md),
and `test/invariants.mjs` exports frame checks (`checkTransitionFrame`,
`measureRenderedFrame`, `checkRenderedFrame`) shared with browser scrubbing
tests.
