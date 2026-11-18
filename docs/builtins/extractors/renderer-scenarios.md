# Renderer scenarios

The fixture scenarios renderer authors already keep (`scenarios.json`
documents), as data: each scenario with the renderer that draws it and its
synthetic extraction, or its before and after and their comparison. Drawn by the
[`gallery`](../renderers/gallery.md) renderer, it is a living catalog of what
your renderers draw, and compared across a pull request it answers "which
scenarios did this change add, remove or redraw?"

<!-- generated: facts -->

- ID: `renderer-scenarios`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`gallery`](../renderers/gallery.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `**/scenarios.json`

<!-- end generated: facts -->

## When to use it

Use it in a repository with renderers and their scenarios: Projections itself,
or yours if you write renderers. Every scenario is synthetic and committed, so
the projection runs no repository code: viewing it needs no `--trust`, and a
pull request that changes a fixture shows that scenario redrawn by the renderer
that draws it.

## What it reads

The documents `include` matches (`**/scenarios.json` by default), less those
`exclude` matches, and the extraction and comparator files their scenarios name.
Each document is a `scenarios` entity that `contains` its `scenario` entities,
labeled with their titles. A scenario's data says which renderer draws it and
holds what it presents: one normalized extraction, or before, after and the
comparison its comparator computes (the default comparator, or the comparator
file it names). The [scenarios model](../../models/scenarios-model.md) lists
every field.

Comparisons run in the same sandbox as any comparison, and comparator files are
data. A scenario whose renderer is a custom bundle is named, with its directory,
but not drawn: hosts supply only built-in renderers for nesting.

A renderer is a name (1 to 100 letters, digits, `.`, `_` and `-`, as the
scenarios schema allows); one that isn't a built-in renderer is the gallery's to
report, on its card. The extraction fails, naming the document and scenario, on
an unknown field, a duplicate or unsafe ID, a path that is absolute, a URL or
outside the project, an invalid extraction or a comparator that fails.

## Options

<!-- generated: inputs -->

| Input     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `exclude` | Globs of documents to leave out.                                             |
| `include` | Globs of projections.scenarios documents to read; default **/scenarios.json. |

<!-- end generated: inputs -->

## What a comparison shows

- **Scenarios** added or removed, and scenarios modified because their fixtures,
  comparator, title, group, description or presentation changed.
- **Documents** added or removed.

The [`gallery`](../renderers/gallery.md) renderer draws each scenario as a card
with its renderer inside, marks added, removed and modified cards, and opens a
modified one on its new drawing.

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

- Custom renderer bundles aren't drawn, only named.
- A scenario's ID includes its document's path: moving a document replaces its
  scenarios.
- Large fixtures make a large extraction: the whole gallery is one extraction,
  within the 8 MiB bound on an extractor's output.

## Related

- [`gallery`](../renderers/gallery.md), which draws it.
- [Scenarios](../../contracts/scenarios.md), the document format.
- [Develop a renderer](../../guides/develop-a-renderer.md), where scenarios come
  from.

## How it works

The [package README](../../../packages/extractors/renderer-scenarios/README.md)
covers what the extractor reads and rejects, and how it compares.
