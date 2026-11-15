# Scenarios

A `projections.scenarios` version 0 document (conventionally `scenarios.json`
next to a renderer's `package.json`) names fixture scenarios for developing and
testing renderers and comparators. The fixtures workbench presents them (in VS
Code, **Projections: Open Renderer Scenarios…**; in a browser,
`projections-renderer-workbench` from `@githubnext/projections`, both over
`projections serve --stdio --fixtures`), and `@githubnext/projections/testing`
runs the built-in checks on them.

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

- `id` is filename-safe and unique in the document; `title` is required;
  `description` is optional. A scenario is grouped under its `group`, else the
  document's `title`, else its source name.
- A scenario is a comparison (`before` and `after`) or one revision
  (`extraction`), never both. Each is an inline extraction, or a path relative
  to the document of a JSON file holding an extraction or a saved
  `projections.extraction` document (its `extraction` is used).
- `renderer` is a definition renderer name, or `{"bundle": "<directory>"}`
  relative to the document, defaulting to the document's `renderer`.
- `comparator` (comparisons only) is `{"options"}` for the default comparator,
  or a comparator file's path, alone or as `{"file", "options"}`, as in
  definitions (relative to the document).
- `presentation` is a definition's [presentation](definitions.md).
- Paths are relative, may use `..`, and are never absolute or URLs. Unknown
  fields are errors. Documents and extraction files are at most 32 MiB,
  comparator files 16 MiB, and a document holds at most 1,000 scenarios.

The JSON schema is `packages/schemas/schemas/scenarios/v0.json`; the CLI
validates documents with the Engine (`projections validate scenarios.json`).
