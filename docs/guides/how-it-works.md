# Projections guide

This guide walks through how Projections works and how to tailor it to your
codebase. If you want to get up and running first, start with the
[quick start](../setup/quick-start.md) to install the CLI, build a projection,
and wire it into CI with the GitHub Action. For deeper reference, the
[contracts](../contracts.md) specify the exact wire formats, the
[domain model](../models/domain-model.md) captures the design behind them, and
the [security architecture](security.md) explains where each piece runs.

---

## How Projections works

Source code shows you a system one file at a time. Projections steps back and
shows you the system itself: the shape of a public API, which packages depend on
which, how a database is structured, or where code is concentrated.

You pick what you want to see by choosing a **projection**, such as _Package
dependencies_ or _Public API_. Every projection brings together three
components, each configured independently:

- An **extractor** reads a single **revision** of your repository (either a
  commit or your working tree, including uncommitted changes) and emits an
  **extraction**—a JSON description of one aspect of the code.
- A **comparator** takes two extractions and produces a **comparison** showing
  how the first became the second.
- A **renderer** turns an extraction or comparison into something you can read
  and explore, like an interactive graph, a table, or a text outline.

```
  revision ──▶ extractor ──▶ extraction ──▶ renderer
```

To inspect the package dependency graph of your main branch, run:

```sh
projections show main -p dependencies
```

That alone is a complete workflow. Many teams publish projections of their
default branch as living architecture documentation.

Leave out the revision to inspect your working tree instead, so you can see the
impact of your changes before committing them:

```sh
projections show -p dependencies
```

### Seeing what changed

Projections can also show what changed between two revisions, most often the
base and head of a pull request:

```sh
projections compare main..HEAD -p dependencies
```

Pass a single revision to compare it against your working tree:

```sh
projections compare main -p dependencies
```

Under the hood, Projections runs the extractor on both revisions and hands the
two extractions to the comparator. The resulting comparison captures three
things:

- **Which entities correspond** across both revisions, including renames.
- **What happened to each one**, whether it was added, removed, modified, or
  renamed.
- **How to order the changes**, grouping related edits so the story makes sense.

```
  base revision ──▶ extractor ──▶ extraction ─┐
                                              ├─▶ comparator ──▶ comparison ──▶ renderer
  head revision ──▶ extractor ──▶ extraction ─┘
```

Because comparisons are computed on demand, you can compare any two extractions
from the same projection. On a pull request, for example, you can compare the
base branch with the latest push, or look only at what changed since the push
you last reviewed.

The renderer then displays that comparison. An interactive graph might step
through the changes with animation, while a text renderer lists the exact same
steps in order. Every renderer reads the same comparison, so they never disagree
about what changed.

> **If you've used `terraform plan` or ARM what-if,** the mental model is
> similar: match resources by identity, classify each change, and put the
> changes in a sensible order. The difference is that a comparison explains a
> change that already happened in code, so its order is built for human
> understanding rather than execution.

### Defining a projection

A projection definition names its extractor, its renderer, and optionally its
comparator:

```json
// .github/projections/dependencies.json
{
  "id": "dependencies",
  "title": "Package dependencies",
  "extractor": "workspace-dependencies",
  "renderer": "dag"
}
```

If you leave out `comparator`, Projections uses the default comparator. It
matches entities by ID, respects declared renames, and groups connected changes
together with dependencies shown before dependents.

You can also set default viewing preferences in the definition. Viewers can
still override any of them while exploring:

```json
{
  "id": "dependencies",
  "extractor": "workspace-dependencies",
  "renderer": "dag",
  "presentation": {"mode": "side-by-side", "changesOnly": true, "rendererOptions": {"showRelationships": false}}
}
```

Four presentation fields work across every projection: `highlighting`
(`animated`, `on`, or `off`), `changesOnly`, `mode` (`animated`, `side-by-side`,
or `swipe`), and `durationMs` (total playback length at normal speed, from 500
to 120000 milliseconds, defaulting to roughly a second per step). You can also
pass `rendererOptions` to configure controls specific to the chosen renderer;
any unknown options are ignored with a notice.

Because presentation settings only affect how a viewer opens the projection,
changing them has no effect on what gets extracted. Extractions created before
and after a presentation tweak can still be compared directly.

---

## Customizing Projections

