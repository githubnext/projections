---
description: "Built-in gallery renderer: renderer scenarios, each drawn by its own renderer, nested"
---

# Gallery renderer

`@githubnext/projections-renderer-gallery` presents renderer fixture scenarios,
which the [`renderer-scenarios`](../../extractors/renderer-scenarios/README.md)
extractor reads from `scenarios.json` documents: each scenario is a card, and
inside it the scenario's own renderer draws its synthetic extraction or
comparison. It handles the `gallery` definition renderer name and accepts only
`graph/v0` extractions that declare the `scenarios/v0` vocabulary.

## Extraction shape

`scenarios` entities (one per document) that `contains` their `scenario`
entities; the [scenarios model](../../../docs/models/scenarios-model.md) lists
their data. Each document is a group, its scenarios in the document's order and
in runs by their `group`; each card names its renderer, how many changes its
comparison has and the comparator file that made it.

## Nesting

Each card asks the host for its renderer's document by name
([`document-request`](../../../docs/contracts/renderer-frames.md)) and runs it
with the SDK's `embedRenderer`, in a sandboxed `srcdoc` frame that inherits the
gallery's content security policy. Hosts supply only built-in renderers, so a
scenario drawn by a custom bundle is named, with its directory, and not drawn; a
host's refusal is shown on the card. The nested renderer gets the scenario's
extraction, or its comparison in diff mode when it supports diff, else animated
and resting on the after revision with its changes emphasized, with the
scenario's `presentation.kinds` and `rendererOptions`; hovering or focusing the
card plays it once (never under reduced motion). The host's theme, motion
preference and locale reach every nested frame. Selecting inside a nested
drawing selects its scenario.

A gallery of at most 12 scenarios runs every renderer. A larger one in a frame
that scrolls runs only those within about a screen of the view, so a long
gallery keeps a few frames alive; in a content-sized frame (an image, the
renderer checks) it draws its first two scenario sets, up to 12 scenarios each,
chosen by order alone, and names the rest. Four renderers load at a time, and
each one the gallery runs holds its paint acknowledgement until it has painted,
so hosts never show or capture a half-drawn card. A nested renderer that reports
an `error`, or hasn't painted 10 seconds after `ready`, fails its card with the
reason, which frees its load slot and its hold.

## Comparison modes

`diff` (the default), `side-by-side` and `animated`. A comparison marks the
scenarios a change added, removed and redrew (and the documents it changed);
each card draws the revision it is in at that moment. In diff mode a redrawn
scenario offers both of its revisions.

## Develop

```sh
npm run build -w @githubnext/projections-renderer-gallery
node packages/renderers/gallery/scripts/fixtures.mjs   # the scenario fixtures, from the native CLI
npm run test:browser -w @githubnext/projections-renderer-harness -- gallery/ --project=chromium-desktop
```
