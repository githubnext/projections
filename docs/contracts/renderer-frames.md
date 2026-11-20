# Renderer frame protocol

Every renderer ships as a static bundle: a single self-contained `index.html`
and a `renderer.json` manifest
(`{"format": "projections.renderer", "version": 0, "name", "title", "handles"}`,
with optional `comparisonModes` and `accepts`). `accepts` declares which
extractions the renderer can display, with each entry naming a domain `schema`
and an optional `vocabulary` the extraction must declare (for example,
`[{"schema": "architecture/v0", "vocabulary": "dependency-injection/v0"}]`). If
`accepts` is omitted, the renderer accepts any extraction. Hosts never send a
renderer an extraction it doesn't accept—instead, they explain what the renderer
supports and fall back to the built-in renderer for that extraction or to the
table view. Renderers always receive every entity and relationship with `data`
populated (`{}` when omitted in the extraction).

Hosts load the bundle inside `<iframe sandbox="allow-scripts">` with an opaque
origin and a content security policy that grants no sources at all
(`connect-src 'none'`, `sandbox allow-scripts`). The URL fragment carries a
per-frame `channel` nonce, the host `origin`, and the host's `color` mode
(`light` or `dark`). To prevent an unthemed flash on first paint, hosts keep the
frame hidden until it acknowledges its first `rendered` message (or reports an
`error`). Before `init`, the renderer stays transparent and draws nothing; both
its root and the iframe element set `color-scheme: light dark` so the browser
never paints an opaque backdrop due to a scheme mismatch.

All communication uses `postMessage` envelopes shaped as
`{"projections": 0, "channel", "type", …}`. Hosts only accept messages from the
frame's window, from an opaque origin, and on the expected channel, and validate
every message strictly: a known type, no unknown fields, values in range, at
most 64 KiB, and at most 240 messages per second. The renderer initiates the
handshake by sending `ready`.

**Host to renderer messages:**

- `init` starts the frame with either `mode: "extraction"` and `extraction`, or
  `mode: "comparison"` with `before`, `after`, and `comparison`. It also
  includes `projection {id, title, renderer}`, `theme {colorMode, tokens}`,
  `reducedMotion`, `locale`, and optional `pane` (`before` or `after`) and
  `sizing` (`content` or `fill`).
- `progress` drives animated playback with `progress` (0–1), `highlighting`
  (0–1), and `direction` (±1).
- `select` sets the active selection to `id` or `null`, with an optional `path`
  naming a property of the item (an RFC 6901 pointer into its `data`).
- `options` passes `options {showRelationships?, …}` for the renderer's
  settings.
- `viewport` reports the frame's `width` and `height`.
- `environment` updates `theme`, `reducedMotion`, `locale`, and optional `pane`
  and `sizing`.
- `hover` * relays the hovered entity (`id` or `null`) from any pane.
- `scroll` * asks a container to scroll to `x`, `y` (CSS px), with an optional
  `key`, to mirror another pane.
- `action` notifies the renderer that someone triggered a declared `action`
  control (`id`).
- `filter` * carries `query`, `changesOnly`, and `ids` (the selection IDs
  matching the summary filter and find, so the renderer can dim the rest, or
  `null` when nothing is dimmed), plus an optional `scope` listing the IDs laid
  out in the Changes scope (older hosts sent the scope in `ids`).
- `annotations` * supplies
  `items [{id, count?, label?, tone?: "neutral" | "attention" | "done" | "subtle"}]`
  to draw markers on items, replacing any earlier set.
- `document` answers a `document-request` with `renderer` and either `html` or
  `error` (see nested renderers below).

**Renderer to host messages:**

- `ready` announces the frame is ready along with
  `capabilities {changeHighlighting: "supported" | "none", toggleableRelationships?, drawsRelationships?, ownTimeline?, hover?, anchors?, scrollSync?, filter?, context?, annotations?, properties?, controls?}`.
- `controls` replaces the declared `controls` list.
- `control` reports that someone changed a declared control from inside the
  renderer (`id`, `value`), which the host applies as a settings change.
- `rendered` confirms the frame painted a given `progress`.
- `select` reports a selection change (`id` or `null`, plus optional `path` for
  renderers declaring `properties`).
- `annotation` * fires when someone activates an item's annotation marker (`id`)
  after selecting it.
