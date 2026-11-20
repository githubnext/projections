# Scenarios

A `projections.scenarios` version 0 document (conventionally `scenarios.json`,
placed beside a renderer's `package.json`) defines fixture scenarios for
developing and testing renderers and comparators. You can inspect these
scenarios interactively in the fixtures workbench—using **Projections: Open
Renderer Scenarios…** in VS Code, or `projections-renderer-workbench` from
`@githubnext/projections` in a browser (both backed by
`projections serve --stdio --fixtures`)—and `@githubnext/projections/testing`
runs the built-in renderer checks against them.

```json
{
  "format": "projections.scenarios",
  "version": 0,
  "title": "Graph",
  "renderer": "graph",
  "scenarios": [
    {"id": "platform", "title": "Service platform", "description": "Payments split out of orders.",
     "before": "fixtures/platform-before.json", "after": "fixtures/platform-after.json"},
    {"id": "platform-priority", "title": "Payments first", "group": "Custom order",
     "before": "fixtures/platform-before.json", "after": "fixtures/platform-after.json",
     "comparator": {"file": "../comparators/priority-order.comparator.yaml", "options": {"priority": ["payments"]}},
     "presentation": {"mode": "side-by-side"}},
    {"id": "snapshot", "title": "One revision", "renderer": {"bundle": "dist"},
     "extraction": {"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []}}
  ]
}
```

Each scenario entry follows these rules:

- `id` must be filename-safe and unique within the document. `title` is
  required, and `description` is optional. Scenarios are grouped under their
  `group` if set, falling back to the document's `title` and then its source
  name.
- A scenario represents either a comparison (`before` and `after`) or a single
  revision (`extraction`), never both. Each side can be an inline extraction or
  a relative path to a JSON file containing either a raw extraction or a saved
  `projections.extraction` document (in which case its `extraction` field is
  used).
- `renderer` takes either a built-in renderer name or
  `{"bundle": "<directory>"}` relative to the document, defaulting to the
  document-level `renderer`. Because a bundle is repository code, hosts only
  serve it when it is explicitly named (via `serve --fixtures … --renderer DIR`,
  or the projection's own bundle during `check`) or when `--trust` is active (a
  trusted workspace in VS Code). Without trust, the host falls back to the
  built-in renderer for the scenario's schema and displays a notice.
- `comparator` (allowed on comparisons only) accepts `{"options"}` for the
  default comparator, or a comparator file path—either as a bare string or as
  `{"file", "options"}`—resolved relative to the document, just like in
  projection definitions.
- `presentation` uses the same format as a definition's
  [presentation](definitions.md) block.
- All paths must be relative (they may use `..`) and can never be absolute paths
  or URLs. Unknown fields are rejected as errors. Scenario documents and
  extraction files are capped at 32 MiB, comparator files at 16 MiB, and a
  single document can contain at most 1,000 scenarios.

The JSON Schema lives at `packages/schemas/schemas/scenarios/v0.json`, and you
can validate any scenarios file through the Engine with
`projections validate scenarios.json`.
