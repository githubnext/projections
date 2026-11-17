# Projections guide

This guide explains how Projections works and how to customize it. The exact
wire formats are specified in [the contracts](../contracts.md); the design
behind them is recorded in the [domain model](../models/domain-model.md). To
install the CLI, build your first projection and add it to CI with the GitHub
Action, start with the [quick start](../setup/quick-start.md); the
[security architecture](security.md) explains where each part runs.

---

## How Projections works

Source code describes a system one file at a time. Projections shows you the
system itself: the shape of a public API, which packages depend on which, how a
database is structured, where the code is concentrated.

You choose what to see by choosing a **projection**, such as _Package
dependencies_ or _Public API_. Each projection combines three components, each
with its own configuration:

- an **extractor**, which examines one **revision** of your repository—a commit,
  or your working tree including uncommitted changes—and produces an
  **extraction**: a JSON description of one aspect of the code;
- a **comparator**, which relates two extractions and produces a **comparison**;
- a **renderer**, which presents an extraction or a comparison, for example as
  an interactive graph, a table or a text outline.

```
  revision ──▶ extractor ──▶ extraction ──▶ renderer
```

To see the package dependency graph of your main branch:

```sh
projections show main -p dependencies
```

That is a complete use of Projections. Many teams publish projections of their
default branch as living architecture documentation.

Omit the revision to use your working tree, so you can see the effect of changes
before you commit them:

```sh
projections show -p dependencies
```

### Seeing what changed

Projections can also show how the code changed between two revisions, usually
the base and head of a pull request.

```sh
projections compare main..HEAD -p dependencies
```

Name only one revision to compare it with your working tree:

```sh
projections compare main -p dependencies
```

Projections runs the extractor against both revisions, then passes the two
extractions to the comparator. The comparison it produces describes how the
first extraction became the second:

- **which entities correspond** across the two revisions, including renames;
- **what happened to each one**: added, removed, modified or renamed;
- **the order in which to present the changes**, grouping changes that belong
  together.

```
  base revision ──▶ extractor ──▶ extraction ─┐
                                              ├─▶ comparator ──▶ comparison ──▶ renderer
  head revision ──▶ extractor ──▶ extraction ─┘
```

Comparisons are computed when you view them, so you can compare any two
extractions from the same projection. On a pull request, for example, you can
compare the base with the latest push, or see only what changed since the push
you last reviewed.

The renderer presents the comparison. An interactive graph might animate between
the two extractions step by step; a text renderer might list the same steps in
order. Every renderer presents the same comparison, so they always agree on what
changed.

> **If you've used `terraform plan` or ARM what-if,** the idea is similar: match
> resources by identity, classify each change, and order the changes sensibly.
> The difference is that a comparison explains a change that has already
> happened in code. Its order exists to make the change understandable, not to
> execute it.

### Defining a projection

A projection definition names the projection's extractor and renderer and,
optionally, its comparator.

```json
// .github/projections/dependencies.json
{
  "id": "dependencies",
  "title": "Package dependencies",
  "extractor": "workspace-dependencies",
  "renderer": "dag"
}
```

When `comparator` is omitted, the projection uses the default comparator. It
matches entities by ID, honors declared renames, and presents connected changes
together, dependencies before dependents.

A definition can also choose how viewers first see it. Viewers can still change
these settings:

```json
{
  "id": "dependencies",
  "extractor": "workspace-dependencies",
  "renderer": "dag",
  "presentation": {"mode": "side-by-side", "changesOnly": true, "rendererOptions": {"showRelationships": false}}
}
```

`highlighting` (`animated`, `on`, `off`), `changesOnly`, `mode` (`animated`,
`side-by-side`, `swipe`) and `durationMs` (playback length at normal speed, 500
to 120000 milliseconds; by default about a second per step) are the same for
every projection. `rendererOptions` sets the controls the chosen renderer
offers; unknown settings are ignored with a notice.