- `legend` sends an optional `title` and
  `items [{label, token? | color?, shape?: "square" | "circle" | "line" | "dashed" | "dotted"}]`
  so the host can draw a single shared legend outside the panes. `token` names a
  theme token and `color` is a plain CSS color; hosts that can't draw a `dotted`
  line draw it `dashed`, and an empty list clears the legend.
- `summary` provides `items` for the host's summary bar (described below)—each
  either a count
  `{type?: "count", collection?: "entities" | "relationships", kind, noun {singular, plural}, count, added?, removed?, modified?}`
  or a fact
  `{type: "fact", id, icon?, count, noun {singular, plural}, tone?: "added" | "removed" | "modified" | "neutral", ids?, added?, removed?, modified?, description?}`.
  Sending no items hands wording back to the host.
- `height` reports the content height in `px`.
- `steps` reports `ends` (increasing progress stops where the host can pause)
  and optional `slots` (the number of step slots the presentation spans, used to
  compute the default pace).
- `open` asks the host to open `path` at an optional `line`; the host decides
  whether to navigate.
- `error` reports a fatal `message`.
- `hover` * reports the entity under the pointer or focus (`id` or `null`).
- `anchor` * reports an item's `id` and `rect {x, y, width, height}` in the
  frame's viewport (CSS px), or `null` if it isn't visible.
- `viewport` * reports that someone scrolled a container to `x`, `y` (with
  optional `key`).
- `document-request` asks the host for a built-in `renderer` document by name
  (or a name its bundle handles, like `dag`, matching
  `^[a-z0-9][a-z0-9-]{0,63}$`) to run nested (see below).

**Nested renderers.** A renderer can embed another renderer inside itself—for
instance, `gallery` renders each fixture scenario with the renderer that
scenario names. To do this, the outer renderer sends `document-request` with a
**built-in** renderer name, and the host replies with `document`, carrying
either `html` (the bundle's `index.html` exactly as the host would load it into
its own frame, including editor webview script nonces) or an `error` explaining
why it couldn't supply one. The host only looks up names in its built-in
registry—never URLs or paths—and rejects custom renderers, unknown names, or all
requests if it doesn't serve nested documents. Invalid renderer names are
dropped. The outer renderer loads the returned HTML in
`<iframe sandbox="allow-scripts" srcdoc>` and speaks this same frame protocol as
its host (the SDK's `embedRenderer` handles both). Because a `srcdoc` frame
inherits the outer frame's CSP and receives its own opaque origin, a nested
renderer cannot access anything the outer one cannot; its URL fragment is set
from inside the document before it connects. Since built-in renderers are
Projections' own code and only receive data the outer renderer already has,
nesting them introduces no new trust requirement.

**Summary bar.** Hosts render a compact summary bar across every projection
view, whether showing a single revision (`12 workspaces · 18 dependencies`) or a
comparison (`12 workspaces +1 −1 · 18 dependencies +2`). Clicking any figure
filters the view to those items, just like "changes only". Renderers control the
bar's vocabulary through an optional `summary` message listing figures in
display order, each with a `type`:

- `count` (the default when `type` is omitted, and always sent by the kit)
  displays a kind the renderer wants highlighted (`kind`, plus `collection` if
  an entity kind and a relationship kind share a name) along with a `noun` for
  singular and plural counts. `count` is the total in the extraction (or in
  `after` for a comparison), while `added`, `removed`, and `modified` tally
  comparison changes of that status whose item has that kind (using the `after`
  item for additions and modifications, and the `before` item for removals),
  omitted when zero or for a single extraction. The prior total ("was N") is
  derived as `count − added + removed`, so it is never sent. Hosts compute their
  own counts for the named kinds, and the renderer checks verify that the
  renderer's numbers match.
- `fact` highlights a domain finding that no kind count captures
  (`2 breaking changes`, `1 newly enforced`, `3 to replace`,
  `18 major upgrades`) or a measure that isn't a kind (`39,882 lines of code`).
  It has a stable `id`, an optional `icon` (a theme icon token name matching
  `^[a-z][a-z0-9-]{0,63}$`, drawn via `--projections-icon-<name>`), its `count`
  and `noun` (singular for 1), an optional `tone` that colors only the figure,
  and optional `ids` (at most `rendererLimits.summaryFactIds` entity,
  relationship, or comparison change IDs) so clicking it filters to those items.
  In a comparison, optional `added`, `removed`, and `modified` show how that
  fact changed, rendered in change colors just like a count—either how many
  counted items arrived, left, or changed, or for a per-revision measure its net
  delta (`added` for growth, `removed` for shrinkage), preserving
  `count − added + removed` as the previous value
  (`39,882 lines of code +2,056`, `1 enforcing rule +1`). Those delta numbers
  don't act as filters. An optional `description` (up to
  `rendererLimits.summaryDescription` characters) provides a one-sentence
  tooltip and accessible description, such as the rules behind the
  classification. Hosts render facts as sent—with muted icon and text unless
  `tone` is set, and badge icons (`badgeIconNames`) on their disc as in a frame
  (`iconMaskStyle`). Renderer checks verify each fact's shape, confirm its `ids`
  exist, ensure single-extraction facts carry no changes, and check that added
  or modified counts don't exceed `count`.

