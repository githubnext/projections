# One model for renderer scenarios

The `scenarios/v0` vocabulary extends `graph/v0` to represent renderer fixture
scenarios ([`projections.scenarios`](../contracts/scenarios.md) documents) as
ordinary data. That lets a renderer present them directly: the
[`renderer-scenarios`](../builtins/extractors/renderer-scenarios.md) extractor
produces this model, and the [`gallery`](../builtins/renderers/gallery.md)
renderer reads it to draw each scenario inside a nested instance of the renderer
it targets.

## Entities

- `scenarios` represents a single scenarios document. Its `data.path` (required)
  is the repository-relative file path, `data.renderer` is the default renderer
  named by the document, and `data.scenarios` lists its scenario entity IDs in
  document order (so adding a new scenario modifies the document entity rather
  than shifting its neighbors).
- `scenario` represents one scenario, labeled with its title. Its `data`
  contains:
  - `renderer` (required): the built-in renderer's name, or a custom bundle's
    manifest name (falling back to `custom` if the revision has no manifest).
  - `bundle`: the repository-relative directory of a custom bundle, omitted for
    built-in renderers.
  - `mode` (required): either `extraction` or `comparison`.
  - `extraction`: in `extraction` mode, the normalized extraction being shown.
  - `before`, `after`, and `comparison`: in `comparison` mode, the two
    normalized extractions and the comparison produced by its comparator.
  - `comparator`: `default`, or the repository-relative path to a comparator
    file.
  - `group`: the group header it appears under — either its own group or the
    parent document's title.
  - `description`: a short summary of what the scenario demonstrates.
  - `presentation`: the definition's `presentation` block (host and renderer
    settings).

## Relationships

- `contains` links a `scenarios` document to each of its scenarios.

## Identity

A scenario's ID is `scenario:<document path>:<scenario id>`, and a document's ID
is `scenarios:<document path>`, with each part percent-encoded. Editing a
fixture only marks its scenario as modified, while moving a document replaces
its scenarios.
