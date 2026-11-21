# Renderer scenarios

This extractor turns the `scenarios.json` fixture files that renderer authors
already maintain into structured data: each scenario paired with its renderer
and synthetic extraction (or its before/after extractions and comparison).
Displayed with the [`gallery`](../renderers/gallery.md) renderer, it gives you a
living catalog of what your renderers draw—and across a pull request, it shows
which scenarios were added, removed, or redrawn.

<!-- generated: facts -->

- ID: `renderer-scenarios`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`gallery`](../renderers/gallery.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `**/scenarios.json`

<!-- end generated: facts -->

## When to use it

Use this extractor in any repository that develops renderers and keeps scenario
fixtures (like Projections itself, or your own custom renderer repo). Because
every scenario is synthetic data committed to Git, no repository code runs and
no `--trust` is required. When a pull request edits a fixture, reviewers see the
updated scenario redrawn directly by its renderer.

## What it reads

The extractor finds every document matching `include` (`**/scenarios.json` by
default), skips anything matching `exclude`, and loads the extraction and
comparator files each scenario references.

Each document becomes a `scenarios` entity that `contains` its `scenario`
entities, labeled by title. Every scenario records which renderer draws it along
with its data—either a single normalized extraction, or a before/after pair and
the comparison produced by its comparator (using the default comparator unless a
comparator file is named). See the
[scenarios model](../../models/scenarios-model.md) for the full field list.

Scenario comparisons run in the same sandbox as normal comparisons, and
comparator files are treated purely as data. If a scenario references a custom
renderer bundle, its name and directory are recorded, but it isn't rendered
inline because hosts only embed built-in renderers.

Renderer names must be 1 to 100 characters using letters, digits, `.`, `_`, and
`-` (per the scenarios schema); if a name doesn't match a built-in renderer, the
gallery reports that on the card. Extraction fails—naming the offending document
and scenario—on unknown fields, duplicate or unsafe IDs, absolute paths, URLs,
paths outside the project, invalid extractions, or failing comparators.

## Options

<!-- generated: inputs -->

| Input     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `exclude` | Globs of documents to leave out.                                             |
| `include` | Globs of projections.scenarios documents to read; default **/scenarios.json. |

<!-- end generated: inputs -->

## What a comparison shows

- **Scenarios** that were added, removed, or modified (including changes to
  their fixtures, comparator, title, group, description, or presentation).
- **Documents** that were added or removed.

The [`gallery`](../renderers/gallery.md) renderer renders each scenario as a
card containing its nested renderer, highlights added, removed, and modified
cards, and opens modified cards directly on their updated output.

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

- Custom renderer bundles are named on their cards, not drawn inline.
- Because a scenario's ID includes its document path, moving a scenario file
  shows up as removing the old scenarios and adding new ones.
- The entire gallery fits into a single extraction, so very large fixtures can
  bump into the 8 MiB limit on extractor output.

## Related

- [`gallery`](../renderers/gallery.md) — the renderer that displays the catalog.
- [Scenarios](../../contracts/scenarios.md) — the scenario document format.
- [Develop a renderer](../../guides/develop-a-renderer.md) — how to author
  renderers and scenarios.

## How it works

See the
[package README](../../../packages/extractors/renderer-scenarios/README.md) for
details on what the extractor loads, what it rejects, and how scenario
comparisons run.