The summary represents the entire document rather than a single pane or
animation timestamp: renderers emit the same summary at every progress value,
and in side-by-side mode the host uses the after pane's summary. Renderers
should not draw their own summary or statistics bar—anything they would count
belongs in the host's bar so it stays consistent across the renderer, table, and
text views (where the text view opens with the bar's sentence). Visual keys
(color or line-style legends), notices about what's on screen
(`Showing 24 of 30`), and per-item badges still belong in the drawing.

To keep future types additive, hosts drop any summary item whose `type` they
don't recognize and keep the rest; any other invalid item rejects the entire
message. Renderers that don't send `summary` (such as older v0 bundles) still
get a summary bar, with the host generating labels from each kind name
(`depends-on` → dependencies, `devDependencies` → dev dependencies, `workspace`
→ workspaces). A summary may contain at most `rendererLimits.summaryItems`
figures, naming each count `kind` once per collection and each fact `id` once,
with nouns up to `summaryNoun` characters.

**Theme tokens.** `theme` has the shape `{colorMode, version, tokens}`. Token
set 0 (`version: 0`) defines surfaces, text, borders, accent and focus colors,
change colors for added, removed, modified, and moved (each with muted,
highlight, and emphasis variants), a neutral highlight, a 16-color categorical
palette whose first eight hues stay distinct from change colors, and scales for
typography, spacing, radii, borders, shadows, control heights, focus rings, and
labels. Every token ships with both light and dark defaults so renderers can
depend on all of them. See the
[renderer SDK](../guides/renderer-sdk.md#theme-tokens) for the complete token
list.

**Controls.** Renderers declare custom settings controls (`choice`, `toggle`,
`range`, `action`) in `capabilities.controls` or later via a `controls` message.
The host renders them using its own design system, forwards their current values
in `options` keyed by control `id`, and sends `action` for one-shot triggers.
Control declarations are validated strictly and rejected as a whole if invalid.
If interaction inside the renderer also updates a control (for example, clicking
a sortable column header to change the sort), the renderer posts `control` with
the `id` and new value. The host applies it just like a change made in its own
menu—persisting it, updating the UI, notifying its embedder, ignoring
out-of-range values, and sending back the updated `options`.

\* Messages marked with an asterisk are capability-gated. Hosts send `hover`,
`scroll`, `filter`, and `annotations` only to renderers declaring `hover`,
`scrollSync`, `filter`, and `annotations`, respectively. Likewise, renderers
send `anchor` only when declaring `anchors` (for selected, hovered, and
annotated items) and `annotation` only when declaring `annotations`. Without
these capabilities, comparison modes still share selection and simply skip hover
sync, connectors, and scroll mirroring. Hosts include a comparison's change
`context` in `init` only for renderers declaring `context`, stripping it for
others that may validate against an older closed schema. Selection and hover IDs
are always comparison row IDs—either a change's ID or an unchanged item's own
ID—so the same entity shares one ID across before and after frames, while items
present in only one revision have no counterpart. A scroll `key` is the scrolled
element's `data-projections-scroll` value or a structural path, and is omitted
for the document itself.

**Targets.** Hosts convert between selection IDs and
_targets_—`{kind: "entity" | "relationship", id, side: "before" | "after", path?}`—which
address extraction items (and optionally a property) by their own identity on
one side of a comparison rather than by change or row IDs. A single row can map
to different items on each side: several items for a rename, split, or merge;
only `before` for a removal; and only `after` for an addition. Single-revision
extractions only have `after`. Targets make it straightforward for embedders to
attach data like comments to specific items (see the
[guide](../guides/embedding.md#building-commenting-on-projections)).

**Host settings** are shared across every projection: change highlighting
(`animated`, which fades with progress to zero at both endpoints, `on`, or
`off`), "changes only", "varied only", "regenerated only", find, renderer
selection among compatible bundles, playback speed, and comparison mode. Hosts
pass find, "changes only", "varied only", and "regenerated only" down to
renderers via `filter` ("varied only" passes the IDs of items that varied within
tolerance, and "regenerated only" passes the IDs of items whose generated values
were reworded from an equal basis, both with `changesOnly` set to false).
**Renderer settings** are the controls declared by the renderer itself. A
definition's `presentation` block supplies initial values for both.

**Volatile variation** is always shown neutrally. Renderers receive each
change's `varied` array alongside the comparison. An item that varied only
within tolerance (`unchanged` with `varied`) must render identically to an
unchanged item—no emphasis, status badge, or motion at any progress value or in
diff mode (enforced by the `highlight-scope` and `diff-neutral` checks). A
`modified` change with a `varied` value beyond tolerance displays the `varied`
icon token beside its status in a neutral color, labelled "Volatile field
changed beyond tolerance". Hosts surface unchanged items with non-generated
volatile variation via a neutral "N varied within tolerance" toggle for "varied
only", and in the detail view list each varied path with its values and either
"within tolerance" or "beyond tolerance (volatile)".

**Generated values** are also presented neutrally and clearly labelled. Every
[generated](extractions.md#generated-values) field carries a muted **Generated**
mark (the `generated` icon alongside the label) so readers never confuse it with
an extracted fact. A change whose generated values were reworded from an equal
basis stays `unchanged` and renders as unchanged; hosts surface these via a
neutral "N regenerated" toggle for "regenerated only" (passed to renderers as
filter IDs just like "varied only"). Its detail card displays the After text
with the `varied` icon, "Regenerated from the same inputs", and a toggle to view
Before's wording—never a word diff. When the basis actually moved, the card
explains why ("Regenerated because the input changed", showing verbatim parts
like a model ID with their old and new values) and shows both passages side by
side with a word-diff toggle for strings (non-string values display as JSON). A
generated value beyond its basis does not show a volatile marker. Toggles swap
layers inside a single grid cell to avoid layout shifts, and the basis itself is
surfaced only through its value rather than listed as a separate field.

**Comparison modes** are managed by the host:

- **Animated** renders a single frame driven by `progress`.
- **Side by side** renders a before frame (`progress` 0) and an after frame
  (`progress` 1), both with `highlighting` 1 when change highlighting is on.
  Both frames receive the host's `select` and `hover` messages so the selected
  item is styled in both. If the selected item is off-screen in the opposite
  frame, that frame scrolls it into view (without mirroring that scroll back)
  and briefly pulses it (`data-projections-pulse`, skipped under reduced
  motion). Annotations appear in both frames. Hosts do not draw a connector or
  offer a connector toggle by default, though a host that opts in (`connector`)
  draws one between the selected entity's anchors across the two frames.
- **Swipe** overlays the same before and after frames behind a draggable divider
  and mirrors each frame's `viewport` scroll to the other via `scroll`.
- **Diff** renders a single frame whose `init` includes
  `comparisonMode: 'diff'`, letting the renderer draw its own static comparison
  of `before` and `after`. The host sends no `progress` and hides playback and
  swipe controls, except for sending
  `{progress: 1, highlighting: 0, direction: 1}` when highlighting is switched
  off (and `highlighting: 1` when turned back on).

Renderers declare their supported modes in `capabilities.comparisonModes` and
`renderer.json`; if omitted, hosts assume `side-by-side`, `animated`, and
`swipe`. Hosts list modes in a fixed order—diff, side by side, animated,
swipe—and open in the first supported mode in that order (diff whenever
supported, otherwise side by side), preserving the user's chosen mode whenever
the renderer supports it. Hosts only offer modes the renderer declares, falling
back to the default if a chosen mode or `presentation.mode` is unsupported,
including when switching renderers.

The [renderer SDK](../../packages/renderers/sdk/README.md) implements the
renderer side of this protocol.