You can swap out any of a projection's three components on its own, or use the
built-ins as they are. Custom extractors are the most common starting point, and
custom renderers pay off when a domain benefits from a tailored visual view.
Most teams never need a custom comparator because configuring the default one
handles common cases, though all three extension points are first-class.

<!-- prettier-ignore -->
| Component | Replace it when… | Written as |
|---|---|---|
| **Extractor** | Projections doesn't understand a concept in your codebase | A program in any language, using the toolchain your project already has |
| **Renderer** | You want a different way to present extractions and comparisons | A web page that runs in a sandboxed frame |
| **Comparator** | The default matching or ordering doesn't explain your changes well | A comparator file (`<name>.comparator.yaml`): YAML declarations and [CEL](https://cel.dev) expressions |

Projections ships as a single standalone executable. Built-in extractors rely
only on the toolchain your project already uses—.NET for Entity Framework Core
schemas, Python for Django, Go for Go interfaces. You don't need Node.js unless
your own project uses it or you're building a custom renderer, which is standard
web development.

All three components communicate strictly through documented formats:
extractions follow the [extraction schema](schemas.md#extraction-schema), and
comparisons follow the [comparison schema](schemas.md#comparison-schema). That
separation means a comparator never needs to know which renderer will draw its
output, and a general-purpose renderer can present domain-specific comparisons
without understanding the domain itself.

### Trust

Projections only runs code from your repository when it has already been
reviewed or you explicitly trust it. One rule governs every component: **code
from the revision you review runs freely; code that only a pull request's head
supplies needs explicit trust.**

<!-- prettier-ignore -->
| Component | Runs | Needs trust |
|---|---|---|
| Built-in extractor that only reads files | Projections' own code | Never |
| Custom extractor, or a built-in one that runs your toolchain | Repository code, with access to your files | Always: `--trust` covers both revisions |
| Custom comparators (comparator files) | Data, interpreted in a sandbox with no files, network, clock or randomness | Never |
| Custom renderer identical to the default branch's | A sandboxed frame | No |
| Any other custom renderer, including the working tree's and a checked-out pull request's | A sandboxed frame | Yes, like a custom extractor |

You might wonder why renderers need trust if they already run in a sandboxed
frame (`sandbox="allow-scripts"`, plus a content security policy with no origin
and `connect-src 'none'`). That sandbox stops a renderer from reading your
files, calling APIs, or making network requests. However, it still receives the
extraction—which can describe private source code—and browsers can't prevent a
sandboxed frame from navigating itself. A malicious renderer could encode
extraction data into a URL and navigate there.

For that reason, a custom renderer is treated as repository code, just like a
custom extractor, and requires trust before it runs. The one exception is a
bundle that is byte-identical to the version on the repository's default branch
(at the revision's merge base with `origin/HEAD`): maintainers already reviewed
and merged it, and it only ever sees data derived from the same repository. A
pull request that adds or edits a renderer still needs trust even after you
check it out locally.

When a custom renderer isn't trusted, Projections falls back to the built-in
renderer for the extraction's schema (or its table and text views) and explains
why. In practice:

- `projections list --json` includes `rendererRequiresTrust` for each projection
  so you can see which custom renderers need trust.
- The Inspector, the viewer, `show`/`compare --png`, and `check`'s renderer
  checks only run a modified custom renderer when `--trust` is passed (or in a
  trusted workspace in VS Code, which passes `--trust` to its backend). Your own
  uncommitted renderer edits count as modified too, so authoring a renderer
  requires trust.
- Hosted views never load custom renderers from artifacts.

### Determinism

It helps to think of extractions like test results. Each extraction is an
observation of a revision from a single run in a single environment. Just like
tests, the most useful extractions are deterministic: running against the same
revision always produces the same output, so comparisons highlight only real
changes. Favor declared or resolved structure—manifests, lockfiles, compiler
output, schemas—over timings, profiles, or live services. Sort everything you
emit, and keep clocks, absolute paths, random values, and tool versions out of
IDs.

That said, Projections doesn't block non-deterministic data. Instead, you
declare how reproducible your extractor is via `execution.determinism`:

- `pure` depends only on the revision's files, so extractions can be reused by
  Git tree.
- `environmental` (the default) also depends on the toolchain and installed
  dependencies, so extractions are reused only in the same environment.
- `observed` covers timings, coverage, and other live measurements where every
  run is a fresh observation and is never reused silently.

When you run `projections check`, Projections runs your extractor twice and
warns you—naming the exact fields that differed—if the outputs don't match. As
with tests, the run CI publishes is a commit's official extraction, while local
runs are clearly labelled as local runs. Comparators, by contrast, are always
deterministic because their rules are pure expressions evaluated in a sandbox
with no clock, randomness, or I/O. For the full rationale, see
[determinism and authority](../models/domain-model/extension-points.md#determinism-and-authority).

### Volatile data

Even when you want deterministic extractions, some real measurements naturally
vary from run to run—test durations, sample counts, benchmark averages. Rather
than hiding that data or letting it pollute diffs, you can declare it volatile
so comparisons separate expected jitter from meaningful changes. List volatile
values beside `metadata` as JSON pointers under `/data/`, with an optional
tolerance (shown here in Python using
[`result()`](first-extractor.md#1-write-the-program)):

```python
result(
    entities=[
        {"id": f"test:{t.name}", "kind": "test", "label": t.name,
         "data": {"status": t.status, "durationMs": t.duration_ms}}
        for t in results
    ],
    relationships=[...],
    volatile=[
        # Durations vary by up to 50 ms or 20%, whichever is larger.
        {"kinds": ["test"], "path": "/data/durationMs",
         "tolerance": {"absolute": 50, "relative": 0.2}},
        # Sample counts may vary freely; `*` matches any key or index.
        {"collection": "relationships", "path": "/data/samples/*/count"},
    ],
)
```

If a test's duration shifts within tolerance, it stays `unchanged` and doesn't
appear in any step, while the varied path is still recorded under `varied` so
the noise remains inspectable. If it moves beyond tolerance—or if its status
changes—it becomes `modified` as usual.

Only fields inside `data` can be volatile; IDs, kinds, labels, and endpoints
never are, so entity matching is never affected. Omitting a tolerance treats any
change to that value as expected variation. When you specify numeric tolerances,
a change stays within bounds as long as any declared bound (`absolute`,
`relative`, or `spread`) holds; if two revisions declare different tolerances
for the same path, the tighter one wins. Both the volatile declarations and the
measured values remain part of the extraction's digest. See
[volatile data](../contracts/extractions.md#volatile-data) for the complete
rules.

Comparators remain deterministic—only the extraction itself varies. Because CI's
published runs are official, a pull request compares the extractions CI
produced, and a local rerun that varies within tolerance still agrees with them.

#### Performance and other measured data

When you're tracking a measurement like a benchmark, record its spread and let
the tolerance adapt to it:

1. Run the benchmark N times and record both the mean and the spread—for
   example, `data.meanMs` and `data.stdevMs`.
2. Declare the mean volatile and bound it by the spread from both runs:

   ```json
   {"kinds": ["benchmark"], "path": "/data/meanMs", "tolerance": {"spread": "/data/stdevMs", "factor": 2}}
   ```

   The mean stays within tolerance when it shifts by at most
   `2 × √(stdev_before² + stdev_after²)`. If a run didn't record a spread, this
   bound can't apply, so the difference is treated as beyond tolerance (with a
   reason attached) unless another bound such as `absolute` holds.

3. Set `execution.determinism` to `observed` (see [Determinism](#determinism))
   so tools know a rerun may produce different numbers.
4. Treat CI's run as the official result.

#### Generated values

Some facts are easier to generate than to extract directly—for instance, using a
language model to summarize what a package or class is responsible for. Because
a model rewords its answer on every call, mark such a field as **generated** and
pair it with the **basis** it came from: an object of named string parts
(usually hashes) stored right alongside it in the item's `data`:

```json
"volatile": [
  {"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"}
]
```

```json
"data": {
  "summary": "Validates orders, reserves stock and hands paid orders to fulfillment.",
  "summaryBasis": {"input": "sha256:5b0e…", "prompt": "sha256:91c4…", "model": "gpt-4o-2024-08-06"}
}
```

Comparisons judge a generated value by its basis, never by its wording. If the
basis didn't change, a reworded summary counts as expected variation: the item
stays `unchanged`, appears in no step, records `varied` with `generated: true`,
and passes `projections check` as reproducible. If any part of the basis
changed, the item becomes `modified`, and its `varied` entry lists the changed
keys in `because` (such as `["input"]` or `["model"]`), allowing hosts to
explain that it was "regenerated because the input changed". A basis can't
itself be volatile, and an item must include a basis whenever it includes the
generated value.

Whatever you put in the basis determines what triggers a meaningful change, so
include everything that should cause regeneration and nothing else:

- **Scope the input narrowly** to the exact text the model reads, such as a
  class's own source rather than the entire file. Normalize line endings and
  trailing whitespace before hashing and before calling the model.
- **Include the prompt**, covering the system prompt, template, few-shot
  examples, and any generation parameters that affect the output.
- **Include the model if upgrades should matter**, using a pinned, dated,
  readable model ID. Omit it if a model upgrade shouldn't trigger changes.
- **Leave out** sampling seeds, timestamps, request IDs, the Git revision, and
  any credentials—even hashed—because a basis is saved, published, and
  displayed.

In practice, equal bases usually yield byte-identical text too. The runner keeps
a **generation store** of previously generated values keyed by path and basis,
and passes a read-only snapshot to the extractor at `request.generations.file`.
When an extractor finds a matching basis in the store, it can reuse the stored
value without calling the model again. In JavaScript,
`@githubnext/projections/extractor` handles both hashing and lookup:

```js
import {basis, generations, readRequest} from '@githubnext/projections/extractor'

const request = await readRequest()
const store = await generations(request)
const summaryBasis = basis({input: classSource, prompt: PROMPT, model: 'gpt-4o-2024-08-06'})
const summary = await store.generate('/data/summary', summaryBasis, () => model.summarize(classSource))
```

An extractor that calls a language model is repository code that needs network
access and credentials. Declare `execution.network` and any required credential
variables in `execution.environment`, mark it `environmental` (`check` warns if
a `pure` extraction contains generated values), and run it with `--trust`.

Hosts badge every generated field as **Generated**. When a value was reworded
from the same inputs, hosts show the After text with a toggle to inspect Before;
when the basis changed, they show both passages along with the reason. For a
working example using a stand-in model, see the
[`class-summaries`](../../examples/extractors/class-summaries/README.md) sample,
or read [generated values](../design/generated-values.md) for the full design.

---

## Tutorials and guides

From here, pick the guide that matches what you're building:

- [Embedding Projections](embedding.md) — place the host inside your own
  application and add commenting on projections.
- [Write your first extractor](first-extractor.md) — write a custom extractor,
  define its projection, and run it to show and compare revisions.
- [Develop a renderer](develop-a-renderer.md) — author scenarios, use the
  fixtures workbench, run checks, and test in CI.
- [Control the order of changes](order-of-changes.md) — configure the default
  comparator or write a custom one.
- [Extraction and comparison schemas](schemas.md) — inspect the exact shape of
  extractions and comparisons, plus the metadata Projections adds.

## Glossary

**Projection** — A view of one aspect of a codebase, such as _Package
dependencies_. A projection pairs an extractor, a comparator, and a renderer
with their configuration, defined in `.github/projections/`.

**Revision** — The snapshot of a repository that an extractor inspects, either a
specific commit or a working tree with uncommitted changes.

**Extractor** — A program that reads one revision of a repository and emits an
extraction. Built-in extractors cover common ecosystems, and you can write
custom extractors in any language.

**Extraction** — A JSON description of one aspect of a repository at a single
revision, conforming to the extraction schema.

**Comparator** — The component that relates two extractions from the same
projection and produces a comparison. The default comparator matches by ID and
groups connected changes together; a custom comparator file layers domain
knowledge on top and runs sandboxed wherever comparisons are viewed.

**Comparison** — A structured description of how one extraction became another:
which entities correspond, what changed for each one, and the step order to
present them in.

**Baseline comparison** — The comparison produced by the default comparator,
which every custom comparator builds on.

**Renderer** — The visual or textual presentation of an extraction or
comparison, such as an interactive graph, a table, or a text outline. Custom
renderers run in a sandboxed frame without network access, and any renderer
introduced or modified by a pull request's head requires explicit trust.
Projections' built-in table and text views stay available alongside every
renderer, so every projection works without relying on vision or motion.

**Runner** — The part of Projections that executes extractors: preparing each
revision, enforcing time and output limits, validating the output, and recording
provenance.

**Inspector** — The development and debugging workspace in the Projections VS
Code extension, showing raw output, validation diagnostics, and the rendered
result side by side.
