# Renderer SDK guide

This guide walks through the
[renderer SDK](../../packages/renderers/sdk/README.md) from a renderer's point
of view: the frame protocol it speaks with the host, and the theme tokens and
icons the host provides.

## Protocol

The protocol is currently version 0. The host loads your renderer's `index.html`
inside an opaque-origin `<iframe sandbox="allow-scripts">` served with
`rendererContentSecurityPolicy` (`connect-src 'none'` and
`sandbox allow-scripts`). The URL fragment passes `channel` (a fresh random
nonce per frame), the host `origin`, and the host's `color` mode.

Because the host keeps the frame hidden until your renderer posts its first
`rendered` (or `error`) message, do not draw anything before `init` arrives.
`rendererConfig` generates a document whose root uses `color-scheme: light dark`
with a transparent background, while the body picks up the fragment's color mode
until `applyEnvironment` applies the full theme (setting `color-scheme` on the
body and leaving the root at `light dark`). Every protocol message is a plain
object `{projections: 0, channel, type, ...payload}` sent over `postMessage`.

Your renderer speaks first, posting `ready` as soon as its message listener is
attached. The host answers with `init`, followed by `options`, `select`,
`viewport`, and `progress` as needed. Messages for `hover`, `scroll`, `filter`,
and `annotations` are only sent if your renderer declares the corresponding
capability. A host can also mount two frames of the same bundle side by side
(one held at progress 0, the other at 1), keeping selection, hover, and
scrolling synchronized between them.

**Host-to-renderer messages:**