Presentation settings are only viewers' starting point, so changing them doesn't
change what the projection extracts: extractions made before and after such a
change can still be compared.

---

## Customizing Projections

You can replace any of a projection's three components independently, or none at
all. Custom extractors are the most common customization, and custom renderers
are useful when a domain deserves its own presentation. Most teams never need a
custom comparator: configuring the default one covers common needs. But all
three are fully supported.

<!-- prettier-ignore -->
| Component | Replace it when… | Written as |
|---|---|---|
| **Extractor** | Projections doesn't understand a concept in your codebase | A program in any language, using the toolchain your project already has |
| **Renderer** | You want a different way to present extractions and comparisons | A web page that runs in a sandboxed frame |
| **Comparator** | The default matching or ordering doesn't explain your changes well | A comparator file (`<name>.comparator.yaml`): YAML declarations and [CEL](https://cel.dev) expressions |

Projections itself is a single standalone executable. Built-in extractors only
need the toolchain your project already uses: .NET for Entity Framework Core
schemas, Python for Django, Go for Go interfaces. Projections never requires
Node.js unless your project already does, or you write a custom renderer, which
is ordinary web development.

The components communicate only through documented formats: extractions conform
to the [extraction schema](schemas.md#extraction-schema), and comparisons
conform to the [comparison schema](schemas.md#comparison-schema). A comparator
therefore doesn't need to know which renderer will present its comparison, and a
generic renderer can present a comparison built with domain knowledge it doesn't
have.

### Trust

Projections runs code from your repository only when that code is reviewed or
you explicitly trust it. The rule is the same for every component: **code from
the revision you review runs freely; code that only a pull request's head
supplies needs explicit trust.**

<!-- prettier-ignore -->
| Component | Runs | Needs trust |
|---|---|---|
| Built-in extractor that only reads files | Projections' own code | Never |
| Custom extractor, or a built-in one that runs your toolchain | Repository code, with access to your files | Always: `--trust` covers both revisions |
| Custom comparators (comparator files) | Data, interpreted in a sandbox with no files, network, clock or randomness | Never |
| Custom renderer identical to the default branch's | A sandboxed frame | No |
| Any other custom renderer, including the working tree's and a checked-out pull request's | A sandboxed frame | Yes, like a custom extractor |

Why renderers at all? A renderer runs in a sandboxed frame
(`sandbox="allow-scripts"`, and a content security policy that grants no origin
and `connect-src 'none'`), so it can't read your files, call an API or fetch
anything. But it does receive the extraction, which can describe private code,
and browsers can't stop a sandboxed frame from navigating itself: a malicious
renderer could encode the extraction into a URL and navigate to it. So a custom
renderer is repository code like a custom extractor, and runs only with trust.
The exception is a bundle byte-identical to the one on the repository's default
branch (at the revision's merge base with `origin/HEAD`): the repository's
maintainers merged it, and it only sees what is derived from the same
repository. A pull request that adds or changes a renderer needs trust even
after you check it out.

Without trust, Projections shows the built-in renderer for the extraction's
schema, or its table and text views, and says why. Concretely:

- `projections list --json` reports, per projection, whether its custom renderer
  needs trust (`rendererRequiresTrust`).
- The Inspector, the viewer, `show`/`compare --png` and `check`'s renderer
  checks run a custom renderer that differs from the default branch's only with
  `--trust`; in VS Code, only in a trusted workspace (its backend gets
  `--trust`). Your own uncommitted renderer changes count too, so authoring a
  renderer needs trust.
- Hosted views never load custom renderers from artifacts.

### Determinism

Think of extractions as test results. Like a test run, an extraction is an
observation of a revision by one run in one environment, and like tests, the
most useful ones are deterministic: the same revision always produces the same
extraction, so comparisons show only what the change did. Read declared or
resolved structure (manifests, lockfiles, compiler output, schemas) rather than
timings, profiles or live services; sort what you emit; and keep clocks,
absolute paths, random values and tool versions out of IDs.

Projections doesn't block anything less than that. Declare how reproducible your
extractor is with `execution.determinism`: `pure` (a function of the revision's
files), `environmental` (also the toolchain and dependencies; the default) or
`observed` (timings, coverage: every run is an observation). The class decides
what may be reused: pure extractions by Git tree, environmental ones only in the
same environment, observed ones never silently. `projections check` reruns your
extractor and warns, naming the fields that varied, when two runs differ. As
with tests, the run CI publishes is a commit's official extraction; local runs
are labelled as runs. Comparators must be deterministic, and are: comparator
rules are expressions with no clock, randomness or I/O, run in a sandbox. See
[determinism and authority](../models/domain-model/extension-points.md#determinism-and-authority)
for the reasoning.

### Volatile data

Extractions are like test results: determinism is desirable, but some variation
is real (a test's duration, a sample count, a benchmark's mean) and mustn't be
blocked. Declare it, and comparisons separate expected variation from changes
that matter. In the extraction, beside `metadata`, list the volatile values as
JSON pointers under `/data/`, each with an optional tolerance (here in Python,
with [`result()`](first-extractor.md#1-write-the-program)):

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

A test whose duration moved within tolerance then shows as `unchanged`, with the
varied path listed in its change's `varied` so the noise stays visible, and it
is in no step. Beyond tolerance it is `modified`; a status change is `modified`
as always. Only `data` can be volatile: IDs, kinds, labels and endpoints never
are, so matching is unaffected. Without a tolerance any difference of the value
counts as expected variation; a tolerance applies to numbers, and a difference
is within it when any of its bounds (`absolute`, `relative`, `spread`) holds.
When the two revisions declare different tolerances for a value, the tighter one
applies. The declarations, and the volatile values themselves, are part of the
extraction's digest. See
[volatile data](../contracts/extractions.md#volatile-data) for every rule.

Comparators stay deterministic; only the extraction varies. The official results
are what CI publishes: a comparison in a pull request compares the extractions
CI made, and a local rerun that varied within tolerance agrees with them.

#### Performance and other measured data

For a measurement, record its spread and let the tolerance follow it:

1. Run the benchmark N times and record the mean and the spread, for example
   `data.meanMs` and `data.stdevMs`.
2. Declare the mean volatile, bounded by the spread both runs recorded:

   ```json
   {"kinds": ["benchmark"], "path": "/data/meanMs", "tolerance": {"spread": "/data/stdevMs", "factor": 2}}
   ```

   The mean is within when it moved by at most
   `2 × √(stdev_before² + stdev_after²)`. A run that didn't record a spread
   can't use this bound, so its difference is beyond tolerance (with a reason)
   unless another bound, such as `absolute`, holds.

3. Set the definition's determinism class to `observed`
   (`execution.determinism`; see [Determinism](#determinism)), so tools know a
   rerun may differ.
4. Treat CI's run as the official result.

#### Generated values

Some facts are easier to generate than to extract: what a package is responsible
for, or what a class does, written by a language model. A model rewords its
answer every time it's asked, so declare such a value **generated**, with the
**basis** it was generated from: an object of named parts beside it in the
item's `data`, each a string (usually a hash):

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

Comparisons judge a generated value by its basis, never by its wording. With
equal bases, a reworded value is expected variation: the item stays `unchanged`,
listed with `varied` (`generated: true`), in no step, and `projections check`
counts the rerun reproducible. When a part of the basis moved, the item is
`modified`, and its `varied` entry names the parts in `because` (`["input"]`,
`["model"]`), so hosts can say "regenerated because the input changed". The
basis can't itself be volatile, and an item has a basis exactly when it has the
value.

What goes in the basis decides what counts as a change, so put in everything
that should regenerate the value, and nothing else:

- **The input, narrowly**: exactly what the model reads, such as the class's
  source rather than its whole file. Normalize it (line endings, trailing
  whitespace) before hashing it and before sending it.
- **The prompt**: the system prompt and template, few-shot examples and the
  generation parameters that change what comes back.
- **The model, if a model upgrade should count**: a pinned, dated ID, kept
  readable. Leave it out if an upgrade shouldn't regenerate anything.
- **Never** sampling seeds, timestamps, request IDs, the revision, or
  credentials of any kind, not even hashed: a basis is saved, published and
  shown.

Equal bases usually give byte-identical text too. The runner keeps a
**generation store** of the values earlier extractions generated, keyed by the
declared path and the basis, and hands the extractor a read-only snapshot
(`request.generations.file`). An extractor that reuses a stored value for an
equal basis never asks the model again. In JavaScript, the helpers in
`@githubnext/projections/extractor` do the hashing and the lookup:

```js
import {basis, generations, readRequest} from '@githubnext/projections/extractor'

const request = await readRequest()
const store = await generations(request)
const summaryBasis = basis({input: classSource, prompt: PROMPT, model: 'gpt-4o-2024-08-06'})
const summary = await store.generate('/data/summary', summaryBasis, () => model.summarize(classSource))
```

An extractor that calls a model is repository code that needs the network and
credentials: declare `execution.network` and the credential variables in
`execution.environment`, and run it with `--trust`. Declare it `environmental`
(`check` warns about generated values in a `pure` extraction). Hosts mark every
generated field **Generated**, show a value reworded from the same inputs as
After's text with Before's wording a toggle away, and a value whose basis moved
as both passages with the reason. The
[`class-summaries`](../../examples/extractors/class-summaries/README.md) sample
summarizes classes with a stand-in model; see
[generated values](../design/generated-values.md) for the design.

---

## Tutorials and guides

The rest of the guide has a page per task:

- [Embedding Projections](embedding.md): where the host fits in your
  application, and building commenting on projections.
- [Write your first extractor](first-extractor.md): a tutorial that writes an
  extractor, defines its projection, then shows and compares it.
- [Develop a renderer](develop-a-renderer.md): describe scenarios, open the
  fixtures workbench, run the checks and test in CI.
- [Control the order of changes](order-of-changes.md): configure the default
  comparator, or write a custom comparator.
- [Extraction and comparison schemas](schemas.md): the shape of extractions and
  comparisons, and what Projections adds.

## Glossary

**Projection** : A view of one aspect of a codebase that users can choose, such
as _Package dependencies_. A projection combines an extractor, a comparator and
a renderer, along with their configuration. Projection definitions live in
`.github/projections/`.

**Revision** : The version of a repository an extractor examines: either a
commit or a working tree, including uncommitted changes.

**Extractor** : A program that examines one revision of a repository and
produces an extraction. Built-in extractors cover common ecosystems; custom
extractors can be written in any language.

**Extraction** : A JSON description of one aspect of a repository at one
revision, conforming to the extraction schema.

**Comparator** : Relates two extractions from the same projection and produces a
comparison. The default comparator matches by ID and presents connected changes
together; a custom comparator (a comparator file) adds domain knowledge on top
of it, and runs sandboxed wherever comparisons are viewed.

**Comparison** : A description of how one extraction became another: which
entities correspond, what happened to each, and the order in which to present
those changes.

**Baseline comparison** : The comparison produced by the default comparator,
which custom comparators start from.

**Renderer** : Presents an extraction, or a comparison of two, to a person: as
an interactive graph, a table or text. Custom renderers run in a sandboxed frame
without network access; one that only a pull request's head supplies needs
explicit trust. Projections' built-in table and text views remain available
alongside any renderer, so every projection can be used without relying on
vision or motion.

**Runner** : The part of Projections that runs extractors: preparing each
revision, enforcing time and output limits, validating output, and recording
provenance.

**Inspector** : The tool for developing and debugging extractors, comparators
and renderers, in the Projections VS Code extension. It shows raw output,
validation diagnostics and the rendered result side by side.
