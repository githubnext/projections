# Generated values

Status: **decided; implemented.** This extends
[volatile data](../contracts/extractions.md#volatile-data) to cover values an
extractor generates from an identifiable input — for example, a language model's
one-line summary of a class.

## Why

Most extractors are deterministic, and they should be. Still, some of the most
helpful context for a reviewer is easier to generate than to parse: what a
package is responsible for, what a class does, or a plain-English description of
an HTTP route. Sending a class's source to a language model and storing its
summary lets reviewers see a change's _meaning_, not just its structure.

The catch is wording drift. Ask a model the same question twice and it phrases
the answer slightly differently. Without special handling, every re-run flags
every summary as "modified", burying a one-class PR under a hundred noisy
rewordings.

Timings had the exact same problem, and
[volatile data](../contracts/extractions.md#volatile-data) solved it: the
extraction marks which values may vary, the engine checks whether each
difference stays within tolerance, and anything within tolerance never counts as
a change. Generated values use the same mechanism with a different kind of
tolerance. A number is within tolerance when it is numerically close; a
generated value is within tolerance when **it came from the same inputs**, no
matter how the wording shifted. Because only the extractor knows what those
inputs were, it records them alongside the value as a **basis** — a small object
of named hashes (source text, prompt, model). The engine never tries to guess
whether two sentences mean the same thing; it simply compares bases.

We call these **generated values** rather than "nondeterministic values" or "AI
values" because the mechanism depends only on having an identifiable input, not
on how the value was produced.

## Decisions at a glance

1. A volatile declaration can set `"generated": true` with
   `"basis": "<pointer>"`. The basis is a small object of named parts inside the
   item's own `data` and cannot itself be volatile.
2. When both sides share an equal basis, a difference in text counts as within
   tolerance: the item stays `unchanged` with `varied`, appears in no step, and
   passes `check`. When the bases differ, the item is `modified` and the varied
   entry lists which parts moved in `because`. The extractor controls what
   matters by choosing what goes into the basis — anything omitted can never
   trigger a change.
3. Comparator rules can read `generated` and `because` on every `Varied` entry,
   plus two helpers: `generated.because(change)` and
   `generated.only(change, parts)`. Rules can classify, summarize, and reorder
   regenerated changes, though they can never change an item's status.
4. The runner maintains a **generation store** keyed by declared path and basis
   digest, populated from validated extractions (including verified CI
   artifacts) and handed to extractors as a read-only snapshot. Reusing stored
   values for matching bases produces byte-identical text across re-runs and PR
   comparisons. The SDK exposes `basis()` and `generations()` to make this easy.
5. Hosts and the kit tag every generated field with a subtle **Generated** label
   and a `generated` icon. When bases match, they display After's text with the
   neutral `varied` icon, "Regenerated from the same inputs", and a toggle to
   inspect Before's wording. When bases differ, they show both passages side by
   side, explain why ("Regenerated because the input changed"), and offer an
   optional word diff.
6. An extractor that calls a model is repository code requiring `--trust`, with
   `network` and credential variables declared. Saved extractions record
   `provenance.generated`, and agent tools (`compare`, `current_view`) note
   generated fields so models don't present summaries as ground-truth facts.

## 1. Declaration

### The declaration

```json
"volatile": [
  {"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"},
  {"kinds": ["class"], "path": "/data/methods/*/summary", "generated": true, "basis": "/data/methods/*/summaryBasis"}
]
```

- `generated: true` marks a generated value (and `true` is the only valid value;
  omit it for other volatile fields).
- `basis` is required whenever `generated` is set and forbidden otherwise. It is
  a pointer under `/data/` on the same item, following the same `*` rule as a
  tolerance's `spread`: it can only reference `*` segments present in `path`,
  matching them positionally so each method's summary gets its own basis.
- Generated declarations carry no `tolerance` — the basis _is_ the tolerance,
  and any change to a basis part puts the value beyond tolerance. If a part
  shouldn't trigger changes (like a model upgrade), leave it out of the basis.

`collection` and `kinds` behave just like any other volatile declaration, and
generated declarations count toward the 256-declaration limit.

### The basis value

The basis lives in the item's regular `data` as a small object of named parts:

```json
"data": {
  "summary": "Validates orders, reserves stock and hands paid orders to fulfillment.",
  "summaryBasis": {
    "input": "sha256:5b0e…",
    "prompt": "sha256:91c4…",
    "model": "fake-summarizer@1"
  }
}
```

- A basis has 1 to 16 parts whose names match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`
  (the same rule as renderer control IDs). Extractors choose the names, though
  `input`, `prompt`, and `model` are conventional and have tailored UI phrasing
  (see [presentation](#5-presentation)).
- Every part value is a non-empty string up to 256 UTF-8 bytes — typically a
  `sha256:` hash with 64 lowercase hex digits. Keeping a model ID human-readable
  lets the UI explain which model replaced which.
- An item must have a basis if and only if it has the generated value: a value
  without a basis can't be judged, and a basis without a value describes
  nothing.

### Validation

During normalization, the engine validates both the declarations and every
matched item's basis, reporting errors at the usual paths (`/volatile/0/basis`,
`/entities/12/data/summaryBasis`):

<!-- prettier-ignore -->
| Code | When |
|---|---|
| `invalid-volatile-path` | `basis` isn't a pointer under `/data/`, or uses a `*` its `path` doesn't have |
| `invalid-tolerance` | A `tolerance` with `generated` |
| `invalid-type` | `generated` with a value other than `true` |
| `invalid-generated` | `generated` without `basis`, or `basis` without `generated` |
| `volatile-basis` | A basis path is volatile: some declaration whose collection and kinds overlap this one's has a path equal to the basis path, inside it or containing it (a `*` overlaps any segment), including the generated value's own path |
| `invalid-basis` | A basis that isn't an object of 1 to 16 parts with valid names and string values within the limits |
| `missing-basis` | An item with the generated value and no basis |
| `orphan-basis` | An item with a basis and no generated value |

A basis can never be volatile itself — if the yardstick could move freely, we
could never tell expected variation from real change.

### Normalization and digests

Normalized declarations preserve `generated` and `basis`, keeping the existing
sort order (collection, path, kinds) and duplicate check (same collection,
kinds, and path — a plain declaration and a generated one at the same path
collide).

Because canonical bytes already include the normalized `volatile` list,
**extractions that don't use these fields remain byte-for-byte identical**,
along with their digests and comparisons. Generated text is ordinary data: two
extractions with differently worded summaries have different digests (just like
two runs with different timings), which is why the generation store exists to
keep them identical across runs.

## 2. Comparison

### Judging one generated value

For a matched pair and a concrete path matching a generated declaration, with
values `v` and bases `b` on each side:

<!-- prettier-ignore -->
| Before and after | Varied entry | Effect on the pair |
|---|---|---|
| Neither side has the value | None | None |
| Equal values, equal bases | None | None |
| Different values, equal bases | `{path, within: true, generated: true}` | `unchanged` with `varied` if nothing else differs |
| Different bases, values equal or not | `{path, within: false, generated: true, because}` | `modified` |
| The value on one side only | `{path, within: false, generated: true, reason}` | `modified` |

`because` lists every basis part whose value changed (including parts present on
only one side), sorted by UTF-16 code units, and is omitted when empty. The
basis path is judged exclusively through its generated value — never as a plain
data diff or a separate varied path — so a pair whose only edit is a regenerated
summary is judged solely by its basis, not by hash noise in `summaryBasis`.

Even if both sides produced identical wording, a changed basis still marks the
pair `modified`: the underlying input moved, even if the model happened to emit
the same sentence. The UI explains this as "Regenerated because the input
changed; the wording is the same."

In `comparison/v0`, `varied` entries gain two optional fields:

```json
{"id": "class:OrderService", "collection": "entities", "before": ["class:OrderService"],
 "after": ["class:OrderService"], "status": "unchanged", "correspondence": "exact",
 "varied": [{"path": "/data/summary", "within": true, "generated": true}]},
{"id": "class:Cart", "collection": "entities", "before": ["class:Cart"], "after": ["class:Cart"],
 "status": "modified", "correspondence": "exact",
 "varied": [{"path": "/data/summary", "within": false, "generated": true, "because": ["input"]}]}
```

The comparison's `variation` summary keeps the same shape: `unchanged` items
with generated `varied` count under `within`, and `modified` items with
`within: false` count under `beyond`. Hosts break out regenerated counts
separately in the summary bar (see [where it appears](#where-it-appears)).

### Several declarations at one path

Both sides' declarations apply to a pair as usual. When multiple declarations
match one concrete path, the stricter one wins:

- A generated declaration beats a plain declaration (with or without numeric
  bounds), since an unbounded plain declaration accepts any change and numeric
  tolerances don't apply to text.
- Originally, when two declarations named different basis pointers, the after
  side won (matching spreads).

  Superseded in November 2026: to keep reversed comparisons completely
  symmetric, every basis now counts (any differing basis puts the value beyond
  tolerance) and every spread must hold. The Engine proves this symmetry
  ([extraction contract](../contracts/extractions.md#volatile-data),
  `packages/engine/VERIFICATION.md`).

Whenever either side covers a path with a generated declaration, its basis path
is judged strictly through that declaration — even if the other side marked that
basis path volatile.

### Rules for every comparator

The engine's `volatility` module remains the single source of truth shared by
the default comparator, rules comparators, `validate-comparison`, and `vary`.
Validation verifies `generated` and `because` alongside the rest of `varied`
(`inconsistent-variation`), so no comparator can suppress a basis change or pass
it off as expected.

### `vary` and `check`

`vary`'s `within` and `beyond` entries also include `generated` and `because`. A
re-run that reworded a summary from the same basis lands in `within`
(reproducible), while a re-run whose basis shifted — most commonly `model`, when
a provider silently updated an unpinned alias — lands in `beyond` with a message
like "Regenerated because the model changed".

`projections check` feeds the generation store populated by the first run into
the second run, so a well-behaved extractor produces byte-identical output. If a
re-run only agrees within tolerance, `check` still passes and prints a tip: "12
generated values were regenerated from the same inputs. Reuse them through the
generation store for identical reruns."

## 3. Comparator rules

`Varied` gains two always-present fields so rules don't need null guards:

| Field       | Type           | Value                                                                                          |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `generated` | `bool`         | Whether the path is a generated value. `false` for every other volatile value                  |
| `because`   | `list<string>` | The basis parts that moved, sorted. `[]` when the bases are equal or the value isn't generated |

Two helpers are added under the `generated` namespace:

<!-- prettier-ignore -->
| Function | Signature | Why it's in the engine |
|---|---|---|
| `generated.because(change)` | `Change -> list<string>` | The parts that moved across all of a change's generated values, unique and sorted by UTF-16 code units. Deduplicating and sorting a list is list surgery CEL can't do in order |
| `generated.only(change, parts)` | `Change, list<string> -> bool` | Whether the pair differs only in generated values whose bases moved only in `parts`: the change would be `unchanged` if those parts were ignored. It needs the core's content comparison modulo paths, which CEL can't express |

For example, a comparator can group model-only upgrades into a final step:

```yaml
classify:
  where: generated.only(change, ['model'])
  summary: "'`%s` was regenerated with a different model.'.format([item.label])"

steps:
  add:
    - changes: generated.only(change, ['model'])
      kind: restructure
      place: end
      summary: "'Regenerated with a different model'"
```

Rules can classify and order these changes, but never demote them to `unchanged`
— preserving ["a comparator cannot hide a change"](../contracts/comparisons.md).
If an extractor doesn't want model upgrades to count as changes, it simply omits
the model from the basis so every comparator, host, and `check` run agrees.

## 4. Bases and the generation store

### Hashing a basis

Because a basis is plain JSON, any language can build one. Its **digest** (half
of the generation store's key) is `sha256:` followed by the lowercase hex
SHA-256 of its [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical JSON
— the same canonicalizer the engine uses for extractions. Since every value is a
string, that boils down to UTF-16-sorted keys, `JSON.stringify`-style string
escaping, and no whitespace.

The SDK provides helpers for this. In JavaScript, they live at
`@githubnext/projections/extractor`:

```js
import {basis, generations, readRequest} from '@githubnext/projections/extractor'

const request = await readRequest()
const store = await generations(request)

const summaryBasis = basis({input: classSource, prompt: SYSTEM_PROMPT, model: 'fake-summarizer@1'})
const summary = await store.generate('/data/summary', summaryBasis, () => model.summarize(classSource))
```

- `basis(parts, {verbatim = ['model']} = {})` hashes each part (UTF-8 bytes for
  strings, canonical JSON for anything else) into `sha256:<hex>`, keeps any
  `verbatim` parts untouched (up to 256 bytes, so model IDs stay readable), and
  throws if part limits are exceeded.
- `basisDigest(basis)` computes the basis digest.
- `generations(request)` loads the snapshot referenced in the request (if any).
  `get(path, basis)` returns a stored value or `undefined` for the declaration's
  `path` pattern (including `*` segments, not a concrete index), and
  `generate(path, basis, produce)` returns the cached value or awaits
  `produce()`.

The Rust extractor SDK ships the matching helpers (`Basis`, `basis_digest`,
`Context::generations`) so the engine, CLI, and SDK share one tested
implementation. (Today's built-in Rust extractors don't generate values.)

### What belongs in a basis

Put everything into the basis that _should_ trigger regeneration when it
changes, and leave out everything else. Our authoring guide recommends:

- **Scope the input tightly.** Hash only what the model actually reads — the
  class's source, not the entire file — so editing another class in the same
  file doesn't regenerate this summary. If whitespace-only edits shouldn't
  trigger regeneration, normalize line endings and trailing whitespace before
  _both_ hashing and sending to the model.
- **Include the prompt.** Hash the full system prompt, template, and few-shot
  examples so prompt changes regenerate every value as expected. Any retrieved
  context the model sees is also an input — put it under its own part
  (`context`) so changes explain what moved.
- **Include the model only if upgrades should count.** Pin a dated or versioned
  model ID (`gpt-4o-2024-08-06`) rather than a floating alias. If model upgrades
  shouldn't regenerate anything, leave `model` out and the store will keep
  serving earlier text until the input or prompt changes. Generation parameters
  that alter output (temperature, max length) belong in the prompt part or a
  `parameters` part.
- **Leave out incidental metadata:** sampling seeds, timestamps, request IDs,
  commit hashes, file paths the model never sees, or extractor versions (if the
  extractor changed how it builds the prompt, the prompt hash already moved).
- **Never include secrets:** no credentials, endpoints, or account names, not
  even hashed. Bases are plain data that get saved, uploaded in CI artifacts,
  and displayed in hosts.

Naming parts after what can move is what makes reasons readable ("Regenerated
because the input changed"); a single opaque hash would check equality but say
nothing.

### The generation store

The runner owns the store, not the extractor:

- **Location.** Stored in the per-user cache directory beside extractions:
  `generations/<repository>/<SHA-256 of the projection ID>.jsonl` (keyed by the
  repo's Git common directory). Each line has the form
  `{"path": "/data/summary", "basis": "sha256:<hex>", "value": <JSON>, "used": "<UTC time>"}`,
  keyed by the declaration's `path` pattern (including `*` segments) and basis
  digest. Two different fields with identical bases don't share a value, and
  renaming a declared path simply regenerates once.
- **Harvesting.** Whenever an extraction passes validation, the runner records
  all of its generated values under their declared path and basis digest.
  Existing keys keep their first recorded value so wording converges instead of
  drifting. Cached extractions and verified
  [CI artifacts](../runner/caches.md#ci-artifacts-as-a-source) (`--ci`,
  `--artifact`) are harvested too; stale extractions are skipped.
- **Passing snapshots to extractors.** When the store has entries, the runner
  writes a private read-only snapshot (`0600`, deleted after the run, capped at
  32 MiB) and passes `"generations": {"file": "/abs/path/generations.jsonl"}` in
  the request (inside containers, mounted read-only at `/generations.jsonl`).
  Extractors must still work if no snapshot is provided.
- **Bounds.** Each projection is capped at 16 MiB (LRU eviction, refreshed
  whenever an extraction uses a key), and the global store defaults to 128 MiB
  (`PROJECTIONS_GENERATION_CACHE_BYTES`). Deleting the store is always safe; the
  next run simply regenerates.
- **Fresh runs.** Passing `--regenerate` to `show`, `compare`, or `check` omits
  the snapshot for that run. Results are still harvested, while previously
  stored keys retain their original values.

During a comparison, the runner extracts and harvests the before side before
running the after side. That means unchanged classes in a PR reuse the base's
exact text even on a cold cache — including in CI, where every job starts clean.
With `--ci`, local runs reuse CI's text too, eliminating spurious rewording in
working-tree comparisons.

Because extractors never write to the store, they need no home directory, work
inside read-only containers, and can't poison another projection or revision.
Every stored value comes exclusively from an extraction that passed validation.

## 5. Presentation

### The Generated mark

Every generated field carries a quiet **Generated** label beside its name — the
`generated` icon paired with the word in muted foreground color at field-label
size — so a generated summary is never mistaken for a parsed fact. Like every
icon in the system, it always accompanies its label, and because it is a field
marker rather than a change badge, it never appears in `NameLine` next to change
status.

The `generated` icon uses Lucide's `Sparkle` outline (single four-point star)
through the same pipeline as `varied` (`packages/renderers/sdk/src/icons.ts`,
theme token `icon-generated`, and `sparkle` in VS Code's codicon map). In the
vocabulary docs under volatile data, it is defined as: "`generated`, a value an
extractor generated from a recorded basis. Neutral, never a change kind."

### Equal basis, different text

When bases match, rewording is expected variation: the item stays `unchanged`
with no emphasis, status badge, or motion in any mode (`highlight-scope` and
`diff-neutral` still apply). In the detail card or kit-rendered field, we show
After's text with no word diff:

```
 Summary  ✦ Generated
 Validates orders, reserves stock and hands paid orders to
 fulfillment.
 ∿ Regenerated from the same inputs          [ Before's wording ]
```

`∿` is the `varied` icon in body text color. Clicking the pressed-state toggle
(`aria-pressed`) swaps in Before's text and relabels the button "After's
wording". Both passages share a single grid cell (with the inactive one hidden)
so the container keeps the taller height and toggling causes zero layout shift.

### Changed basis

When the basis changed, the item is `modified` and animates like any modified
item. The field displays both passages side by side (stacked on narrow widths)
beneath the reason:

```
 Summary  ✦ Generated                                      ~ Modified
 Regenerated because the input changed
 ┌ Before ──────────────────────────┐ ┌ After ───────────────────────────┐
 │ Validates orders and reserves    │ │ Validates orders, reserves stock │
 │ stock.                           │ │ and hands paid orders to         │
 │                                  │ │ fulfillment.                     │
 └──────────────────────────────────┘ └──────────────────────────────────┘
 [ Word diff ]
```

"Word diff" toggles to a single inline-marked passage styled like the text-diff
renderer. It starts off by default because regenerated prose usually rewords
more than it semantically changes, and both layouts share one grid cell so
toggling doesn't shift anything below.

The reason sentence translates conventional part names: `input` becomes "the
input changed", `prompt` becomes "the prompt changed", and `model` becomes "the
model changed (`fake-summarizer@1` → `fake-summarizer@2`)" using the verbatim
model IDs. Custom part names appear in monospace ("`context` changed"), and
multiple parts join naturally ("Regenerated because the input and the prompt
changed."). If the text happens to be identical, the two panes collapse into one
with "the wording is the same"; one-sided values say "Generated only after" or
"Generated only before".

Non-string generated values render as formatted monospace JSON in the same two
layouts without a word diff.

### Where it appears

- **Renderer SDK.** `generatedPaths(extraction, item)` lists an item's generated
  paths from the extraction declarations, and `generatedWords(entry)` formats
  the reason sentence. Because `VariedChange` already carries `varied`,
  `generated` and `because` flow through with no new protocol messages.
- **Kit.** `GeneratedText` (`{before?, after, entry?}`) renders both states, the
  Generated mark, and the toggles so renderers don't reimplement them.
- **Hosts** (web and VS Code). The detail card puts a selected item's generated
  fields at the top and hides the raw basis object from the plain field list,
  tucking its parts inside a collapsed "Basis" disclosure with shortened hashes
  (`sha256:5b0e…`, full hash on hover) and monospace model IDs. The summary bar
  shows a neutral "N regenerated" filter toggle next to "N varied within
  tolerance", where N counts `unchanged` items with a generated `varied` entry
  and "varied within tolerance" counts `unchanged` items with any non-generated
  `varied` entry (an item with both counts in both).
- **Agent viewer.** Matches the hosts without editing controls.

Labels follow our sentence-case rule, while part names and model IDs render
verbatim in monospace with no CSS recasing.

## 6. Trust, provenance and agents

Because an extractor calling a model needs credentials and network access, it is
ordinary trusted repository code (`--trust`) declaring `execution.network: true`
and its credential variable names in `execution.environment`. Generated values
don't alter any trust boundary: hosted views never run extractors, they simply
display CI-published values and compare bases.

We recommend `execution.determinism: environmental`. Note that the environment
fingerprint hashes granted environment variable values, so rotating an API key
invalidates cached extractions without invalidating the basis-keyed generation
store. `check` warns if a `pure` definition produces generated values, since
`pure` extractions cache by tree alone and are expected to reproduce identically
— something a model call can't guarantee.

Every saved extraction with generated values gets a `provenance.generated`
block:

```json
"generated": {"values": 128, "reused": 126, "sources": ["local", "ci"]}
```

`values` is the total number of generated values emitted, `reused` is how many
matched an existing key and value from the snapshot, and `sources` lists which
stores contributed. Like all provenance, it is informational and grants nothing.

Agent tools surface generated fields explicitly so a model won't mistake a
summary for an extracted code fact:

- `compare`: "3 generated values changed (input: 2, model: 1); 41 were
  regenerated from the same inputs (within tolerance)", with each changed item
  noting which fields were generated and `structuredContent` carrying `varied`.
- `current_view`: the selected item's generated fields and the view's counts.
- `check`: the generation-store reuse hint above.

## 7. Example

`examples/extractors/class-summaries` demonstrates the flow by summarizing
TypeScript classes with a deterministic stub model (`fake-summarizer@1`) via
`typescript-common`, making zero network or paid calls. The stub picks among
several phrasings by hashing the input with `FAKE_SUMMARIZER_SAMPLE`, letting
tests exercise equal-basis rewording without randomness. It uses
`@githubnext/projections/extractor` for `basis()` and the store, declaring:

```json
{"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"}
```

Its fixtures exercise equal-basis rewording, input changes, and model-only
changes. The graph renderer's `class-summaries` scenario
(`packages/renderers/graph/scenarios.json`) renders those detail cards with
`GeneratedText`, paired with `examples/comparators/model-upgrades` using
`generated.only` to group model-only updates into a final step.

### Tests

- Engine unit tests covering equal and unequal bases, `because` (including
  one-sided parts), after-side basis precedence, every validation error code,
  and byte-identical digests/comparisons when the fields aren't used.
- Rules tests for the new `Varied` fields, `generated.because`, and
  `generated.only`.
- SDK tests for basis hashing (golden digests shared between JS and Rust), store
  lookups and `generate`, plus runner harvesting, keep-first semantics,
  eviction, and `--regenerate`.
- Renderer harness and host browser specs verifying both presentations:
  layout-shift-free toggles, word diff, reason phrasing, and the Generated mark.
- CLI tests for `compare` across a basis change, `check` passing on equal-basis
  rewording, and the `pure` warning.

## Alternatives rejected

- **A separate `generated` list beside `volatile`.** That would duplicate path
  pointers, kinds, tighter-wins precedence, `vary`, `check`, and variation
  filters. A generated value _is_ a volatile value — only its tolerance rule is
  new.
- **Semantic text comparison** using similarity thresholds, embeddings, or an
  LLM judge inside the comparator. Comparators must stay pure, deterministic,
  and network-free across browsers and github.com, and similarity thresholds are
  arbitrary and opaque. Comparing bases gives an exact, extractor-controlled
  answer.
- **Having the engine compute the basis** from source files or evidence. Only
  the extractor knows what prompt and slice of input the model actually saw.
- **One opaque hash.** Enough for equality, but useless for explaining _why_ a
  value regenerated or distinguishing a model upgrade from a code edit. Named
  parts cost only a few bytes.
- **Letting rules demote model-only changes to `unchanged`.** That breaks the
  guarantee that comparators can't hide changes and would let two comparators
  disagree on the same pair. The extractor decides what counts by choosing what
  goes into the basis.
- **Ignoring selected basis parts in a tolerance**
  (`tolerance: {ignore: ["model"]}`). Since the extractor already controls the
  basis, leaving a part out is simpler than recording and ignoring it.
- **Word-diffing equal-basis variation or always showing both texts.**
  Rewordings from identical inputs carry no signal, and diffing them looks like
  a real change. One quiet toggle is plenty.
- **An extractor-owned cache directory.** Extractors have no home directory, may
  run in read-only containers, and shouldn't be able to poison other revisions.
  A runner-owned store populated from validated extractions avoids all three and
  reuses CI artifacts with no new artifact format.
- **Relying on the extraction cache alone.** Whole-extraction caching is keyed
  by Git tree, so any unrelated edit would regenerate every summary. Per-value
  reuse keeps untouched classes stable.
- **Putting the basis outside `data`** as a new top-level item field. That would
  change the core item schema for every extraction; a pointer into `data` reuses
  the existing `spread` machinery cleanly.

## Decided questions

These were open in the first draft and decided before implementation:

1. **No `tolerance.ignore`.** Extractors decide what counts by choosing what
   goes into the basis; rules only classify and order changes.
2. **Store keyed by path and basis** (declaration path pattern + basis digest),
   so two fields with identical bases never collide and moving a path simply
   regenerates once.
3. **No built-in renderer renders generated text yet** — it lives in detail
   cards and custom renderers for now.
4. **Icon is Lucide's `Sparkle`.**
5. **Dedicated summary count:** "N regenerated" appears alongside "varied within
   tolerance".
6. **Any JSON value can be generated**; non-strings render as JSON without word
   diff.
7. **CI extracts the base first in the same job** rather than downloading
   artifacts by default, avoiding `actions: read`.
8. **`check` warns when a `pure` definition emits generated values.**

## Schema and interface changes

| Where                    | Change                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `extraction/v0`          | `volatile[]` gains `generated` (`true`) and `basis` (a pointer); a generated declaration has no `tolerance` |
| `comparison/v0`          | `varied[]` gains `generated` (`true`) and `because` (unique part names, at least one)                       |
| `extractor-request/v0`   | Optional `generations: {file}`                                                                              |
| `extraction-document/v0` | Optional `provenance.generated: {values, reused, sources}`                                                  |
| Engine `vary`            | `within` and `beyond` entries gain `generated` and `because`                                                |
| Rules                    | `Varied.generated`, `Varied.because`, `generated.because`, `generated.only`                                 |
| Renderer SDK and kit     | The `generated` icon, `generatedPaths`, `generatedWords` and `GeneratedText`                                |
| Package                  | `@githubnext/projections/extractor`: `basis`, `basisDigest`, `generations`, `readRequest`                   |
| CLI                      | The generation store, harvesting, `--regenerate` and `PROJECTIONS_GENERATION_CACHE_BYTES`                   |
| Agent tools              | `compare`, `current_view` and `check` mention generated values                                              |

Every addition is optional, so extractions, comparisons, and requests without
generated values keep their exact bytes, digests, and semantics.