- `init` delivers either `mode: 'extraction'` with `extraction`, or
  `mode: 'comparison'` with `before`, `after`, `comparison`, and an optional
  `comparisonMode` (see [Comparison modes](#comparison-modes)). It also carries
  `projection {id, title, renderer}` (where `renderer` is the definition's
  renderer name or a custom bundle path, letting multi-purpose bundles pick a
  variant), `theme {colorMode, tokens}`, `reducedMotion`, `locale`, and optional
  `pane` and `sizing`.
- `progress` carries `progress` (0..1), `highlighting` (0..1, always 0 at both
  endpoints), and `direction` (1 or -1).
- `select` carries `id` (or `null`) and an optional `path` pointing to a
  selected item or one of its properties.
- `options` passes `options: {showRelationships?, …}`.
- `viewport` reports `width` and `height`.
- `environment` updates `theme`, `reducedMotion`, `locale`, and `pane` whenever
  they change after `init`. `pane` (`before` or `after`) is set when the frame
  is a held pane in side-by-side or swipe mode; since the host labels that
  revision in a banner above the pane, omit transition narration such as step
  captions. `applyEnvironment` reflects it as `data-pane` on the document
  element, and the kit passes it as `pane`. `sizing` tells you how the host
  sizes the frame: `content` means it adopts the height you report via `height`,
  while `fill` means the host controls the height (for example in a tab or
  pane). In a `content` frame, fit your layout to the width on the first paint
  rather than relying on the initial frame height; when `sizing` is omitted, fit
  both dimensions. The kit exposes this via `useFrameSizing()`.
- `action` carries the `id` of a triggered `action` control.
- `filter` (capability `filter`) carries `query`, `changesOnly`, `ids` (matching
  selection IDs, or `null`), and `scope` (what to lay out in Changes scope). Lay
  out `scope`, and visually recede anything excluded by `ids` without removing
  or reflowing it.
- `hover` (capability `hover`) carries `id` or `null` for the entity currently
  pointed at in any pane.
- `scroll` (capability `scrollSync`) carries `x` and `y` (CSS px, ≥ 0) and an
  optional `key` to mirror scrolling from another pane.
- `annotations` (capability `annotations`) carries `items` of
  `{id, count?, label?, tone?}` markers to display on items, replacing any
  previous set.

**Renderer-to-host messages:**

- `ready` declares
  `capabilities {changeHighlighting: 'supported' | 'none', toggleableRelationships?, drawsRelationships?, ownTimeline?, hover?, anchors?, scrollSync?, filter?, context?, annotations?, properties?, comparisonModes?, pace?, controls?}`
  (where the optional flags are booleans).
- `rendered` acknowledges that the frame for `progress` has been painted.
- `select` reports `id` or `null` plus an optional `path` (only valid when `id`
  is set) when the user selects an item or property.
- `height` reports desired content height in `px` (clamped by the host to
  120–20,000).
- `aspect` optionally reports `ratio` (width / height of the stage-fitted
  content across the whole transition, 0.01–100) so hosts can stack wide
  side-by-side panes vertically; the kit's `useFitScale` sends this
  automatically.
- `steps` reports `ends` (increasing progress values in 0..1 where playback can
  hold) and optional `slots` (total step slots including reading time,
  `timelineSlots`) so the host can compute default playback pacing.
- `open` requests navigation to `path` and an optional `line` (the host decides
  whether to act on it).
- `error` reports a fatal `message`.
- `hover` reports a non-empty `id` or `null` for the hovered or focused entity.
- `anchor` reports `id` and `rect {x, y, width, height}` (in frame viewport CSS
  px) or `null` when hidden, so the host can draw cross-pane connectors and
  anchored overlays for selected, hovered, or annotated items.
- `viewport` reports `x` and `y` (CSS px, ≥ 0) plus an optional `key` when the
  user scrolls a container.
- `controls` sends `controls` to replace the renderer's declared controls (see
  [Controls](../../packages/renderers/sdk/README.md#controls)).
- `control` reports `id` and `value` when the user adjusts a declared control
  directly inside the renderer (such as clicking a sortable column header). Post
  it via `client.setControl(id, value)`; the host updates its state and replies
  with `options`.
- `annotation` reports a non-empty `id` when the user activates an item's
  annotation marker (after selecting the item).
- `legend` sends an optional `title` and
  `items [{label, token? | color?, shape?}]` (up to `rendererLimits.legendItems`
  entries and `legendLabel` characters per label) so the host draws a single
  legend beside the frames. Post it with `client.legend(...)`, which throws on
  invalid input.
- `summary` sends `items` in display order—counts of
  `{type?: 'count', collection?, kind, noun {singular, plural}, count, added?, removed?, modified?}`
  and facts of
  `{type: 'fact', id, icon?, count, noun, tone?, ids?, added?, removed?, modified?, description?}`
  (up to `rendererLimits.summaryItems` entries and `summaryNoun` characters per
  noun)—for the host's summary bar (see [Summary bar](#summary-bar)). Post it
  with `client.summary(...)`, which throws on invalid input. If you omit it, the
  host derives labels from the raw kind names.

### Summary bar

Every projection view includes a slim summary bar along the bottom, showing one
count per extraction kind (`12 workspaces · 18 dependencies`) and, in
comparisons, color-coded deltas (`12 workspaces +1 −1 · 18 dependencies +2`).
Clicking any figure filters the view to those items.

Your renderer owns the wording. Send a `summary` message listing each kind in
the order you want it displayed, with singular and plural forms in `noun`. The
`/presentation` helper `summaryItems(init, nouns)` builds these figures for you
from an `InitPayload` (or host subject). Pass `nouns` as
`{kind: {singular, plural}}`—use `false` to hide a kind, or prefix with
`relationships:kind` or `entities:kind` to target one collection. Listed kinds
appear first, and any remaining kinds fall back to `humanizeKind`:

```ts
client.summary({items: summaryItems(init, {package: {singular: 'workspace', plural: 'workspaces'}, resolved: false})})
```

A projection definition can also supply its own kind names and colors via
`presentation.kinds` (see [definitions](../contracts/definitions.md)), which the
host forwards as `init.projection.kinds` (`{kind: {color?, noun?}}`). Definition
nouns should take precedence over yours—kit renderers handle this automatically
via `rendererSummary`. `humanizeKind` leaves adjective kinds unpluralized
(`24 hidden`, `5 not patchable`) and preserves hyphenated prefixes
(`6 pre-releases`).

Every summary item has a `type`. A count (`type: 'count'`, the default emitted
by `summaryItems`) reports a kind's `count` (its total in `after` for a
comparison) along with `added`, `removed`, and `modified` counts
(`summaryCounts`). The prior total ("was N") is computed as
`count − added + removed`, so you never send it; hosts cross-check your counts
against their own, and the renderer checks enforce the same numbers.

A fact (`type: 'fact'`) captures a domain finding or metric that no single kind
count expresses:
`{type: 'fact', id, icon?, count, noun, tone?, ids?, added?, removed?, modified?, description?}`.
You can attach a theme icon (`--projections-icon-<name>`), a `tone` (`added`,
`removed`, `modified`, or `neutral`), `ids` (up to
`rendererLimits.summaryFactIds` item or change IDs) to make the fact clickable
as a filter, comparison deltas (either item changes or a net metric
delta—`added` for growth, `removed` for shrinkage—rendered in change colors just
like kind counts), and a tooltip `description` (up to
`rendererLimits.summaryDescription` characters):

```ts
client.summary({
  items: [
    ...summaryItems(init, {selector: {singular: 'rule', plural: 'rules'}, probe: false}),
    {type: 'fact', id: 'enforcing', count: 1, noun: {singular: 'enforcing rule', plural: 'enforcing rules'}, added: 1},
    {type: 'fact', id: 'newly-enforced', icon: 'enforced', count: 1, noun: {singular: 'newly enforced', plural: 'newly enforced'}, ids: ['rule:guard']},
  ],
})
```

Hosts display facts as sent, while renderer checks verify that every entry in
`ids` exists, that single-extraction facts carry no changes, and that `added` or
`modified` never exceed `count`. Because the summary describes the whole
document, emit the exact same summary at every progress value and avoid drawing
a duplicate summary line inside your frame. Hosts ignore unknown item `type`
values so future types remain backward compatible, and older renderers that
never send `summary` continue to work with automatic kind wording. You can also
format the bar as a single sentence with `summarySentence`.

### Comparison modes

Hosts present comparisons in four modes:

<!-- prettier-ignore -->
| Mode | Frames | Progress |
|---|---|---|
| `animated` | one | `progress` runs from 0 (before) to 1 (after), with playback and step holds |
| `side-by-side` | two, before and after | one frame held at 0, the other at 1 |
| `swipe` | the same two, stacked under a divider | as side by side |
| `diff` | one | none: `init.comparisonMode` is `'diff'` and the renderer draws its own static comparison of `before` and `after` |

Declare supported modes in `capabilities.comparisonModes` and in `renderer.json`
(via the Vite helper's `comparisonModes` option). If omitted, the host assumes
`side-by-side`, `animated`, and `swipe` (`defaultComparisonModes`). Your
renderer only chooses _which_ modes it supports: hosts always present them in
the canonical order—diff, side by side, animated, then swipe
(`orderComparisonModes`)—and open in the first supported mode (`diff` if
available, otherwise `side-by-side`, via `defaultComparisonMode`). Listing them
in canonical order in your config keeps things clear. Not every visualization
fits every mode; a text diff, for instance, makes the most sense as a static
comparison and declares only `diff`.

Build `diff` first, because comparisons open in it by default and it is where
reviewers spend their time. It is excluded from the defaults because only your
renderer knows how to lay out the union of both revisions in its own visual
language—rendering `after` alone drops every removed item, so the SDK cannot
synthesize a diff automatically. `projections check` warns when a renderer lacks
diff mode; see the kit's [diff mode helpers](renderer-kit.md#diff-mode) to get
started.

If your animations need more breathing room than the host's default playback
speed, declare `capabilities.pace: {stepMs}` with an integer between 300 and
5000 ms (`rendererLimits.paceStepMs`). Hosts that pace playback by step count
will use that duration (still respecting the user's speed setting and keeping
ownership of progress). The kit's graph canvases declare `graphCanvasPace` (1800
ms per step).

In `diff` mode, the host sends no `progress`, playback, or swipe updates.
`useRenderer` reports progress 1 with `highlighting` 1 (use `isDiff(init)` to
tell modes apart), though a host that disables highlighting may send a single
`progress` with `highlighting: 0`. Selection, hover, controls, annotations, and
filtering (find and "changes only") all work identically across modes.

When syncing scroll containers, `key` identifies the target container—either its
`data-projections-scroll` attribute value or a structural path such as
`div:0>section:2`—and omitting it targets the document itself. Keys must match
`[A-Za-z0-9_.:> -]{1,256}`. Coordinates must be finite with absolute value at
most `rendererLimits.maxCoordinate` (1,000,000), anchor sizes and scroll offsets
must be non-negative, and unknown fields cause the message to be rejected.

Selection IDs match the host's row IDs: in a comparison, use the change ID for a
changed item and the item ID for an unchanged one; in a single extraction, use
the item ID. A `select` `path` is an RFC 6901 JSON pointer into that item (for
example `/data/owner`, `""` for the whole item, with `~0` and `~1` escaping `~`
and `/`), validated by `isPropertyPath`. Sending a `path` without an `id` is
invalid.

Annotations are generic markers—such as comment counts or diagnostic findings—
whose meaning stays in the host while the renderer draws them on items. Each
`AnnotationMark` includes the item's selection `id`, an optional integer `count`
(0 to `rendererLimits.annotationCount`, 1,000,000), an optional short `label`
(up to `rendererLimits.annotationLabel`, 64 characters, used as the accessible
description), and an optional `tone` from `annotationTones` (`neutral`,
`attention` for unresolved items, `done` for resolved ones, or `subtle` for
outdated ones). These tones are intentionally distinct from change colors. Each
message holds at most `rendererLimits.annotations` (10,000) items and replaces
all prior markers (an empty list clears them); unknown fields reject the entire
message. When a user activates a marker, the renderer posts `select` for the
item followed by `annotation` with its ID, leaving the host to decide what UI to
open.

<!-- prettier-ignore -->
| Capability | Renderer promises |
|---|---|
| `changeHighlighting` | `'supported'`: it emphasizes changes with `highlighting` |
| `toggleableRelationships` | It honors `options.showRelationships` |
| `drawsRelationships` | Defaults to true: it draws relationships, each marked with its ID in `data-entity-id`. `false` declares it deliberately draws none, or shows them only as structure (nesting, order) |
| `ownTimeline` | It presents its own timeline; the host still owns progress |
| `hover` | It reports `hover` and shows the host's `hover` |
| `anchors` | It reports `anchor` for the selected and hovered entities |
| `scrollSync` | It reports `viewport` and follows `scroll` |
| `filter` | It de-emphasizes or hides items outside the host's `filter` |
| `context` | It reads a change's `context` in the comparison; without it the host strips `context` from `init`. Kit renderers declare it |
| `annotations` | It draws the host's `annotations` on visible items, reports `annotation` when one is activated, and reports anchors for visible annotated items |
| `properties` | It draws item properties and may report `select` with a `path` |
| `controls` | The controls the host draws for it (see [Controls](../../packages/renderers/sdk/README.md#controls)) |

On the host side, you can rely on three guarantees: messages only arrive from
your parent window on your channel, progress updates are flow-controlled (at
most one unacknowledged update in flight, newer values replacing pending ones,
with a 1 s timeout), and extraction mode always runs at progress 1 with
highlighting 0.

The host enforces strict limits (`rendererLimits`): every message must come from
the frame's window in an opaque origin, carry the right channel, pass strict
validation (unknown types or fields are dropped), stay under 64 KiB, and remain
within 240 messages per second. Any renderer that fails to report ready within
10 s, navigates its frame, or floods the host is terminated, leaving the host's
table and text views available.

### Nesting a built-in renderer

A renderer can embed another built-in renderer inside its own view—for example,
the `gallery` renderer displays each fixture scenario with whichever renderer it
targets. Calling `embedRenderer` asks the host for a built-in renderer document
by name (`client.requestDocument`), mounts it in a sandboxed `srcdoc` frame
inside `container`, forwards `init`, `options`, `select`, and `progress`, relays
any nested `document-request`s through your client, and passes every child
message back to you:

```ts
import {connectRenderer, embedRenderer} from '@githubnext/projections/renderer'

const client = connectRenderer(handlers, {capabilities: {changeHighlighting: 'supported'}})
const nested = embedRenderer(client, card, {
  renderer: 'graph',
  title: 'Service platform, drawn by the graph renderer',
  init: {mode: 'extraction', extraction, projection: {id: 'platform', title: 'Service platform', renderer: 'graph'}, ...environment},
  onMessage: message => message.type === 'select' && client.select(message.id),
  onFailure: reason => showReason(card, reason),
})
nested.setEnvironment(environment) // follow the host's theme
nested.dispose()
```

Hosts only serve built-in renderers from their own registry. Requesting a custom
renderer, an unknown name, or running in a host that does not supply documents
invokes `onFailure` with the reason. The nested frame inherits your document's
CSP and runs in its own opaque origin, so it has no privileges beyond yours; it
fills `container` (`sizing: 'fill'`) and stays transparent until its first
paint.

## Theme tokens

Both `init.theme` and `environment.theme` carry `{colorMode, version, tokens}`,
where `version` identifies the token set (`themeTokenSetVersion`, currently 0).
Token set 0 defines light and dark defaults for every token below
(`defaultThemeTokens(colorMode)`). `resolveThemeTokens(theme)` fills in anything
a host omits, and `applyEnvironment` writes the full resolved set as
`--projections-<name>` CSS custom properties so your renderer can count on every
token existing.

Different hosts map their own design systems onto these names—the default UI
uses shadcn's neutral palette, VS Code maps its theme variables, and the GitHub
Copilot app's canvas viewer maps its canvas theme variables
(`copilotCanvasThemeTokens`). Every mapping preserves the contrast guarantees
and keeps change colors and the categorical palette consistent:

- **Surfaces** — `color-bg` (canvas), `color-bg-subtle`, `color-bg-inset`, and
  `color-bg-overlay`.
- **Text** — `color-fg`, `color-fg-muted`, `color-fg-subtle`, and
  `color-fg-on-emphasis`.
- **Stacked surfaces** — Ordered by elevation: `color-surface-canvas` (the stage
  behind cards) < `color-surface-raised` (a card) < `color-surface-header` (a
  card header band), alongside `color-surface-inset` (recessed columns like a
  line-number gutter or vacant space), with clear tonal steps in both modes.
- **Borders** — `color-border`, `color-border-muted`, `color-border-emphasis`,
  and `color-divider`. Use `color-divider` wherever two stacked surfaces meet (a
  card edge or band rule, guaranteed at least 3:1 against both), and reserve
  `color-border` for quieter rules between rows.
- **Accent and focus** — `color-accent`, `color-accent-muted`,
  `color-accent-emphasis`, and `color-focus`.
- **Changes** — `color-{added,removed,modified,moved}`, each paired with
  `-muted` (subtle fill), `-border` (a matching border at 3:1 or higher against
  both the raised surface and canvas, so tinted regions always have a crisp edge
  rather than a bare fill), `-highlight` (a stronger fill behind plain
  `color-fg` text for word-level diffs), and `-emphasis` (a solid fill behind
  `color-fg-on-emphasis`).
- **Highlight** — `color-highlight`, a neutral fill behind plain `color-fg` text
  for hover emphasis and find matches.
- **Categorical palette** — `chart-1` … `chart-16`, sixteen distinct hues tuned
  to sit comfortably on the theme canvas (chroma kept well below change colors,
  uniform lightness band; see
  [Languages](../../packages/renderers/sdk/README.md#languages)), each at least
  3:1 against `color-bg` and none gray (use `color-border-emphasis` for
  "other"). `chart-1` … `chart-8` stay clear of change hues (green, red, amber,
  violet), making them safe for non-change categories; for programming
  languages, use `/languages` instead.
- **Type** — `font-family`, `font-family-mono`, `font-size-xs`, `font-size-sm`,
  `font-size`, `font-size-lg`, `font-size-xl`,
  `font-weight-{normal,medium,semibold,bold}`, `line-height-tight`,
  `line-height`, and `line-height-relaxed`.
- **Spacing** — `space-1` (4px) … `space-8` (48px).
- **Shape** — `radius-sm`, `radius`, `radius-lg`, `radius-full`, `border-width`,
  and `border-width-thick`.
- **Elevation** — `shadow-sm`, `shadow-md`, and `shadow-lg`.
- **Controls** — `control-height-sm`, `control-height`, `control-height-lg`,
  `focus-ring-width`, and `focus-ring-offset`.
- **Labels and badges** — `label-font-size`, `label-font-weight`,
  `label-height`, `label-padding-x`, and `label-radius`.

In the kit, these are aliased to `--stage`, `--raised`, `--band`, `--inset`,
`--divider`, and `--{green,red,amber,violet}-border`. Change regions use
`pk-region` with `data-change` (scaling both fill and edge by `--emphasis`), and
vacant space uses `--pk-vacant` hatching.

For inline styles, `token` emits type-checked CSS variable references so typos
fail at compile time: `token.color('fg-muted')`, `token.space(2)`,
`token.fontSize('sm')`, `token.fontWeight('semibold')`, `token.radius('sm')`,
`token.chart(index)`, or `tokenVar(name)` for any token. Automated checks keep
these honest: `palette`, `type-scale`, and `spacing` verify that painted values
come from tokens, `stage-surface` checks that the stage background uses
`color-surface-canvas`, and `stage-insets` ensures top-level cards, panels, and
tables share a uniform inset from all four frame edges (see
[renderer testing](../../packages/renderers/testing/README.md)).

Hosts can pass up to 256 tokens, with lowercase kebab-case names and values of
at most 512 characters. Future token set versions will only add new names.

### Icons

Renderers always request icons by semantic meaning rather than by glyph name.
The shared vocabulary (`iconNames`) covers:

- **Change and status icons:** `added`, `removed`, `modified`, `renamed`,
  `moved`, `warning`, `error`, `breaking`, `info`, `unknown`, `additive`,
  `compatible`, `upgraded`, `downgraded`, `changed`, `enforced`, `unenforced`,
  `include`, `exclude`, `visible`, `hidden`, `expand`, `collapse`, `rescoped`,
  `settings`, `agent`, `replace`, `redeploy`, `import`, `read`, `blocked`, and
  `varied` (drawn in neutral text color beside a change status when a volatile
  value shifted beyond tolerance).
- **Section subjects** (shown beside section titles): `host`, `policy`,
  `workload`, `credential`, `process`, `file`, `network`, `module`, `bytecode`,
  `namespace`, `application`, and `other`.
- **Projection pipeline parts:** `extractor`, `comparator`, and `renderer`
  (custom Projections marks built around a dot representing an extraction, with
  converging strokes, a split pair of dots, or outgoing strokes).

Each icon is exposed as a theme token `icon-<name>` whose value is a
percent-encoded SVG data URL (`url("data:image/svg+xml,…")`, up to
`iconTokenLength` characters, validated with `isIconValue`).

Change kinds, planned actions, and `breaking` (`badgeIconNames`) are rendered as
badges—a solid disc with the glyph cut out—while every other icon is an outline
glyph. Because of that distinction, a secondary note after a change status (such
as a comparator's "Scope changed" note) should always use an outline icon rather
than a change-kind badge.

Badge glyphs are authored directly by the SDK and stay identical across hosts
(both the default UI and VS Code pass them through untouched), because scaling
an arbitrary icon set's glyph into a disc breaks its stroke weight and optical
centering. Each badge is drawn in a 24-unit box (a radius-11 disc at the center)
with a uniform 2.75-unit stroke (1.83px at 16px), round caps and joins, no
transforms (a dot is a zero-length stroke), and its inked bounding box centered
on (12, 12) within an 8-unit radius. Margins are balanced optically rather than
by bounding-box weight so arrowheads point cleanly; `moved`, `upgraded`, and
`downgraded` are quarter-turn rotations of the same drawing, while `redeploy` is
the one exception, placing its arrowhead where its concentric ring demands. Any
host supplying custom badge glyphs must uphold these rules, which the kit's
browser suite (`packages/renderers/kit/browser/badges.spec.ts`) verifies in
pixels.

To render an icon inside a frame, put `data-icon="<name>"` on an element and
include `@githubnext/projections/renderer/icons.css` (already bundled with the
kit's styles). It masks `--projections-icon-<name>` in `currentColor` at 1em
square so the icon automatically inherits the adjacent text's size and color.
Always set `aria-hidden="true"` and pair the icon with visible text—never rely
on an icon alone to convey meaning. The renderer CSP already permits `data:`
images for masks.

Outside a renderer frame (such as in a host's own summary bar), where icons.css
is not loaded, call `iconMaskStyle(name)` to get the equivalent inline style
properties—referencing the icon token, and for badges combining the disc
(`--projections-icon-badge`, defaulting to `badgeDiscValue`) with the cut-out
glyph. Give the element explicit dimensions and a `currentColor` background;
unknown icon names render nothing.

By default, the SDK ships Lucide icons (ISC) alongside its badge glyphs. Hosts
with their own icon set swap in their outline icons—VS Code supplies codicons—so
renderer icons blend right into the host UI. Hosts override icons like any other
token (`hostTheme(mode, {'icon-warning': svgIconValue(svg)})`), and embedders or
renderer authors can override `--projections-icon-<name>` in CSS or set
`--projections-icon` on an individual element.
