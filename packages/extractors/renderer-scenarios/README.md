---
description: "Renderer fixture scenarios as data, for the gallery renderer (graph/v0 with scenarios/v0)"
---

# Renderer scenarios — `graph/v0` with `scenarios/v0`

`renderer-scenarios` reads every
[`projections.scenarios`](../../../docs/contracts/scenarios.md) document in the
revision (`**/scenarios.json` by default) and describes each scenario as data:
the renderer that draws it, and its synthetic extraction, or its before and
after and their comparison. The [`gallery`](../../renderers/gallery/README.md)
renderer presents them, each drawn by its own renderer, nested.

```json
{
  "id": "renderer-gallery",
  "extractor": "renderer-scenarios",
  "renderer": "gallery",
  "inputs": {"include": ["packages/renderers/*/scenarios.json"]}
}
```

- `include` (optional): globs of the documents to read; `**/scenarios.json`
  without it. A matching file of another format is left out, with a diagnostic.
- `exclude` (optional): globs of documents to leave out.

Each document is a `scenarios` entity (`data.path`, and `data.renderer` when it
names a default) that `contains` its `scenario` entities. A scenario's `data`
has `renderer` (a built-in name, or a custom bundle's manifest name with
`bundle`, its directory), its resolved `group`, `description`, `presentation`
and `mode`: `extraction` with `extraction`, or `comparison` with `before`,
`after`, `comparison` and `comparator` (`default` or the comparator file's
path). Extractions are normalized by the Engine; files may hold a raw extraction
or a saved `projections.extraction` document. The
[scenarios model](../../../docs/models/scenarios-model.md) defines the
`scenarios/v0` vocabulary.

Comparisons are computed with the runner's comparison service
(`Context::compare`): the default comparator module, or the scenario's
comparator file read from the examined revision, both run in the comparator
runtime's sandbox and validated by the Engine, exactly as for a projection.
Comparator files are data, so nothing here runs repository code and it never
needs trust. The `projections` CLI provides the service to its built-in
extractors; elsewhere the extraction fails, saying so.

Scenario IDs are `scenario:<document path>:<scenario id>`, so moving a document
replaces its scenarios. The extraction fails, naming the document and scenario,
on an unknown field, a duplicate or unsafe scenario ID, a path that is absolute,
a URL or leaves the project, an invalid extraction, or a comparator that fails.
Custom renderer bundles are named, never run.
