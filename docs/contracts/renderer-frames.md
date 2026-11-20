# Renderer frame protocol

Renderers are static bundles: one self-contained `index.html` and a
`renderer.json` manifest
(`{"format": "projections.renderer", "version": 0, "name", "title", "handles"}`,
and optionally `comparisonModes` and `accepts`). `accepts` lists the extractions
the renderer presents, each a domain `schema` and optionally a `vocabulary` the
extraction must declare (for example
`[{"schema": "architecture/v0", "vocabulary": "dependency-injection/v0"}]`);
without it, a renderer accepts any extraction. Hosts don't give a renderer an
extraction it doesn't accept: they say what it presents and show the built-in
renderer for the extraction, or the table, instead. Renderers receive every
entity and relationship with `data` (`{}` when the extraction omits it). Hosts
load the document into `<iframe sandbox="allow-scripts">`, an opaque origin.
They serve it with a content security policy that grants no source at all
(`connect-src 'none'`, `sandbox allow-scripts`). The URL fragment carries a
per-frame `channel` nonce, the host `origin` and the host's `color` mode
(`light` or `dark`). Hosts keep a frame invisible until it acknowledges its
first `rendered` (or reports an `error`), so a document's unthemed first paint
never shows. Before `init` a renderer document stays transparent and draws
nothing; its root and the frame element both use `color-scheme: light dark`, so
browsers never paint an opaque backdrop for a scheme mismatch. Every message is
`{"projections": 0, "channel", "type", …}` sent with `postMessage`. Hosts accept
a message only from the frame's window, from an opaque origin and on its
channel. It must also validate strictly: a known type, no unknown fields, values
in range, at most 64 KiB, at most 240 per second. The renderer speaks first with
`ready`.

- `init`: `mode: "extraction"` with `extraction`, or `mode: "comparison"` with
  `before`, `after`, `comparison`; plus `projection {id, title, renderer}`,
  `theme {colorMode, tokens}`, `reducedMotion`, `locale`, optional `pane`
  (`before` or `after`) and `sizing` (`content` or `fill`)
- `progress`: `progress` 0–1, `highlighting` 0–1, `direction` ±1
- `select`: `id` or `null`, optional `path`: a property of the item (RFC 6901
  pointer into its `data`)
- `options`: `options {showRelationships?, …}`
- `viewport`: `width`, `height`
- `environment`: `theme`, `reducedMotion`, `locale`, optional `pane` and
  `sizing`
- `hover` *: `id` or `null`, the entity pointed at in any pane
- `scroll` *: `x`, `y` (CSS px), optional `key`: scroll a container to mirror
  another pane
- `action`: `id`: the person activated a declared `action` control
- `filter` *: `query`, `changesOnly`, `ids`: the matching selection IDs, or
  `null` when nothing is filtered
- `annotations` *:
  `items [{id, count?, label?, tone?: "neutral" | "attention" | "done" | "subtle"}]`:
  markers to draw on items, replacing earlier ones
- `document`: `renderer` and either `html` or `error`: the answer to a
  `document-request` (see nested renderers, below)

- `ready`:
  `capabilities {changeHighlighting: "supported" | "none", toggleableRelationships?, drawsRelationships?, ownTimeline?, hover?, anchors?, scrollSync?, filter?, context?, annotations?, properties?, controls?}`
- `controls`: `controls`: replaces the declared controls
- `rendered`: `progress` whose frame was painted
- `select`: `id` or `null`, optional `path` (renderers declaring `properties`)
- `annotation` *: `id`: the person activated the item's annotation marker (after
  selecting it)
- `legend`: optional `title`,
  `items [{label, token? | color?, shape?: "square" | "circle" | "line" | "dashed" | "dotted"}]`:
  the host draws the legend once outside the panes; `token` names a theme token,
  `color` is a plain CSS color; a host that can't draw a `dotted` line draws it
  `dashed`; no items clears it
