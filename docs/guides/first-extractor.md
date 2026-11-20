# Write your first extractor

Projections includes extractors for common ecosystems. When your repository has
a concept they don't understand—feature flags, message topics, a home-grown
plugin system—you can write your own.

An extractor is any program that:

- reads a **request** from standard input;
- examines the repository at `request.repository.root`, and, when it needs the
  project's installed dependencies such as `node_modules`, reads them from
  `request.repository.checkout` (treat it as read-only);
- writes one **extraction** to standard output.

Make its output a function of the revision: the same revision should always
produce the same extraction. Read declared or resolved structure (manifests,
lockfiles, compiler output, schemas) rather than timings, profiles or live
services, sort what you emit, and keep clocks, absolute paths and versions out
of IDs. Projections doesn't enforce this, but a non-deterministic extractor
makes every comparison noisy: declare `execution.determinism` honestly (`pure`,
`environmental` or `observed`) and `projections check` measures it by rerunning;
see
[determinism and authority](../models/domain-model/extension-points.md#determinism-and-authority).

This example describes the feature flags declared in `flags.yaml` and the teams
that own them.

## 1. Write the program

```python
#!/usr/bin/env python3
# tools/extract-flags.py
import pathlib

import yaml
from projections import request, result

flags = yaml.safe_load((pathlib.Path(request.root) / "flags.yaml").read_text())

entities = {}
relationships = []
for name, flag in flags.items():
    entities[f"flag:{name}"] = {
        "kind": "flag",
        "label": name,
        "data": {"default": flag["default"]},
        "evidence": [{"kind": "file", "source": "flags.yaml"}],
    }
    for owner in flag.get("owners", []):
        entities[f"team:{owner}"] = {"kind": "team", "label": owner}
        relationships.append({
            "id": f"owns:{owner}:{name}",
            "kind": "owns",
            "from": f"team:{owner}",
            "to": f"flag:{name}",
        })

result(entities=entities, relationships=relationships)
```

Projections provides the `projections` module to the extractors it runs, on
`PYTHONPATH`, so there is nothing to install. `request` is the request:
`request.root` is the examined revision (the project's directory in it, for a
[nested project](../runner/execution.md#nested-projects)), `request.checkout`
where its dependencies are installed and `request.inputs` the definition's
`inputs`; it is still the request's JSON object as a `dict`. `result()` writes
the extraction: entities and relationships as lists with an `id` each, or as
dicts keyed by ID, in the general `graph/v0` schema unless `schema="..."` names
another, with optional `metadata`, `volatile` and `missing_inputs`. It sorts
them by ID, checks each has what it needs and fails with a clear message when
one doesn't. To run the extractor by hand, put the module on `PYTHONPATH` and
pipe a request in:
`PYTHONPATH="$(projections __python-path)" python3 tools/extract-flags.py < request.json`
(in PowerShell,
`$env:PYTHONPATH = projections __python-path; Get-Content request.json | python tools/extract-flags.py`).

In JavaScript or TypeScript, `@githubnext/projections/extractor` does the same,
and Projections provides it to the extractors it runs with `node`, so there is
nothing to install here either. Its accessors are camelCase (`request.root`,
`request.repositoryRoot`), and `result()` takes one object. With the flags in
JSON, which Node reads without a package:

```js
// tools/extract-flags.mjs
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {request, result} from '@githubnext/projections/extractor'

const flags = JSON.parse(readFileSync(join(request.root, 'flags.json'), 'utf8'))
result({
  entities: Object.entries(flags).map(([name, flag]) => ({
    id: `flag:${name}`,
    kind: 'flag',
    label: name,
    data: {default: flag.default},
  })),
})
```

Install the `@githubnext/projections` package as a development dependency only
if you want its types. To run the extractor by hand, preload the module the way
Projections does:
`node --require "$(projections __node-require)" tools/extract-flags.mjs < request.json`.

Underneath, the request and the extraction are JSON on stdin and stdout
([the extractor contract](../contracts/extractors.md)), so an extractor in any
language can write them directly.

## 2. Define the projection

```json
// .github/projections/feature-flags.json
{
  "id": "feature-flags",
  "title": "Feature flags",
  "extractor": { "command": ["python3", "tools/extract-flags.py"] },
  "renderer": "graph",
  "execution": { "scope": ["flags.yaml", "tools/extract-flags.py"] }
}
```

`python3` works on every platform: Projections runs a bare `python3` or `python`
with whichever Python 3 the machine has, including `python` or the `py -3`
launcher on Windows ([process](../contracts/extractors.md#process)).

`execution.scope` lists what the extractor reads. It is optional, but declare
it: `--workspace sparse` then checks out only those files for a revision that
isn't checked out, a revision too large to copy whole copies just them, an edit
elsewhere reuses the cached extraction, and `projections check` verifies that
the extractor reads nothing else. In a large repository that turns a comparison
of seconds per revision into a fraction of one
([scopes](../runner/execution.md#scopes)).

## 3. Show the extraction

```sh
projections show -p feature-flags --trust
```

Projections runs the extractor against your working tree, validates the
extraction against the [extraction schema](schemas.md#extraction-schema) and
renders the result. Add `--json` to print the extraction itself.

If the extraction is invalid—a relationship pointing at a missing entity, or two
entities with the same ID—Projections reports what's wrong and where.

For larger extractors that analyze code with the project's own compiler, see the
TypeScript samples in
[`examples/extractors`](../../examples/extractors/README.md): feature flags,
HTTP routes, message handlers and Redux slices, each targeting a built-in
renderer.

> **Why `--trust`?** A custom extractor runs code from your repository with
> access to your files. Extractors, including the built-in ones that run your
> build or your application's startup code, are not network or filesystem
> sandboxed: they run with your privileges. Projections only runs them when you
> explicitly allow it. When comparing revisions, `--trust` applies to the code
> in _both_ revisions. Comparators don't need `--trust`, because they run in a
> sandbox. Built-in extractors that only read files, such as
> `workspace-dependencies`, don't need it either; `projections list` shows which
> projections do. See [Trust](how-it-works.md#trust).

To iterate on the extractor with its extraction, diagnostics and rendering
together, open the repository in VS Code (in a trusted workspace, since the
extractor is repository code) and open the projection from the **Projections**
side bar: its tab applies your uncommitted edits ("Your edits") and says **Out
of date** with **Refresh** when a save changes what it shows. The **Definition**
view lists its parts, **Show Extraction Output** writes the extraction to the
Projections output channel, problems go to Problems, and the **Testing** view
runs its checks.

## 4. Compare two revisions (optional)

Once the extraction looks right, see how it changes:

```sh
projections compare main..HEAD -p feature-flags --trust
```

A comparison uses one projection definition for both revisions: by default, the
definition from the base revision. If the head revision changes the projection's
definition or its extractor, or doesn't define the projection at all,
Projections tells you with a notice, and `--definition head` compares both
revisions using the head's version instead. Notices are printed with the
comparison and saved in its document, so every viewer shows them.

A file the projection's inputs name may not exist at one of the revisions: the
base predates the commit that added it, or the head removed it. A built-in
extractor then extracts that revision as empty and records the file in the
extraction's `missingInputs`, so the comparison shows its contents as added (or
removed), with a notice such as "`packages/api/prisma/schema.prisma` doesn't
exist at `07f32353`, so its contents show as added." This applies only to a
file, folder or glob that isn't there: one that exists but can't be read or
parsed still fails. `projections show` of such a revision says the projection
has nothing to show there, and `projections check` still fails, because at the
revision you check a missing input is a mistake in the definition. A custom
extractor decides for itself, and may set `missingInputs` the same way.

The default comparator matches entities by `id`, so choose IDs that stay stable
when unrelated things change. `flag:checkout-v2` is a good ID; `flag:3` (a list
position) is not. Keep changing attributes such as versions out of IDs and in
`data`: a package ID without its version lets the comparison report a version
bump as one modified package. When something is genuinely renamed, list its old
ID in `previousIds` so the comparison shows a rename rather than a removal and
an addition.

Keep in `data` only facts about the item itself. The default comparator marks an
item modified whenever its `data` changes, so a value that changes when
something else does makes the item modified on changes that never touched it.
Counts and lists of things elsewhere are the usual trap: "files importing this
module" on a relationship changes whenever any importing file is added, and a
module's line count on every edit. Line numbers are another: they change
whenever code above them moves. Leave counts out, or draw what they count as
relationships. Say where a fact came from in `evidence` instead, the file in
`source` and a position in `location`
(`{"kind": "file", "source": "flags.yaml", "location": {"line": 12}}`; a
top-level `line` is rejected): the default comparator ignores evidence, so
moving code isn't a change. `projections check` warns about count-, list- and
line-like `data` fields in a custom extractor's output, unless the definition
reads the field or declares it `volatile`, and
`projections explore --sweep -p <id> --trust` marks a projection that changes on
nearly every recent change as likely noise.

## 5. Make it correct in place

Projections extracts the working tree in place, in your own checkout, the way
your tests run: `request.repository.root` is then your checkout, holding ignored
files (installed dependencies, build output, editor files) that aren't part of
the revision. A clean commit that is `HEAD` (as in CI) is extracted in place
too; other commits are read from Git objects (built-ins that only read files) or
checked out in a workspace Projections keeps. So:

- list the revision's files the way Git does
  (`git ls-files --cached --others --exclude-standard`), or through the Rust
  SDK's context, rather than walking `root`;
- write nothing to `root` except ignored scratch or build output;
- never put `root` itself in the extraction;
- never read the repository relative to the working directory or the extractor's
  own location: in a comparison that is the definition's revision on both sides,
  so the comparison would show no change. Declare the extractor's own code and
  configuration in `extractor.sources`; `projections check` warns when it reads
  anything else there.

## 6. Declare its environment (when it needs dependencies)

An extractor that runs the project's toolchain (`tsc`, `go list`, a build, the
project's own code) needs installed dependencies. In the working tree they are
yours, as for tests. For another commit, declare how to install them, as your CI
does, in `.github/projections/environment.json`:

```json
{
  "format": "projections.environment",
  "version": 0,
  "prepare": [
    {"id": "install", "run": ["npm", "ci", "--ignore-scripts"], "key": ["package-lock.json"]}
  ]
}
```

Before a toolchain extractor runs in a workspace, Projections runs each step
there, but only when the hash of its `key` files changed since it last ran in
that workspace, so switching between commits with the same lockfile installs
nothing. Steps are repository code: they need `--trust`, may use the network,
have a timeout (`timeoutMs`, default ten minutes), and write a log that a
failure names. Nothing ever runs in your working tree by itself;
`projections prepare --trust` runs the steps there on demand, and
`projections doctor` shows what is declared, prepared and stale. Without an
environment file, other commits borrow your working tree's dependencies, and an
extraction is labelled _approximate_ when their lockfiles differ. The
[runner](../runner/environments.md#environments-and-workspaces) describes every
field and the workspace strategies.

## 7. Build on built-in extractions (optional)

An extractor that adds facts to what a built-in already reads, such as
capabilities for each crate and npm package, doesn't have to read Cargo
metadata, manifests and lockfiles again. Name the built-ins in
`extractor.upstream`, each with its own `inputs`:

```json
{
  "id": "topology",
  "renderer": "architecture",
  "extractor": {
    "command": ["node", "tools/topology.mjs"],
    "sources": ["tools/topology.mjs"],
    "upstream": {
      "crates": {"extractor": "cargo-dependencies"},
      "packages": {"extractor": "workspace-dependencies", "inputs": {"root": "web"}}
    }
  }
}
```

Before your extractor runs, Projections extracts the same revision with each
built-in, as the projection `<id>.<name>` (`topology.crates`), under the
definition's `execution.scope` and `timeoutMs`. Each upstream extraction is
trust-gated, supervised, normalized and cached like any other. Your extractor
receives them in the request, keyed by the same names:

```js
const request = JSON.parse(readFileSync(0, 'utf8'))
const {crates, packages} = request.upstream
// crates.entities, packages.relationships, …: ordinary extractions to merge
// (prefix their IDs to keep them apart), filter and add facts to.
```

The Rust SDK reads them with `cx.upstream("crates")`. Your extractor writes the
final extraction, so it decides how the upstream extractions combine: with an ID
prefix per name to merge them, or with only the parts it needs. Only built-in
extractors can be upstream, up to eight, and not under container isolation.
Their versions belong to the Projections executable, so a cached extraction is
reused only by the same version.

## Write an extractor in Rust

Any language works, but Rust has an SDK:
[`projections-extractor-sdk`](../../packages/extractors/sdk/README.md). It is
the same library every built-in extractor is written with, and the built-ins get
nothing from Projections that it doesn't give you: they run as processes that
read the same request and write the same extraction. It reads the request, lists
the revision's files, checks trust before you run tools, runs tools under the
runner's supervision, reads repository files without following symlinks, and
builds extractions with stable IDs:

```rust
use projections_extractor_sdk::{Context, extraction, key, read_source, relationship};
use serde_json::json;

fn main() -> std::process::ExitCode {
    projections_extractor_sdk::main("flags", |cx: &Context| {
        let mut entities = vec![];
        let mut relationships = vec![];
        for file in cx.files()?.iter().filter(|file| file.ends_with("flags.txt")) {
            let owner = format!("file:{file}");
            entities.push(json!({"id": owner, "kind": "file", "label": file}));
            for flag in read_source(cx.root(), file)?.lines().filter(|line| !line.is_empty()) {
                let id = key(&["flag", flag]);
                entities.push(json!({"id": id, "kind": "flag", "label": flag}));
                relationships.push(relationship("declares", &owner, &id));
            }
        }
        Ok(extraction("graph/v0", entities, relationships, None))
    })
}
```

Point `extractor.command` at the built executable and list its crate in
`sources`.
[`examples/extractors/cargo-features`](../../examples/extractors/cargo-features/README.md)
is a complete example with tests.

---
