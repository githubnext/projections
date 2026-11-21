# Gallery

This renderer displays renderer fixture scenarios as a visual catalog, drawing
each scenario inside its own card using its built-in renderer. The
[`renderer-scenarios`](../extractors/renderer-scenarios.md) extractor reads
these from the `scenarios.json` documents renderer authors already maintain.
Because everything runs on synthetic fixture data, viewing a gallery executes no
repository code and doesn't require `--trust`.

<!-- generated: facts -->

- Name: `gallery`
- Draws: [`graph/v0`](../../reference/schemas/graph.md) with the `scenarios/v0`
  vocabulary
- Comparison modes: Diff, Side by side, Animated; a comparison opens in Diff
- Package: `@githubnext/projections-renderer-gallery`

<!-- end generated: facts -->

## When to use it

Use gallery in repositories that maintain renderers and fixture scenarios—like
Projections itself (via its `renderer-gallery` projection). During code review,
it shows which scenarios a pull request added, removed, or redrew, each rendered
by its own built-in renderer, so you can review fixture updates as actual
visuals instead of raw JSON.

<!-- generated: extractors -->

| Built-in extractor                                          | Its default `renderer` |
| ----------------------------------------------------------- | ---------------------- |
| [`renderer-scenarios`](../extractors/renderer-scenarios.md) | `gallery`              |

<!-- end generated: extractors -->

## What it draws

Each scenarios document becomes a titled group, and each scenario inside it
becomes a card showing its title and ID, the rendered diagram, its description,
the renderer name, its change count, and the comparator file that produced it.

Each nested renderer runs in its own sandboxed frame inside the card using the
host's theme. Comparisons open in Diff mode when the renderer supports it;
otherwise the card rests on the After revision with changes highlighted, and
animates from Before to After when hovered or focused. Clicking inside a
scenario's drawing selects that scenario.

Hosts only supply built-in renderers for nesting, so any scenario targeting a
custom bundle is listed by name and directory rather than rendered. If a host
refuses a renderer, or a nested renderer errors out or fails to draw, the card
explains why.

## Options

Gallery declares no controls.

## What a comparison shows

Added, removed, and redrawn scenarios are marked like any other kit card, and
documents whose scenario list changed are marked as well. Each card renders the
revision active at that moment; in Diff mode, a redrawn scenario's card lets you
inspect both revisions.

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

- Only built-in renderers render inside nested cards; custom renderer bundles
  are listed by name only.
- In a long scrolling gallery, only renderers near the viewport run, loading
  more cards as you scroll. Static image exports of a long gallery render the
  first two scenario sets (up to 12 scenarios each) and list the rest by name.
- Nested comparisons are computed at extraction time using each scenario's own
  comparator, rather than the host's comparator selection.

## Related

- [`renderer-scenarios`](../extractors/renderer-scenarios.md) — reads the
  scenario documents.
- [Renderer frames](../../contracts/renderer-frames.md) — covers how nested
  renderers work.
- [Develop a renderer](../../guides/develop-a-renderer.md) — explains how to
  author scenarios.

## How it works

See the [package README](../../../packages/renderers/gallery/README.md) for
details on frame nesting, lazy loading, and comparison modes.
