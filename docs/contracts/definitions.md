# Projection definitions

Definitions live in `.github/projections/<id>.json` or `.projections/<id>.json`
of a [project](../runner/execution.md#nested-projects): the repository's root,
or a nested directory with definitions of its own. Every path in a definition is
relative to its project, which is also where its extractor runs; leading `../`
segments reach outside a nested project, but never outside the repository.

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

`extractor` is a built-in extractor ID or `{command, sources?}`. `comparator` is
optional; omitted, it is the default comparator without options. A custom
comparator is a [comparator file](comparisons.md#comparator-files), named by its
path, which must end in `.comparator.yaml` or `.comparator.yml`: either the path
alone, `"comparator": "tools/order.comparator.yaml"`, or
`{file, sources?, options?}` to give it options (which it reads as `options`) or
declare other files it depends on. The default comparator's form is an object
without `file`, `{}` or `{options: {order: {by, direction?}}}`. So the
discriminator is simple: **a string, or an object with `file`, is a custom
comparator; an object without `file` is the default comparator**, and the two
never mix. The CLI normalizes both custom forms to `{file, ...}`, so they have
one definition digest. The comparator file always belongs to the definition,
declared in `sources` or not. Comparator files are the only custom comparators:
there are no comparator modules or JavaScript comparators. A definition that
still names `comparator.module`, or the former `comparator.rules` key (renamed
to `file`), or a path that isn't a `.comparator.y(a)ml` file, is reported as
invalid with how to move to a comparator file (the other definitions still
load). `renderer` is a built-in renderer ID or `{bundle, sources?}`, where
`bundle` is a directory holding `index.html` and `renderer.json` (and optionally
`THIRD_PARTY_NOTICES.txt`, which hosts ignore). `sources` lists files or
directories whose content belongs to that component. `correspondence` maps a
current item ID to previous IDs; the runner applies it as `previousIds` before
saving the extraction. `execution.determinism` declares how reproducible the
extraction is, like a test's: `pure` (a function of the revision's files; cached
by Git tree, and a rerun must match), `environmental` (also the toolchain and
installed dependencies; cached only within one environment fingerprint; the
default for custom extractors) or `observed` (live or varying data such as
timings; never reused silently). It is descriptive, never enforced:
`projections check` reruns the extraction and warns when two runs differ. A
built-in extractor declares its own class; a definition may declare a less
reproducible one, never a more reproducible one. See
[determinism and authority](../models/domain-model/extension-points.md#determinism-and-authority).
`execution.scope` optionally narrows what the extractor depends on to files and
directories (not globs; `.` is the project itself), or widens a nested project's
beyond it with `../` paths; see the [runner](../runner/execution.md#scopes).

A definition directory may also hold `environment.json`, the repository's
environment file (`format: "projections.environment"`,
[schema](../../packages/schemas/schemas/environment/v0.json)): the prepare steps
that make a checkout usable for toolchain extractors. The name is reserved; it
is never a definition. See
[Environments and workspaces](../runner/environments.md#environments-and-workspaces).

`presentation` is optional. It holds initial viewer settings, which viewers can
still change:

- `highlighting`: `animated`, `on` or `off`;
- `changesOnly`: a boolean;
- `mode`: `animated`, `side-by-side`, `swipe` or `diff`, used only when the
  renderer supports it (else the renderer's default);
- `durationMs`: playback duration at 1× speed, 500–120000. Omitted, hosts use
  the renderer's declared `pace.stepMs` per step, else 1500 ms per step, and at
  least 4.5 seconds;
- `rendererOptions`: initial values of the renderer's declared controls, keyed
  by control ID (at most 32, IDs matching `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`,
  values strings, numbers or booleans). Hosts ignore unknown IDs and invalid
  values, and show a notice.
- `kinds`: how viewers present extraction kinds, keyed by kind (at most 64).
  Each may set a `color`, which renderers that color items by kind use (such as
  `file-packing` for a weighted hierarchy): a meaning (`danger`, `warning`,
  `success`, `info`, `neutral`) or a categorical hue (`blue`, `teal`, `pink`,
  `lime`, `purple`, `cyan`, `indigo`, `sky`, `orange`, `green`, `red`, `violet`,
  `emerald`, `rose`, `amber`, `citron`), always painted with the host's theme
  tokens; and a `noun`, `{"singular": …, "plural": …}` (1–64 characters each),
  the words the summary bar counts the kind in. A kind's key also names the flag
  of that name where a renderer draws flags. Renderers ignore kinds they don't
  draw.

```json
"presentation": {
  "kinds": {
    "secret": {"color": "danger", "noun": {"singular": "secret key", "plural": "secret keys"}},
    "pre-release": {"color": "warning"}
  }
}
```

The runner validates `presentation` and records it with the rest of the
definition in each saved extraction's provenance. It never affects what is
extracted or compared.

The **definition digest** is `sha256:` over the RFC 8785 canonical JSON of the
definition **without `presentation`** followed, for every file under the
declared sources in sorted path order, by its path and content bytes (Git blob
contents for a commit, working-tree bytes otherwise). Excluding `presentation`
means changing a viewer default never makes existing extractions incomparable:
two extractions whose definitions differ only in `presentation` share a digest
and compare normally, and viewers use the presentation recorded with the after
extraction.
