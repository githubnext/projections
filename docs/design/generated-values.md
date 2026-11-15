# Generated values

Status: **decided; implemented.** This extends
[volatile data](../contracts/extractions.md#volatile-data) to values an
extractor generates from an identifiable input, such as a language model's
summary of a class.

## Why

Extractors should be deterministic, and most are. But some useful facts are
easier to generate than to extract: what a package is responsible for, what a
class does, a one-line description of a route. An extractor can send a class's
source to a language model and record the summary it gets back. That fits
projections well: a reviewer sees a change's meaning, not only its structure.

It breaks one assumption, though. Ask a model the same question twice and the
wording changes. Without help, every rerun "modifies" every summary, and a pull
request that touched one class shows a hundred changed summaries.

Timings had the same problem, and
[volatile data](../contracts/extractions.md#volatile-data) solved it: an
extraction declares which values may vary, the engine judges each difference
within or beyond a tolerance, and variation within tolerance is never a change.
Generated values need the same thing with a different tolerance. A number is
within tolerance when it's close enough. A generated value is within tolerance
when **it was generated from the same inputs**, whatever its wording. Only the
extractor knows those inputs, so it records them beside the value as a
**basis**: a few named hashes (the source text, the prompt, the model). The
engine never reads text to guess whether it means the same thing. It compares
bases.

The term is **generated values**, not "nondeterministic values" or "AI values".
They come from an identifiable input, and nothing here depends on how they were
generated.

## Decisions at a glance

1. A volatile declaration may carry `"generated": true` and
   `"basis": "<pointer>"`. The basis is a small object of named parts in the
   item's own `data`, and it can't itself be volatile.
2. When the bases are equal, a difference in the value is within tolerance: the
   item is `unchanged` with `varied`, in no step, and reproducible in `check`.
   When the bases differ, the item is `modified`, and the varied entry names the
   parts that moved in `because`. What counts is the extractor's choice of
   basis: a part it leaves out can't make a change.
3. Comparator rules see `generated` and `because` on every `Varied`, plus two
   library functions: `generated.because(change)` and
   `generated.only(change, parts)`. Rules can classify, summarize and order
   regenerated changes. They can't change a status.
4. The runner keeps a **generation store** keyed by the declared path and the
   basis digest. It fills the store from validated extractions, including
   verified CI artifacts, and hands a read-only snapshot to the extractor. An
   extractor that reuses a stored value for an equal basis gets byte-identical
   text, so reruns and pull request comparisons usually show no variation at
   all. The SDK helpers are `basis()` and `generations()`.
5. Hosts and the kit mark every generated field with a quiet **Generated** label
   and a new `generated` icon. With an equal basis they show After's text, the
   neutral `varied` icon and "Regenerated from the same inputs", with a toggle
   for Before's wording. With a changed basis they show both passages side by
   side, say why ("Regenerated because the input changed") and offer a word
   diff.
6. An extractor that calls a model is repository code under `--trust`, with
   `network` and its credential variables declared. The saved extraction records
   `provenance.generated`, and agents' `compare` and `current_view` results
   mention generated fields.

## 1. Declaration

### The declaration

```json
"volatile": [
  {"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"},
  {"kinds": ["class"], "path": "/data/methods/*/summary", "generated": true, "basis": "/data/methods/*/summaryBasis"}
]
```

- `generated: true` marks a generated value. It is the only value `generated`
  takes. Omit it for any other volatile value.
- `basis` is required when `generated` is set and not allowed otherwise. It is a
  pointer under `/data/` into the same item, with the same `*` rule as a
  tolerance's `spread`: it may use only the `*` segments its `path` has, and its
  first `*` takes the key the path's first `*` matched, and so on. In the
  example, each method's summary has its own basis.
- A generated declaration has no `tolerance`: the basis is its tolerance. A
  change to any part is beyond. An extractor that doesn't want a part to count
  (a model upgrade, say) leaves it out of the basis.

`collection` and `kinds` work as for any volatile declaration. Generated
declarations count toward the 256-declaration limit.

### The basis value

The basis is ordinary data in the item, one small object of named parts:

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

- 1 to 16 parts. Part names match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, the pattern
  renderer control IDs use. Their meaning is up to the extractor; `input`,
  `prompt` and `model` are the conventional names, and hosts have words for them
  (see [presentation](#5-presentation)).
- Each part's value is a nonempty string of at most 256 UTF-8 bytes. Usually
  that's a hash (`sha256:` and 64 lowercase hex digits). A model ID stays
  readable, so a change can say which model replaced which.
- An item has a basis exactly when it has the generated value. A value without a
  basis can't be judged, and a basis without a value describes nothing.

### Validation

The engine checks declarations when it normalizes an extraction, and checks
basis values in every item a generated declaration matches. Errors use the
existing paths (`/volatile/0/basis`, `/entities/12/data/summaryBasis`):

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

The basis must not be volatile because it's how the engine decides whether
variation is expected. If the basis could vary freely, nothing would ever be
judged.

### Normalization and digests

The normalized declaration keeps `generated` and `basis`. The sort order
(collection, path, kinds) and the duplicate rule (same collection, kinds and
path) don't change. A plain declaration and a generated one at the same place
are duplicates.

Canonical bytes already include the normalized `volatile` list, so extraction
digests change only for extractions that use the new fields. **Extractions
without them are byte-for-byte unchanged**, and so are their digests and
comparisons. Generated text is data like any other: two extractions whose
summaries are worded differently have different digests, as two runs with
different timings do. The generation store is what usually makes them identical.

## 2. Comparison

### Judging one generated value

For a matched pair and one concrete path a generated declaration matches, with
values `v` and bases `b` on each side:

<!-- prettier-ignore -->
| Before and after | Varied entry | Effect on the pair |
|---|---|---|
| Neither side has the value | None | None |
| Equal values, equal bases | None | None |
| Different values, equal bases | `{path, within: true, generated: true}` | `unchanged` with `varied` if nothing else differs |
| Different bases, values equal or not | `{path, within: false, generated: true, because}` | `modified` |
| The value on one side only | `{path, within: false, generated: true, reason}` | `modified` |

`because` is the names of the parts whose values differ, including parts present
on one side only, sorted by UTF-16 code units. It is omitted when empty. The
basis path belongs to its generated value: a basis difference is reported
through the value's entry, never as a plain data difference or as a separate
varied path. So a pair whose only difference is a regenerated summary is
`unchanged` or `modified` according to its basis, never because the hashes in
`summaryBasis` changed.

When the values are equal but the basis changed, the pair is `modified`. The
input moved, so the summarized thing changed, even if the model happened to
produce the same sentence. Presentation says "Regenerated because the input
changed; the wording is the same."

The comparison's `varied` entry gains two optional fields:

```json
{"id": "class:OrderService", "collection": "entities", "before": ["class:OrderService"],
 "after": ["class:OrderService"], "status": "unchanged", "correspondence": "exact",
 "varied": [{"path": "/data/summary", "within": true, "generated": true}]},
{"id": "class:Cart", "collection": "entities", "before": ["class:Cart"], "after": ["class:Cart"],
 "status": "modified", "correspondence": "exact",
 "varied": [{"path": "/data/summary", "within": false, "generated": true, "because": ["input"]}]}
```

The comparison's `variation` counts don't change shape: an `unchanged` change
with generated `varied` counts toward `within`, and a `modified` one with a
`within: false` entry toward `beyond`. Hosts count regenerated values separately
from the changes (see [where it appears](#where-it-appears)).

### Several declarations at one path

Both sides' declarations apply to a pair, as now. When several apply at one
concrete path, the tighter one still wins:

- A generated declaration is tighter than a plain one, with or without numeric
  bounds, because a plain declaration without a tolerance accepts any difference
  and a numeric tolerance doesn't apply to text.
- When the two name different basis pointers, the after side's wins, as for
  different spreads.

  Superseded in November 2026: so that a reversed comparison judges every value
  the same way, every basis counts (the value is beyond when any differs) and
  every spread must hold. The Engine proves the combination symmetric
  ([extraction contract](../contracts/extractions.md#volatile-data),
  `packages/engine/VERIFICATION.md`).

If either side's generated declaration covers a path, the paths its basis names
are judged only through it, even where the other side declares them volatile.

### Rules for every comparator

The engine's `volatility` module stays the one definition of these rules, shared
by the default comparator, rules comparators, `validate-comparison` and `vary`.
Validation checks `generated` and `because` like the rest of `varied`
(`inconsistent-variation`), so no comparator can call a basis change expected or
hide one.

### `vary` and `check`

`vary`'s `within` and `beyond` entries gain `generated` and `because`. A rerun
that reworded a summary from an equal basis is `within`, so the runs are
reproducible. A rerun whose basis moved (most often `model`, when a provider
updated a model behind an unpinned name) is `beyond`, with a reason such as
"Regenerated because the model changed".

`projections check` reruns with the generation store the first run filled, so a
well-behaved extractor's rerun is byte-identical. When the rerun's generated
values are equal only within tolerance, the check still passes, with a note: "12
generated values were regenerated from the same inputs. Reuse them through the
generation store for identical reruns."

## 3. Comparator rules

`Varied` gains two fields. Both are always present, so rules never need a guard:

| Field       | Type           | Value                                                                                          |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `generated` | `bool`         | Whether the path is a generated value. `false` for every other volatile value                  |
| `because`   | `list<string>` | The basis parts that moved, sorted. `[]` when the bases are equal or the value isn't generated |

Two functions join the library, under a new `generated` namespace:

<!-- prettier-ignore -->
| Function | Signature | Why it's in the engine |
|---|---|---|
| `generated.because(change)` | `Change -> list<string>` | The parts that moved across all of a change's generated values, unique and sorted by UTF-16 code units. Deduplicating and sorting a list is list surgery CEL can't do in order |
| `generated.only(change, parts)` | `Change, list<string> -> bool` | Whether the pair differs only in generated values whose bases moved only in `parts`: the change would be `unchanged` if those parts were ignored. It needs the core's content comparison modulo paths, which CEL can't express |

A file that treats model upgrades as minor puts them in a step of their own,
last, and says so:

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

Rules classify and order; they can't make such a change `unchanged`. The core
judges variation, and
["a comparator cannot hide a change"](../contracts/comparisons.md) stays true.
An extractor that doesn't want a model upgrade to count leaves the model out of
the basis. Then the core judges it the same way in every comparator and every
host, and `check` agrees.

## 4. Bases and the generation store

### Hashing a basis

A basis is plain data, so any language can produce one. Its **digest**, half of
the store's key, is `sha256:` followed by the lowercase hex SHA-256 of the basis
object's [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical JSON, the
same canonicalization the engine uses for extractions. Since every part is a
string, that is the object's keys sorted by UTF-16 code units, each string
escaped as `JSON.stringify` escapes it, with no whitespace.

The SDK helpers do this. In JavaScript, a new entry of the published package,
`@githubnext/projections/extractor`:

```js
import {basis, generations, readRequest} from '@githubnext/projections/extractor'

const request = await readRequest()
const store = await generations(request)

const summaryBasis = basis({input: classSource, prompt: SYSTEM_PROMPT, model: 'fake-summarizer@1'})
const summary = await store.generate('/data/summary', summaryBasis, () => model.summarize(classSource))
```

- `basis(parts, {verbatim = ['model']} = {})` hashes each part: a string as its
  UTF-8 bytes, anything else as its canonical JSON. It returns `sha256:<hex>`.
  Parts named in `verbatim` are kept as written and must be strings of at most
  256 bytes, so a model ID stays readable. It checks the part limits and throws
  on a violation.
- `basisDigest(basis)` returns the basis digest.
- `generations(request)` loads the snapshot the request names, if any. Its
  `get(path, basis)` returns a stored value or `undefined`, where `path` is the
  declaration's `path` (with its `*` segments, not a concrete index).
  `generate(path, basis, produce)` returns the stored value when there is one,
  and otherwise awaits `produce()`.

The Rust extractor SDK gets the same pieces (`Basis`, `basis_digest`,
`Context::generations`) so the engine, the CLI and the SDK share one tested
definition. Rust extractors are built-ins today, and none of them generates
values.

### What belongs in a basis

The basis says what the value was generated from, so that the engine can tell a
real change from rewording. Put in it everything that should regenerate the
value when it changes, and nothing else. The guide will carry this guidance:

- **The input, narrowly.** Hash exactly what the model reads about the subject:
  the class's source, not the whole file, so an edit elsewhere in the file
  doesn't regenerate the class's summary. If formatting-only edits shouldn't
  count, normalize the text (line endings, trailing whitespace) before hashing
  it **and** before sending it, so the model and the hash see the same thing.
- **The prompt.** Hash the full system prompt and template, few-shot examples
  included. A prompt edit then regenerates every value, which is what a prompt
  edit means. Retrieved context the model reads is input too: hash it under its
  own part (`context`) so a change can say which moved.
- **The model, when a model change should count.** Use a dated or versioned
  model ID (`gpt-4o-2024-08-06`), not an alias that silently moves. If a model
  upgrade shouldn't regenerate anything, leave the model out: the store keeps
  serving the earlier text until the input or prompt changes. Include generation
  parameters that change what comes back (temperature, maximum length) in the
  prompt part, or in a `parameters` part.
- **Not** sampling seeds, timestamps, request IDs, the commit or revision, file
  paths the model never sees, or the extractor's version. If the extractor
  changed how it builds the prompt, the prompt part already changed.
- **Never** credentials, endpoints or account names, not even hashed. A basis is
  data: it's saved, published in CI artifacts and shown in hosts.

Name parts after what can move, so the reason reads well: "Regenerated because
the input changed" is the point of having parts. One opaque hash would work for
equality and say nothing.

### The generation store

The runner, not the extractor, owns the store:

- **Where.** The per-user cache directory, beside the extraction cache:
  `generations/<repository>/<SHA-256 of the projection ID>.jsonl`. The
  repository is named by its Git common directory, as for extractions. Each line
  is
  `{"path": "/data/summary", "basis": "sha256:<hex>", "value": <JSON>, "used": "<UTC time>"}`,
  keyed by the declaration's `path` (its pattern, `*` segments and all) and the
  basis digest. Two fields with equal bases don't share a value, and a field
  whose declared path moves is regenerated once.
- **Filling it.** After an extraction is validated, the runner records every
  generated value it holds under its declared path and basis digest. A key
  already stored keeps its earlier value, so text converges on the first
  generation instead of drifting with each rerun. Extractions the runner reuses
  or loads are harvested too: cached extractions, and extractions from verified
  [CI artifacts](../runner/caches.md#ci-artifacts-as-a-source) (`--ci`,
  `--artifact`). Stale extractions aren't harvested.
- **Handing it over.** When the projection's store isn't empty, the runner
  writes a read-only snapshot of it to a private temporary file (`0600`, removed
  after the run) and names it in the request:
  `"generations": {"file": "/abs/path/generations.jsonl"}`. Under container
  isolation it's mounted read-only at `/generations.jsonl` and the request names
  that path. The snapshot is at most 32 MiB. An extractor must work without it.
- **Bounds.** 16 MiB per projection, with the least recently used entries
  evicted first. An entry is used when an extraction carries its key.
  `PROJECTIONS_GENERATION_CACHE_BYTES` caps the whole store (default 128 MiB).
  Removing it is always safe; the next run regenerates.
- **Starting fresh.** `--regenerate` on `show`, `compare` and `check` sends no
  snapshot for that run. Its results are still harvested, but earlier keys keep
  their earlier values.

In a comparison the runner extracts the before side first and harvests it before
extracting the after side, so a pull request's unchanged classes get the base's
exact text even on a cold cache, including in CI, where every job starts with an
empty cache. With `--ci`, local runs reuse CI's text, so a local working-tree
comparison with CI's official extraction shows no rewording.

The extractor can't write to the store. It needs no home directory, works in a
read-only container, and can't poison another projection's or revision's values.
Every stored value came out of an extraction that passed validation.

## 5. Presentation

### The Generated mark

Every generated field carries a quiet **Generated** label next to its name: the
new `generated` icon and the word, in the muted foreground color, at the field
label's size. A summary is never mistaken for an extracted fact. Like every
icon, it accompanies its word and never stands alone. It is a field label, not a
change badge, so it never goes in the `NameLine` beside the status.

The icon joins the SDK vocabulary as `generated`, Lucide's `Sparkle` outline
(the single four-point star), in the same pipeline as `varied`
(`packages/renderers/sdk/src/icons.ts`, the theme token `icon-generated` and the
VS Code host's codicon map, where it's `sparkle`). In the vocabulary's
documentation it's listed under volatile data: "`generated`, a value an
extractor generated from a recorded basis. Neutral, never a change kind."

### Equal basis, different text

The value is expected variation: the item is `unchanged`, with no emphasis,
status or motion at any progress or in any mode (`highlight-scope` and
`diff-neutral` still hold). Where a field is shown (the host's detail card, or a
renderer that draws the text with the kit), it shows After's text, never a word
diff:

```
 Summary  ✦ Generated
 Validates orders, reserves stock and hands paid orders to
 fulfillment.
 ∿ Regenerated from the same inputs          [ Before's wording ]
```

`∿` is the `varied` icon in the text color. The toggle is a pressed-state button
(`aria-pressed`) that swaps the passage for Before's text in place, labeled
"After's wording" while pressed. Both passages are laid out in one grid cell,
the inactive one hidden, so the box always has the taller one's height and
toggling shifts nothing.

### Changed basis

The value changed for a reason. The item is `modified` and animates as any
modified item does. The field shows both passages whole, side by side (stacked
when narrow), with the reason above them:

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

"Word diff" is an optional toggle that replaces the pair with one passage marked
up as the text-diff renderer marks words. It's off by default, because a
regenerated passage usually rewords more than it changes. The two layouts share
one grid cell like the equal-basis toggle, so switching never moves what's
below.

The reason names the moved parts: `input` is "the input changed", `prompt` "the
prompt changed", `model` "the model changed (`fake-summarizer@1` →
`fake-summarizer@2`)", using a verbatim part's values. Any other part is its
name in mono, "`context` changed". Several join in a sentence: "Regenerated
because the input and the prompt changed." When the wording is equal, the
passages collapse to one, with "the wording is the same". A value present on one
side only reads "Generated only after" or "Generated only before".

A generated value that isn't a string is shown as formatted JSON in mono, in the
same two forms, without a word diff.

### Where it appears

- **Renderer SDK.** `generatedPaths(extraction, item)` returns the item's
  generated paths from the extraction's declarations. `generatedWords(entry)`
  returns the reason sentence above. `VariedChange` already carries `varied`, so
  `generated` and `because` arrive with no new messages.
- **Kit.** `GeneratedText` (`{before?, after, entry?}`) draws a generated field
  in both forms, with the mark and the toggles. Renderers that show summaries
  use it and draw nothing of their own for the states, as for every other kit
  state.
- **Hosts** (web and VS Code). The detail card lists a selected item's generated
  fields first, in these forms. The basis object is hidden from the plain field
  list, because it's judged through its value. Its parts appear in a collapsed
  "Basis" disclosure, hashes shortened (`sha256:5b0e…`, the full value as the
  title) and model IDs in mono. The summary bar counts regenerated values on
  their own, as a neutral "N regenerated" toggle beside "N varied within
  tolerance", that shows only them the way "varied only" does (as filter IDs). N
  is the number of `unchanged` changes with a generated `varied` entry; "varied
  within tolerance" counts the `unchanged` changes with any other `varied`
  entry, so a change with both is in both.
- **Agent viewer.** It follows the hosts, with no editing.

Casing follows the house rule: the words are sentence case, part names and model
IDs are data shown verbatim in mono, and nothing is recased in CSS.

## 6. Trust, provenance and agents

An extractor that calls a model needs credentials and the network, so it's
repository code like any custom command, and it runs only under `--trust`. Its
definition declares `execution.network: true` and its credential variables in
`execution.environment`. Generated values don't change any trust rule. Hosted
views never run extractors, so they never generate. They show the generated
values CI published and compare bases like every host.

Recommend `execution.determinism: environmental`. Note that the environment
fingerprint hashes granted variables' values, so rotating an API key invalidates
cached extractions, but not the generation store, which is keyed by basis.
`check` warns when a definition that declares `pure` produces generated values:
a `pure` extraction is cached by tree alone and a rerun is expected to match,
which a model call can't promise.

The runner adds `provenance.generated` to every saved extraction that has
generated values:

```json
"generated": {"values": 128, "reused": 126, "sources": ["local", "ci"]}
```

`values` is the number of concrete generated values in the extraction, and
`reused` how many carry a key and value that were already in the snapshot.
`sources` lists which stores contributed. Like the rest of provenance, it
describes the run and grants nothing.

Agents' tools mention generated fields so a model doesn't present a summary as a
fact:

- `compare`: "3 generated values changed (input: 2, model: 1); 41 were
  regenerated from the same inputs (within tolerance)". Each listed change says
  which of its fields were generated, and `structuredContent` carries `varied`.
- `current_view`: the selection's generated fields and the view's counts.
- `check`: the reuse note above.

## 7. Example

`examples/extractors/class-summaries` is a sample custom extractor that
summarizes TypeScript classes with a stubbed model. It finds classes through
`typescript-common`, and asks a deterministic fake model, `fake-summarizer@1`,
for a summary built from the class's members. It makes no network or paid calls.
The fake chooses among a few phrasings by hashing the input with
`FAKE_SUMMARIZER_SAMPLE`, so tests can produce different wording from an equal
basis without randomness. It uses `@githubnext/projections/extractor` for
`basis()` and the store, and declares:

```json
{"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"}
```

Its fixtures cover equal-basis rewording, an input change and a model-only
change. The graph renderer's `class-summaries` scenario
(`packages/renderers/graph/scenarios.json`) compares such classes, whose detail
cards show each summary with `GeneratedText`, with an example comparator,
`examples/comparators/model-upgrades`, which uses `generated.only` to collect
model-only changes in a final step.

### Tests

- Engine unit tests: equal and unequal bases, `because` (including parts present
  on one side), the after side's basis pointer winning, every validation code,
  and unchanged digests and comparisons for extractions without the fields.
- Rules tests for the new `Varied` fields, `generated.because` and
  `generated.only`.
- SDK tests: basis hashing (golden digests shared by the JavaScript and Rust
  implementations), the store's lookup and `generate`, and the runner's harvest,
  keep-first, eviction and `--regenerate`.
- Renderer harness and host browser specs for both presentations: the toggle
  swaps text without layout shift, word diff, the reason sentence, and the
  Generated mark on every generated field.
- A CLI compare test across a basis change, a `check` test that a reworded rerun
  from an equal basis passes, and the `pure` warning.

## Alternatives rejected

- **A separate `generated` list beside `volatile`.** It would duplicate
  pointers, kinds, the tighter-wins rule, `vary`, `check` and the hosts'
  variation filters. A generated value is exactly what volatile already means, a
  value that may differ between runs at one revision. Only the tolerance is new.
- **Judging text semantically** with similarity thresholds, embeddings or a
  model as judge in the comparator. Comparators are pure and deterministic, and
  run in browsers and on github.com without network. Any threshold would be
  arbitrary and unexplainable. The basis gives an exact answer the extractor
  controls.
- **Letting the engine compute the basis** from the item's evidence or source
  files. The engine can't know what the model read or what the prompt was. Only
  the extractor does.
- **One opaque hash.** It's enough for equality, but it can't say why a value
  regenerated, and neither a tolerance nor a rule can tell a model upgrade from
  an input change. Named parts cost a few bytes.
- **Letting rules demote model-only changes to `unchanged`.** That breaks "a
  comparator cannot hide a change", and two comparators would disagree about the
  same pair. The extractor decides what counts by what it puts in the basis.
- **A tolerance that ignores some basis parts**
  (`tolerance: {ignore: ["model"]}`). It would let an extraction say "the model
  is recorded but doesn't count", but the extractor already controls the basis:
  a part that shouldn't count is left out. One mechanism is simpler to explain,
  and nothing needs a recorded-but-ignored part yet.
- **Word-diffing equal-basis variation, or always showing both texts.**
  Rewording from the same inputs carries no information, and a diff of it is
  noise that looks like a change. One quiet toggle is enough for the curious.
- **An extractor-owned cache directory.** Extractors get no home directory, may
  run in read-only containers, and a writable shared cache would let repository
  code plant text in other revisions' extractions. A runner-owned store filled
  from validated extractions avoids all three, and makes CI artifacts a source
  with no new artifact format.
- **Relying on the extraction cache alone.** It reuses whole extractions keyed
  by tree, so any edit regenerates every value. Reuse per value is what keeps
  untouched classes' text identical.
- **The basis outside `data`**, as a new per-item field. That changes the item
  model for every extraction. A pointer into `data` reuses the `spread`
  machinery and keeps items as they are.

## Decided questions

The first draft left these open. The coordinator decided them before
implementation:

1. **No `tolerance.ignore`.** The extractor controls what goes in the basis. If
   a model change shouldn't count, it leaves the model out. Rules may classify
   and order changes only.
2. **The store is keyed by path and basis**, the declaration's path pattern and
   the basis digest, so two fields with equal bases never share a value.
   Regenerating a field whose path moved is an acceptable cost.
3. **No built-in renderer draws generated text yet.** It appears in detail cards
   and custom renderers.
4. **The icon is Lucide's `Sparkle`.**
5. **Regenerated values have their own count** in the summary bar, "N
   regenerated", separate from "varied within tolerance".
6. **Any JSON value may be generated.** Non-strings show as JSON, without a word
   diff.
7. **CI relies on extracting the base first in the same job.** The Action
   downloads no artifact by default and needs no `actions: read`.
8. **`check` warns when a `pure` definition produces generated values.**

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

Every addition is optional, so extractions, comparisons and requests without
generated values keep their bytes, their digests and their meaning.
