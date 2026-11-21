# Default comparator

The default comparator figures out what changed between two extractions. It
decides which items represent the same thing across revisions, marks each item
as added, removed, or modified, and puts the changes in a sensible order.

Every projection uses it unless its definition points to a comparator file—and
even then, a comparator file builds on top of the default comparator's result.
Because it knows nothing about your domain, it relies purely on IDs, explicit
renames, and the graph's structure.

## When to use it

Start with the default comparator on every projection. It requires zero
configuration and works with any extraction. As long as your IDs stay stable
across revisions and "added, removed, modified" tells reviewers what they need
to know, you don't need anything else.

Move to a comparator file when reviewers need a domain-specific verdict (such as
breaking vs. compatible, newly enforced, or higher risk), when renames and moves
can't be declared during extraction, or when you want to present the changes in
an order the graph's structure doesn't capture.

## How it decides

1. **Match by ID.** Items with the same ID on both sides are paired as `exact`.
   If their content differs, the pair is `modified`; otherwise it is unchanged.
2. **Match declared renames.** Remaining items are linked using the
   `previousIds` reported by the extraction, checked in both directions so
   swapping the two revisions produces the same match. Any `correspondence` map
   in the projection definition is applied as `previousIds` too. Each connected
   group becomes a single change: one-to-one is `declared` (a rename or move),
   one-to-many is a `split`, and many-to-one is a `merge`. Any other grouping
   produces an `ambiguous-correspondence` error.
3. **Classify everything else.** Any unmatched item is either `added` or
   `removed`.

When an entity is renamed, relationships pointing to it are compared across the
rename so that a simple rename doesn't falsely mark every connected relationship
as modified. Evidence, `previousIds`, and metadata never trigger a change on
their own. Fields marked
[volatile](../../contracts/extractions.md#volatile-data) by the extraction (such
as timings) only count as a change when they move outside their tolerance;
within tolerance, the pair stays `unchanged`, is listed with `varied`, and
doesn't appear in any step.

**How steps are ordered.** Connected changes travel together in one group, and
independent peers at the same depth change at the same time. Removals run from
the leaves inward and additions run from the roots outward, as mirror images, so
reversing a comparison cleanly reverses its steps.

To keep animations concise, removals and additions are each capped at five waves
(adjacent layers merge when needed to stay within that limit). Everything
else—modifications, renames, splits, merges, and relationship changes between
surviving items—forms a single restructure step in between. A relationship
leaves alongside the first of its departing endpoints and arrives with the last
of its arriving ones.

## Options

The default comparator has one option, which controls how steps are sorted
within each phase. Set it under `comparator` in your projection definition:

```json
"comparator": {"options": {"order": {"by": "dependents", "direction": "descending"}}}
```

<!-- generated: options -->

| Option            | Values                       | Required                   |
| ----------------- | ---------------------------- | -------------------------- |
| `order.by`        | `dependents` or `data.<key>` | Yes, when `order` is given |
| `order.direction` | `ascending`, `descending`    | No                         |

<!-- end generated: options -->

Set `order.by` to `dependents` to sort by how many relationships point at a
step's items (measured in the after extraction, or the before extraction for
removals), or to `data.<key>` to sort by a numeric `data` field such as
`data.size`. Each step is ranked by the largest value among its items, in
`descending` order by default. Ties preserve the default order, and steps
missing that value sort last.

## What a comparison shows

- **Change status** — `added`, `removed`, `modified`, or `unchanged` (unchanged
  items appear only when a rename or volatile variation makes them worth
  showing).
- **Correspondence** — `exact`, `declared`, `split`, or `merge`.
- **Ordered steps** — removals first, then a single restructure step, then
  additions, each tagged with its kind.
- **Counts without verdicts** — the default comparator doesn't add summaries,
  classifications, or custom summary-bar facts; the renderer's summary bar
  simply counts each kind and its changes. Domain verdicts like "breaking" or
  "newly enforced" come from a comparator file.

