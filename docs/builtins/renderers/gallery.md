# Gallery

Renderer fixture scenarios, each drawn by its own built-in renderer inside a
card. The [`renderer-scenarios`](../extractors/renderer-scenarios.md) extractor
reads them from the `scenarios.json` documents renderer authors already keep, so
a gallery is a living catalog of what your renderers draw, built from synthetic
data alone: viewing it runs no repository code and needs no `--trust`.

<!-- generated: facts -->

- Name: `gallery`
- Draws: [`graph/v0`](../../reference/schemas/graph.md) with the `scenarios/v0`
  vocabulary
- Comparison modes: Diff, Side by side, Animated; a comparison opens in Diff
- Package: `@githubnext/projections-renderer-gallery`

<!-- end generated: facts -->

## When to use it

Use it for a repository that has renderers and their scenarios, such as
Projections itself (its `renderer-gallery` projection). In review, it shows
which scenarios a pull request added, removed or redrew, each drawn by the
renderer that draws it, so a fixture change reads as the picture it changes.

<!-- generated: extractors -->

| Built-in extractor                                          | Its default `renderer` |
| ----------------------------------------------------------- | ---------------------- |
| [`renderer-scenarios`](../extractors/renderer-scenarios.md) | `gallery`              |

<!-- end generated: extractors -->

## What it draws

Each scenarios document is a group, titled with the document's title, and each
scenario a card: its title and ID, the drawing, its description, its renderer,
how many changes its comparison has and the comparator file that made it. The
renderer draws inside the card in a sandboxed frame nested in the gallery's,
with the host's theme: a comparison in its diff when the renderer has one,
otherwise resting on its after revision, emphasized, and playing from before to
after while the pointer or focus is on the card. Selecting inside a drawing
selects its scenario.

Hosts supply only built-in renderers for nesting, so a scenario drawn by a
custom bundle is named, with its directory, and not drawn. A card whose renderer
the host refuses, or that reports an error or doesn't draw, says why.

## Options

The gallery declares no controls.

## What a comparison shows

Added, removed and redrawn scenarios are marked like any kit card, and a
document whose scenario list changed is marked too. Each card draws the revision
it is in at that moment; in diff mode a redrawn scenario's card offers both of
its revisions.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "renderer-scenarios",
  "id": "renderer-scenarios",
  "renderer": "gallery",
  "title": "Renderer scenarios"
}
```

<!-- end generated: definition -->

## Limitations

- Only built-in renderers draw nested; custom bundles are named.
- A long gallery in a scrolling view runs only the renderers near the view, so
  cards far from it load as you scroll to them. An image of a long gallery draws
  its first two scenario sets (up to 12 scenarios each) and names the rest.
- Nested comparisons are computed when the gallery is extracted, so they are the
  scenario's comparator's, not the host's comparator choice.

## Related

- [`renderer-scenarios`](../extractors/renderer-scenarios.md), which reads the
  scenarios.
- [Renderer frames](../../contracts/renderer-frames.md), on nested renderers.
- [Develop a renderer](../../guides/develop-a-renderer.md), where scenarios come
  from.

## How it works

The [package README](../../../packages/renderers/gallery/README.md) covers
nesting, loading and the comparison modes.