- `summary`: `items`, each a count
  `{type?: "count", collection?: "entities" | "relationships", kind, noun {singular, plural}, count, added?, removed?, modified?}`
  or a fact
  `{type: "fact", id, icon?, count, noun {singular, plural}, tone?: "added" | "removed" | "modified" | "neutral", ids?, added?, removed?, modified?, description?}`:
  the renderer's figures for the host's summary bar (see below); no items
  returns the bar to the host's own words
- `height`: `px`
- `steps`: `ends`, increasing progress values where the host may hold, and
  optional `slots`, the step slots the presentation spans, for the default pace
- `open`: `path`, optional `line`; the host decides whether to navigate
- `error`: `message`
- `hover` *: `id` or `null`, the entity under the pointer or focus
- `anchor` *: `id` and `rect {x, y, width, height}` in the frame's viewport (CSS
  px), or `null` when it isn't visible
- `viewport` *: `x`, `y`, optional `key`: the person scrolled a container
- `document-request`: `renderer`, a built-in renderer's name (or a name its
  bundle handles, such as `dag`) (`^[a-z0-9][a-z0-9-]{0,63}$`): asks for its
  document to run nested (see nested renderers, below)

**Nested renderers.** A renderer may present another renderer's view inside its
own, as the `gallery` renderer presents each fixture scenario with the renderer
it names. It asks the host for a **built-in** renderer's document by name with
`document-request`, and the host answers with `document`: `html`, the bundle's
`index.html` exactly as the host would load it into a frame of its own (an
editor webview's script nonces included), or `error`, why it supplies none. The
host looks the name up in its own registry of built-in renderers and never takes
a URL or path; it refuses a custom renderer, an unknown name and, when it
supplies no documents at all, every request, saying so. A request whose name
isn't a renderer name is invalid and dropped. The renderer runs the document in
`<iframe sandbox="allow-scripts" srcdoc>` and acts as its host, speaking this
protocol with it; the SDK's `embedRenderer` does both. A `srcdoc` document
inherits the nesting renderer's content security policy and gets an opaque
origin of its own, so a nested renderer can reach nothing the nesting one can't;
its URL fragment is set from inside the document, before the renderer connects.
Built-in renderers are Projections' own code, so this adds nothing that needs
trust: the nesting renderer only passes on data it was given.

**Summary bar.** Hosts draw a thin summary bar along every projection view, for
one revision and for a comparison: a figure per extraction kind,
`12 workspaces · 18 dependencies`, and in a comparison the changes of each,
`12 workspaces +1 −1 · 18 dependencies +2`. Clicking a figure filters to those
items, as "changes only" does. The vocabulary is the renderer's: an optional
`summary` message lists its figures in display order, each a `type`:

- `count` (the default when `type` is absent; the kit always sends it): names a
  kind the renderer wants shown (`kind`, and `collection` when an entity kind
  and a relationship kind share a name) with a `noun` for one item and for any
  other count. `count` is the kind's total in the extraction, or in `after` for
  a comparison; `added`, `removed` and `modified` count the comparison's changes
  of that status whose item has the kind (an added or modified change by its
  `after` item, a removed one by its `before` item), omitted when zero and for
  one extraction. The previous total ("was N") is `count − added + removed`, so
  it is never sent. Hosts show their own counts of the named kinds; the renderer
  checks hold a renderer to the same counts.
- `fact`: a finding of the renderer's domain that no kind count says
  (`2 breaking changes`, `1 newly enforced`, `3 to replace`,
  `18 major upgrades`), or a measure that isn't a kind (`39,882 lines of code`),
  with a stable `id`, an optional `icon` (a theme icon token name,
  `^[a-z][a-z0-9-]{0,63}$`, drawn from `--projections-icon-<name>`; none without
  it), its `count` and `noun` (singular for 1), an optional `tone` that colors
  the figure only, and optional `ids` (at most `rendererLimits.summaryFactIds`
  entity or relationship IDs, or comparison change IDs) that make it a filter to
  those items. In a comparison, optional `added`, `removed` and `modified` are
  its changes, which hosts draw after it in the change colors as they draw a
  count's: how many of the things it counts arrived, left or changed, or for a
  measure of each revision its net change (`added` when it grew, `removed` when
  it shrank), so the previous value is `count − added + removed` as for a count
  (`39,882 lines of code +2,056`, `1 enforcing rule +1`). They don't filter. An
  optional `description` (at most `rendererLimits.summaryDescription`
  characters) is one sentence of context hosts show as its tooltip and
  accessible description, such as the rules that classified it. Hosts show a
  fact as sent, its icon and words muted unless it has a `tone`, a badge icon
  (`badgeIconNames`) on its disc as in a frame (`iconMaskStyle`); the renderer
  checks verify its shape, that its `ids` exist, that one extraction's facts
  have no changes, and that what it counts as added or modified is part of its
  count.

The summary describes the whole document, not a pane or a progress: renderers
send the same one at every progress, and in side by side the host takes the
after pane's. Renderers draw no summary or statistics line of their own: what
they would count goes in the bar, which is the same under the renderer, table
and text views (the text view opens with the bar's sentence). Keys to a drawing
(a legend of colors or line styles), notices about what is drawn
(`Showing 24 of 30`) and per-item statuses stay with the drawing.

Hosts drop an item of a `type` they don't know and keep the rest, so later types
are additive; any other invalid item refuses the whole message. A renderer that
sends no `summary`, such as a version 0 bundle written before it existed, still
gets the bar: the host words every kind from its name (`depends-on` →
dependencies, `devDependencies` → dev dependencies, `workspace` → workspaces).
At most `rendererLimits.summaryItems` figures, each count `kind` named once per
collection and each fact `id` once, nouns at most `summaryNoun` characters.

**Theme tokens.** `theme` is `{colorMode, version, tokens}`. Token set 0
(`version: 0`) defines surfaces, text, borders, accent and focus colors, change
colors for added, removed, modified and moved (each with muted, highlight and
emphasis variants), a neutral highlight, a 16-color categorical palette whose
first eight colors avoid the change hues, and scales for type, spacing, radii,
borders, shadows, control heights, focus ring and labels. Every token has a
light and dark default, so a renderer can rely on all of them. The
[renderer SDK](../guides/renderer-sdk.md#theme-tokens) lists them.

**Controls.** Renderers declare settings controls (`choice`, `toggle`, `range`,
`action`) in `capabilities.controls` or a later `controls` message. The host
draws them with its own design system, sends their values in `options` under
each control's `id`, and sends `action` for one-shot actions. Declarations are
validated strictly and dropped as a whole when invalid.

\* Optional. A host sends `hover` only to renderers declaring the `hover`
capability, `scroll` only to renderers declaring `scrollSync`, and `filter` only
to renderers declaring `filter`, and `annotations` only to renderers declaring
`annotations`. Renderers send `anchor` only when they declare `anchors` (for the
selected, hovered and annotated items), and `annotation` only when they declare
`annotations`. Without these capabilities, comparison modes still share
selection and simply omit hover sync, the connector and scroll mirroring. A host
sends a comparison's change `context` (in `init`) only to renderers declaring
`context`, and strips it for others, which may check comparisons against an
older, closed schema. Selection and hover IDs are comparison row IDs: a change's
ID, or an unchanged item's own ID. The same entity therefore has the same ID in
the before and after frames, and an item present in only one revision has no
counterpart. A scroll `key` is the scrolled element's `data-projections-scroll`
value or a structural path; it is omitted for the document.

**Targets.** Hosts translate selection IDs to and from _targets_,
`{kind: "entity" | "relationship", id, side: "before" | "after", path?}`, which
name extraction items (and optionally a property) by their own identity on one
side of a comparison, never by change or row IDs. A row stands for its items on
each side: a renamed, split or merged row for several, a removed item only
`before`, an added one only `after`. A single extraction has only `after`.
Targets let embedders attach their own data, such as comments, to items; the
[guide](../guides/embedding.md#building-commenting-on-projections) shows how.

**Host settings** are the same for every projection. They are change
highlighting (`animated` fades with progress to zero at both endpoints, `on`,
`off`), "changes only", "varied only", "regenerated only", find, the renderer
chosen among compatible bundles, playback speed and the comparison mode. Hosts
send find, "changes only", "varied only" and "regenerated only" to renderers as
`filter` ("varied only" as the IDs of the items that varied within tolerance,
"regenerated only" as those of the items whose generated values were reworded
from an equal basis, with `changesOnly` false). **Renderer settings** are the
controls a renderer declares. A definition's `presentation` block gives both
their initial values.

**Volatile variation** is presented neutrally. Renderers receive each change's
`varied` with the comparison. An item that varied only within tolerance
(`unchanged` with `varied`) is drawn exactly as an unchanged item: no emphasis,
status or motion, at every progress and in the diff (the `highlight-scope` and
`diff-neutral` checks hold it). A `modified` change with a `varied` value beyond
tolerance carries the `varied` icon token beside its status, in a neutral color
and named "Volatile field changed beyond tolerance". Hosts show the unchanged
changes with a volatile value other than a generated one as a neutral "N varied
within tolerance" toggle for "varied only", and list a selected change's varied
paths with their values and "within tolerance" or "beyond tolerance (volatile)"
in their details.

**Generated values** are presented neutrally too, and always labelled. Every
[generated](extractions.md#generated-values) field carries a quiet **Generated**
mark (the `generated` icon and the word, muted), so it is never mistaken for an
extracted fact. A change whose generated values were reworded from an equal
basis is `unchanged` and drawn as such; hosts count these on their own, as a
neutral "N regenerated" toggle for "regenerated only" (sent to renderers as
filter IDs like "varied only"), and the detail card shows After's text with the
`varied` icon, "Regenerated from the same inputs" and a toggle for Before's
wording, never a word diff. A value whose basis moved shows why ("Regenerated
because the input changed", a verbatim part such as a model ID with its old and
new values) and both passages side by side, with a toggle for a word diff of
strings; a value that isn't a string shows as JSON. A generated value beyond its
basis is no volatile marker. Toggles swap layers of one grid cell, so they never
shift layout. The basis is judged through its value and isn't listed as a field.

**Comparison modes** are host-owned:

- **Animated** shows one frame driven by `progress`.
- **Side by side** shows a before frame (`progress` 0) and an after frame
  (`progress` 1), each with `highlighting` 1 when change highlighting is on.
  Both frames get the host's `select` and `hover`, so the selected item is
  styled in both, and the frame the selection didn't come from scrolls it into
  view if it's scrolled out (without mirroring that scroll back) and briefly
  pulses it (`data-projections-pulse`; never under reduced motion). Annotations
  show in both frames. Hosts draw no connector and offer no toggle for one by
  default; a host that opts in (`connector`) draws one from the selected
  entity's anchor in one frame to its anchor in the other.
- **Swipe** stacks the same two frames behind a divider, and mirrors each
  frame's `viewport` to the other as `scroll`.
- **Diff** shows one frame whose `init` has `comparisonMode: 'diff'`; the
  renderer draws its own static comparison of `before` and `after`. The host
  sends no `progress` and offers no playback or swipe, except one
  `{progress: 1, highlighting: 0, direction: 1}` when highlighting is turned off
  (and `highlighting: 1` when it is turned back on).

Renderers declare which modes they support as `capabilities.comparisonModes` and
in `renderer.json`; without a declaration they support `side-by-side`,
`animated` and `swipe`. Hosts show them in a canonical order (diff, side by
side, animated, swipe) and open in the first supported mode in that order: diff
whenever it is supported, else side by side; a user's chosen mode is kept when
the renderer supports it. Hosts offer only those modes, and fall back to the
default when a chosen mode (or a definition's `presentation.mode`) isn't
supported, including after switching renderers.

The [renderer SDK](../../packages/renderers/sdk/README.md) implements the
renderer side.