One comparison object drives every view—Side by side, Animated, Swipe, Diff,
table, and text—so they always agree.

## Start from this definition

You get the default comparator automatically whenever a definition doesn't name
a comparator file. To pass options, add a `comparator` object without `file`:

```json
{
  "id": "workspace-dependencies",
  "extractor": "workspace-dependencies",
  "renderer": "dependencies",
  "comparator": {"options": {"order": {"by": "dependents"}}}
}
```

## What a comparator file adds

Here is the same API change compared first with the default comparator and then
with the
[`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
comparator file, which classifies every change as breaking, additive, or
compatible:

![The API renderer with the default comparator: changes marked added, removed and modified](../../images/comparators/api-compatibility-default.png)

![The same change with the api-compatibility comparator: each change classified, breaking ones first](../../images/comparators/api-compatibility.png)

See [Custom comparators: what they make possible](../../guides/comparators.md)
for more side-by-side examples.

## Limitations

- **It takes IDs at face value.** If an extractor uses unstable IDs (such as an
  array index or a generated name), unchanged items will show up as removed and
  re-added. Fix this by emitting `previousIds`, adding a `correspondence` map in
  the definition, or writing identity passes in a comparator file.
- **It can't judge severity.** A harmless whitespace edit and a breaking change
  both show up as `modified`.
- **Ordering is structural.** Beyond what `order.by` can sort, steps follow the
  graph's shape rather than risk or domain priority.

## Related

- Built-in comparator files that ship with Projections:
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md),
  [`runtime-policy`](../../../packages/comparators/runtime-policy/README.md),
  and
  [`agentic-workflows`](../../../packages/comparators/agentic-workflows/README.md).
- [Comparisons](../../contracts/comparisons.md) — the contract every comparison
  follows, regardless of which comparator produced it.

## How it works

See the [package README](../../../packages/comparators/default/README.md) for
how the default comparator is built and sandboxed.

## Build your own

The default comparator tells you _that_ something changed, not what that change
means. Write a comparator file when:

- **Your domain defines what is breaking or risky.** Removing an export breaks
  callers, widening a selector broadens a security policy, and dropping a
  database column deserves a closer look. Custom rules let you classify each
  change and explain it in your team's terms.
- **Items move without keeping their IDs.** Identity passes let you pair items
  by a key you choose (like a symbol name in a new module or a relocated path)
  so a move reads as one change instead of a removal and an addition.
- **The review needs a different order.** You can rank steps by risk, owner, or
  priority, or regroup them altogether.
- **The summary bar should surface domain facts.** Summaries and metadata from a
  comparator flow to every renderer, the text view, and the JSON output, so "3
  breaking changes" stays consistent everywhere.

Before writing a full comparator file, check whether a lighter option works:
`order.by` can sort steps by dependents or a numeric field, and `correspondence`
in the projection definition handles known renames. When you do write a
comparator file, it layers on top of the default comparator rather than
replacing it, so you only declare what's different.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom comparator**,
and pick the built-in extractor it pairs with. VS Code scaffolds the definition,
a commented starter comparator file (`<id>.comparator.yaml`), and its tests
(`<id>.comparator.test.yaml`) under `.github/projections/<id>/`. You can also
choose **Ask an agent to write it** and describe what you want the comparison to
report.

**With the CLI**:

```sh
projections init <id> --extractor <extractor> --comparator custom
```

As you edit the comparator file, VS Code validates its CEL expressions live with
diagnostics, hovers, and completions. An open projection tab picks up your
uncommitted edits ("Your edits") and re-runs the comparison whenever you save.
You can run the comparator's tests and projection checks from the Testing view,
or from a terminal with `projections check -p <id>`.

To go deeper, see
[Write a custom comparator](../../guides/order-of-changes.md#write-a-custom-comparator)
for a walkthrough,
[Test a custom comparator](../../guides/order-of-changes.md#test-a-custom-comparator)
for testing, and [Custom comparators](../../design/declarative-comparators.md)
for the full reference.
