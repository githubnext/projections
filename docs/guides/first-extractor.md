# Write your first extractor

Projections ships with built-in extractors for common ecosystems. Whenever your
repository has a concept they don't know about—feature flags, message topics, or
a custom plugin system—you can write an extractor of your own.

An extractor is any executable program that:

- Reads a **request** from standard input.
- Inspects the repository at `request.repository.root`, reading any installed
  dependencies (such as `node_modules`) from `request.repository.checkout`
  without modifying it.
- Writes a single **extraction** to standard output.

Aim to make your extractor's output a pure function of the revision so the same
commit always produces the same extraction. Read declared or resolved structure
(manifests, lockfiles, compiler output, schemas) instead of timings, profiles,
or live services; sort what you emit; and keep clocks, absolute paths, and tool
versions out of IDs. Projections won't block a non-deterministic extractor, but
uncontrolled variation makes every diff noisy. Declare `execution.determinism`
honestly (`pure`, `environmental`, or `observed`), and `projections check` will
measure reproducibility by rerunning it; see
[determinism and authority](../models/domain-model/extension-points.md#determinism-and-authority).

In this walkthrough, we'll build an extractor that reads feature flags from
`flags.yaml` along with the teams that own them.

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

When Projections runs a Python extractor, it puts the `projections` helper
module on `PYTHONPATH` automatically, so there's nothing to install. The
`request` object wraps the JSON request (it's still a `dict`) and exposes
convenient attributes: `request.root` points to the examined revision (or the
project subdirectory for a
[nested project](../runner/execution.md#nested-projects)), `request.checkout`
points to where dependencies are installed, and `request.inputs` holds the
definition's `inputs`.

`result()` serializes the extraction for you. Pass entities and relationships
either as lists where each entry has an `id`, or as dicts keyed by ID. It
defaults to the general `graph/v0` schema unless you pass `schema="..."`, and
accepts optional `metadata`, `volatile`, and `missing_inputs`. Before writing
output, it sorts items by ID, checks required fields, and fails with a clear
error if anything is missing.

If you want to run the script directly from your shell while debugging, put the
helper module on `PYTHONPATH` and pipe in a request:
`PYTHONPATH="$(projections __python-path)" python3 tools/extract-flags.py < request.json`
(or in PowerShell,
`$env:PYTHONPATH = projections __python-path; Get-Content request.json | python tools/extract-flags.py`).

In JavaScript or TypeScript, `@githubnext/projections/extractor` gives you the
same helpers, and Projections injects it automatically for extractors run with
`node`—so there's nothing to install here either. Its accessors use camelCase
(`request.root`, `request.repositoryRoot`), and `result()` takes a single
object. With the flags stored in JSON, which Node reads natively:

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

You only need to install `@githubnext/projections` as a development dependency
if you want its TypeScript types. To run the extractor by hand while debugging,
preload the module the same way Projections does:
`node --require "$(projections __node-require)" tools/extract-flags.mjs < request.json`.

Under the hood, the request and extraction are plain JSON over stdin and stdout
([the extractor contract](../contracts/extractors.md)), so you can write an
extractor in any language.

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

Using `python3` works across platforms: Projections resolves a bare `python3` or
`python` to whichever Python 3 installation is available, including `python` or
the `py -3` launcher on Windows ([process](../contracts/extractors.md#process)).

`execution.scope` tells Projections which files the extractor reads. It's
optional, but worth declaring early: `--workspace sparse` checks out only those
files for non-checked-out revisions, oversized revisions copy just those files,
edits outside the scope reuse cached extractions, and `projections check`
verifies your extractor doesn't read anything else. In a large repository, that
can turn a multi-second comparison into a fraction of a second
([scopes](../runner/execution.md#scopes)).

## 3. Show the extraction

```sh
projections show -p feature-flags --trust
```

Projections runs the extractor against your working tree, validates its output
against the [extraction schema](schemas.md#extraction-schema), and renders the
result. Pass `--json` if you want to inspect the raw extraction instead.

If anything in the extraction is invalid—like a relationship pointing to a
missing entity, or two entities sharing an ID—Projections tells you exactly what
went wrong and where.

For more involved extractors that analyze source code with your project's
compiler, browse the TypeScript samples in
[`examples/extractors`](../../examples/extractors/README.md). They cover feature
flags, HTTP routes, message handlers, and Redux slices, each targeting a
built-in renderer.

> **Why `--trust`?** A custom extractor executes code from your repository with
> access to your files. Extractors—including built-ins that run your build or
> application startup code—aren't sandboxed from the filesystem or network; they
> run with your privileges. Projections therefore asks for explicit permission
> first. In a comparison, `--trust` covers _both_ revisions. Comparators never
> need `--trust` because they run in a sandbox, and built-in extractors that
> only read files (like `workspace-dependencies`) don't need it either. Run
> `projections list` to see which projections require trust, or read
> [Trust](how-it-works.md#trust) for details.

For a tight feedback loop with the extraction, diagnostics, and rendered view
side by side, open the repository in VS Code (in a trusted workspace, since the
extractor is repository code) and select the projection from the **Projections**
side bar. The tab automatically applies your uncommitted changes ("Your edits")
and displays **Out of date** with a **Refresh** button whenever a save affects
what it shows. From there, the **Definition** view lists the projection's parts,
**Show Extraction Output** sends the raw JSON to the Projections output channel,
validation errors appear in Problems, and the **Testing** view runs the
projection's checks.

## 4. Compare two revisions (optional)

Once the extraction looks right, compare how it changes across revisions:

```sh
projections compare main..HEAD -p feature-flags --trust
```

A comparison evaluates both revisions using a single projection definition—by
default, the base revision's. If the head revision changes the definition or
extractor, or removes the projection altogether, Projections attaches a notice
to the comparison (printed in the CLI and stored in the document so every viewer
displays it). Pass `--definition head` if you want to compare both revisions
using the head's version instead.

Sometimes a file named in the projection's inputs only exists at one of the two
revisions—maybe the base predates it, or the head deleted it. Built-in
extractors handle this gracefully by emitting an empty extraction for the
missing side and recording the path in `missingInputs`, so the comparison shows
the contents as added or removed alongside a notice like
"`packages/api/prisma/schema.prisma` doesn't exist at `07f32353`, so its
contents show as added." That only applies when a file, folder, or glob is
absent; a file that exists but fails to read or parse still raises an error. On
its own, `projections show` notes that there is nothing to display at that
revision, and `projections check` still fails since a missing input at the
checked revision indicates a broken definition. Custom extractors can opt into
the same behavior by setting `missingInputs`.

Because the default comparator matches entities by `id`, pick IDs that stay
stable when unrelated code changes. `flag:checkout-v2` is durable; `flag:3` (an
array index) isn't. Keep mutable attributes like version numbers out of IDs and
inside `data` instead, so a version bump shows up as one modified package rather
than a removal and an addition. When something genuinely gets renamed, list its
old ID in `previousIds` so the comparison reports a rename.

Keep `data` focused on facts about the item itself. The default comparator marks
an item modified whenever its `data` changes, so fields that depend on other
files will cause false positives on unrelated commits. Common culprits are
counts or lists of callers ("files importing this module" changes whenever any
file adds an import), file line counts, and line numbers (which shift whenever
code above them moves). Omit derived counts—or model them as relationships—and
record source locations in `evidence` instead, with the file in `source` and the
position in `location`
(`{"kind": "file", "source": "flags.yaml", "location": {"line": 12}}`; a
top-level `line` is rejected). Because the default comparator ignores
`evidence`, shifting lines won't show up as a change. To help catch noisy fields
early, `projections check` warns about count-, list-, and line-like `data`
fields in custom extractor output unless the definition reads them or marks them
`volatile`, and `projections explore --sweep -p <id> --trust` flags any
projection that changes on nearly every recent commit.

## 5. Make it correct in place

Projections extracts your working tree directly in place inside your checkout,
just like running a test suite. That means `request.repository.root` is your
working directory and contains ignored files—installed dependencies, build
artifacts, editor files—that aren't part of the Git revision. A clean commit at
`HEAD` (such as in CI) is extracted in place too, while other commits are read
from Git objects (for file-only built-ins) or checked out in a managed
workspace. To stay accurate in both cases:

- List the revision's files the way Git does
  (`git ls-files --cached --others --exclude-standard`), or through the Rust
  SDK's context, rather than recursively walking `root`.
- Don't write to `root` except ignored scratch or build files.
- Never include the `root` path itself in your extraction.
- Never read repository files relative to the current working directory or the
  extractor script's own path. During a comparison, those point to the
  definition's revision on both sides, so you'd end up comparing a revision to
  itself. Declare the extractor's own code and config in `extractor.sources`;
  `projections check` warns if it reads anything else there.

## 6. Declare its environment (when it needs dependencies)

If your extractor runs a project toolchain (`tsc`, `go list`, a build step, or
the project's own code), it needs installed dependencies. In your working tree,
it uses the ones you already have installed. For other commits, tell Projections
how to install them in `.github/projections/environment.json`, just as you would
in CI:

```json
{
  "format": "projections.environment",
  "version": 0,
  "prepare": [
    {"id": "install", "run": ["npm", "ci", "--ignore-scripts"], "key": ["package-lock.json"]}
  ]
}
```

Before running a toolchain extractor in a managed workspace, Projections runs
each prepare step—but only when the hash of its `key` files has changed since
the last run in that workspace. Switching between commits with the same lockfile
skips installation completely. Prepare steps are repository code, so they
require `--trust`, may access the network, run under a timeout (`timeoutMs`, ten
minutes by default), and write a log whose path is shown if a step fails.

Projections never runs prepare steps in your working tree automatically; run
`projections prepare --trust` when you want to execute them locally, and use
`projections doctor` to see what's declared, prepared, or stale. If you don't
provide an environment file, other commits borrow your working tree's installed
dependencies, and any extraction whose lockfile differs is marked _approximate_.
See
[environments and workspaces](../runner/environments.md#environments-and-workspaces)
for all available fields and workspace strategies.

## 7. Build on built-in extractions (optional)

If your extractor enriches information a built-in already collects—say, adding
capability metadata to each Cargo crate and npm package—you don't need to
re-parse Cargo metadata, manifests, and lockfiles yourself. Declare those
built-ins in `extractor.upstream`, each with its own `inputs`:

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

Before invoking your extractor, Projections runs each upstream built-in on the
same revision as `<id>.<name>` (for example, `topology.crates`), using your
definition's `execution.scope` and `timeoutMs`. Every upstream extraction goes
through the same trust checks, supervision, normalization, and caching as any
other extraction. Your extractor then receives them in the request under the
names you chose:

```js
const request = JSON.parse(readFileSync(0, 'utf8'))
const {crates, packages} = request.upstream
// crates.entities, packages.relationships, …: ordinary extractions to merge
// (prefix their IDs to keep them apart), filter and add facts to.
```

In the Rust SDK, read them with `cx.upstream("crates")`. Because your extractor
emits the final extraction, you're in full control of how to combine the
upstream data—merging everything with an ID prefix per upstream, or pulling out
only the pieces you need. You can declare up to eight upstream built-in
extractors (custom extractors can't be upstream, and upstream isn't supported
under container isolation). Because built-in versions are tied to the
Projections executable, cached upstream extractions are reused only by the same
version.

## Write an extractor in Rust

You can write an extractor in any language, though Rust comes with an official
SDK: [`projections-extractor-sdk`](../../packages/extractors/sdk/README.md).
Every built-in extractor is built on this exact library, and built-ins get no
special privileges—they run as processes reading the same request and writing
the same extraction. The SDK handles request parsing, listing revision files,
checking trust before running external tools, supervising child processes,
reading files safely without following symlinks, and generating stable IDs:

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

Point `extractor.command` at the compiled binary and list its crate in
`sources`. For a complete example with tests, see
[`examples/extractors/cargo-features`](../../examples/extractors/cargo-features/README.md).

---
