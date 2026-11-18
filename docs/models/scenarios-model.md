# One model for renderer scenarios

The `scenarios/v0` vocabulary, over `graph/v0`, describes renderer fixture
scenarios ([`projections.scenarios`](../contracts/scenarios.md) documents) as
data, so a renderer can present them: the
[`renderer-scenarios`](../builtins/extractors/renderer-scenarios.md) extractor
writes it and the [`gallery`](../builtins/renderers/gallery.md) renderer reads
it, drawing each scenario with the renderer it names, nested.

## Entities

- `scenarios`: one document. `data.path` (required): its repository-relative
  path; `data.renderer`: the renderer it names by default; `data.scenarios`: its
  scenarios' entity IDs in the document's order (so adding a scenario modifies
  its document, not its neighbours).
- `scenario`: one scenario, labeled with its title. Its `data`:
  - `renderer` (required): the built-in renderer's name, or a custom bundle's
    manifest name (`custom` when the revision has no manifest).
  - `bundle`: the custom bundle's directory, repository-relative; absent for a
    built-in renderer.
  - `mode` (required): `extraction` or `comparison`.
  - `extraction`: in `extraction` mode, the normalized extraction it presents.
  - `before`, `after` and `comparison`: in `comparison` mode, the normalized
    extractions and their comparison, as its comparator computed it.
  - `comparator`: `default`, or the comparator file's repository-relative path.
  - `group`: the group it is shown under: its own, else its document's title.
  - `description`: what it shows.
  - `presentation`: its definition `presentation` (host and renderer settings).

## Relationships

- `contains`: from a `scenarios` document to each of its scenarios.

## Identity

A scenario's ID is `scenario:<document path>:<scenario id>` and a document's
`scenarios:<document path>` (each part percent-encoded), so a fixture edit
modifies its scenario and moving a document replaces its scenarios.
