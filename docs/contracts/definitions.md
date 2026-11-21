# Projection definitions

A projection definition ties an extractor, an optional comparator, and a
renderer together into a named view for a repository. Definitions live in
`.github/projections/<id>.json` or `.projections/<id>.json` inside a
[project](../runner/execution.md#nested-projects)—either the repository root or
a nested directory that keeps its own definitions. Every path in a definition is
relative to its project, which is also the working directory where its extractor
runs. Leading `../` segments can reach outside a nested project, though never
outside the repository itself.

```json
{
  "id": "dependencies",
  "title": "Package dependencies",
  "extractor": {"command": ["python3", "tools/x.py"], "sources": ["tools/x.py"]},
  "comparator": {"options": {"order": {"by": "dependents", "direction": "descending"}}},
  "renderer": "graph",
  "inputs": {},
  "correspondence": {"currentId": ["oldId"]},
  "execution": {"timeoutMs": 30000, "environment": [], "network": false, "reproducibility": "local", "determinism": "environmental"},
  "presentation": {"highlighting": "animated", "changesOnly": false, "mode": "side-by-side", "rendererOptions": {"showRelationships": true}}
}
```

The core component fields work as follows:

- `extractor` is either a built-in extractor ID or `{command, sources?}`.
- `comparator` is optional; when omitted, Projections uses the default
  comparator with no options. To use a custom comparator, point to a
  [comparator file](comparisons.md#comparator-files) whose path ends in
  `.comparator.yaml` or `.comparator.yml`. You can pass either the path string
  on its own (`"comparator": "tools/order.comparator.yaml"`) or
  `{file, sources?, options?}` to pass options (available to the file as
  `options`) and declare extra source files it depends on. The default
  comparator uses an object without `file`—either `{}` or
  `{options: {order: {by, direction?}}}`. The rule for telling them apart is
  straightforward: **a string, or an object with `file`, is a custom comparator;
  an object without `file` is the default comparator**, and the two forms never
  mix. The CLI normalizes both custom forms into `{file, ...}` so they produce
  the same definition digest, and the comparator file is always included in the
  definition whether or not you list it in `sources`. Comparator files are the
  only supported custom comparators—there are no comparator modules or
  JavaScript comparators. If a definition still uses `comparator.module`, the
  old `comparator.rules` key (renamed to `file`), or a path that doesn't end in
  `.comparator.y(a)ml`, Projections reports it as invalid with guidance on
  migrating to a comparator file, while still loading other valid definitions.
- `renderer` is either a built-in renderer ID or `{bundle, sources?}`, where
  `bundle` is a directory containing `index.html` and `renderer.json` (plus an
  optional `THIRD_PARTY_NOTICES.txt`, which hosts ignore).
- `sources` lists the files or directories whose contents belong to that
  component.
- `correspondence` maps a current item ID to one or more previous IDs; the
  runner applies it as `previousIds` before saving the extraction.

Execution settings control caching and what files an extractor depends on:

- `execution.determinism` describes how reproducible the extraction is, much
  like a test's stability. Set it to `pure` when output depends only on the
  revision's files (cached by Git tree, and reruns must match), `environmental`
  when output also depends on the toolchain and installed dependencies (cached
  only within a single environment fingerprint, and the default for custom
  extractors), or `observed` for live or varying data like timings (never reused
  silently). This declaration is descriptive rather than enforced:
  `projections check` reruns the extraction and warns if two runs diverge.
  Built-in extractors declare their own class; a definition can declare a less
  reproducible class, never a more reproducible one. See
  [determinism and authority](../models/domain-model/extension-points.md#determinism-and-authority).
- `execution.scope` optionally narrows what the extractor depends on to specific
  files and directories (not globs; `.` means the project itself), or widens a
  nested project's scope beyond its directory using `../` paths. See the
  [runner](../runner/execution.md#scopes) docs for details.

A definition directory can also contain `environment.json`, the repository's
environment file (`format: "projections.environment"`,
[schema](../../packages/schemas/schemas/environment/v0.json)), which specifies
the prepare steps that make a checkout ready for toolchain extractors. That
filename is reserved and is never treated as a projection definition. See
[Environments and workspaces](../runner/environments.md#environments-and-workspaces).

`presentation` is optional and sets initial viewer defaults that people can
still override in the UI:

- `highlighting` controls change highlighting (`animated`, `on`, or `off`).
- `changesOnly` is a boolean that filters down to changed items.
- `mode` chooses the comparison layout (`animated`, `side-by-side`, `swipe`, or
  `diff`) when the renderer supports it; otherwise the renderer uses its own
  default.
- `durationMs` sets playback duration at 1× speed (500–120000 ms). When omitted,
  hosts use the renderer's declared `pace.stepMs` per step, or fall back to 1500
  ms per step with a minimum of 4.5 seconds.
- `rendererOptions` sets initial values for the renderer's declared controls,
  keyed by control ID (at most 32 entries; IDs must match
  `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`, and values must be strings, numbers, or
  booleans). Hosts ignore unknown IDs or invalid values and display a notice.
- `kinds` customizes how viewers present extraction kinds, keyed by kind (at
  most 64 entries). Each entry can specify a `color`—used by renderers that
  color items by kind, such as `file-packing` for a weighted hierarchy—using
  either a semantic meaning (`danger`, `warning`, `success`, `info`, `neutral`)
  or a categorical hue (`blue`, `teal`, `pink`, `lime`, `purple`, `cyan`,
  `indigo`, `sky`, `orange`, `green`, `red`, `violet`, `emerald`, `rose`,
  `amber`, `citron`), always rendered with the host's theme tokens. An entry can
  also set a `noun`, `{"singular": …, "plural": …}` (1–64 characters each), for
  the summary bar's counts. A kind's key also names the matching flag wherever a
  renderer draws flags. Renderers ignore any kinds they don't draw.

```json
"presentation": {
  "kinds": {
    "secret": {"color": "danger", "noun": {"singular": "secret key", "plural": "secret keys"}},
    "pre-release": {"color": "warning"}
  }
}
```

The runner validates `presentation` and stores it alongside the rest of the
definition in each saved extraction's provenance, though it never changes what
gets extracted or compared.

The **definition digest** is `sha256:` computed over the RFC 8785 canonical JSON
of the definition **without `presentation`**, followed by the path and content
bytes of every file under the declared sources in sorted path order (Git blob
contents for a commit, or working-tree bytes otherwise). Leaving `presentation`
out of the digest means tweaking a viewer default never invalidates existing
extractions—two extractions whose definitions differ only in `presentation`
share the same digest and compare cleanly, with viewers picking up the
presentation recorded on the after extraction.
