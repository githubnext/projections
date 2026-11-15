# Renderer SDK guide

The [renderer SDK](../../packages/renderers/sdk/README.md)'s protocol, as a
renderer sees it, and the theme tokens the host applies.

## Protocol

Version 0. The host loads a renderer's `index.html` into
`<iframe sandbox="allow-scripts">` (opaque origin) served with
`rendererContentSecurityPolicy` (`connect-src 'none'`, `sandbox allow-scripts`).
The URL fragment carries `channel` (a fresh random nonce per frame), the host
`origin` and the host's `color` mode. The host keeps the frame invisible until
the renderer posts its first `rendered` (or an `error`), so draw nothing before
`init`: `rendererConfig` builds a document whose root uses
`color-scheme: light dark` with a transparent background, and whose body takes
the fragment's color mode until `applyEnvironment` applies the theme (it sets
`color-scheme` on the body and keeps the root at `light dark`). Every message is
a plain object `{projections: 0, channel, type, ...payload}` sent with
`postMessage`.

The renderer speaks first: it posts `ready` as soon as it listens. The host then
sends `init`, then `options`, `select`, `viewport` and `progress` as needed, and
`hover`, `scroll`, `filter` and `annotations` only to renderers that declare the
matching capability. A host may show two frames of the same bundle side by side
(one at progress 0, one at 1); it keeps their selection and hover in sync and
mirrors scrolling between them.

- `init`: `mode: 'extraction'` with `extraction`, or `mode: 'comparison'` with
  `before`, `after`, `comparison` and optional `comparisonMode` (see
  [Comparison modes](#comparison-modes)); plus
  `projection {id, title, renderer}` (`renderer` is the definition's renderer
  name, or a custom bundle's path, so a bundle that handles several names can
  pick a variant), `theme {colorMode, tokens}`, `reducedMotion`, `locale`,
  optional `pane` and `sizing`
- `progress`: `progress` 0..1, `highlighting` 0..1 (0 at both endpoints),
  `direction` 1 or -1
- `select`: `id` or `null`, optional `path`: the selected item, or a property of
  it
- `options`: `options: {showRelationships?, …}`
- `viewport`: `width`, `height`
- `environment`: `theme`, `reducedMotion`, `locale` and `pane` (when they change
  after `init`). `pane` (`before` or `after`) is set while the frame is one held
  pane of side by side or swipe: it shows that revision only, which the host
  labels in a band above the pane, so leave out narration of the transition such
  as step captions. `applyEnvironment` marks it as `data-pane` on the document
  element; the kit passes it to renderers as `pane`. `sizing` says how the host
  sizes the frame: `content` when it gives the frame the height the renderer
  reports (`height`), `fill` when it sizes the frame itself (a tab or pane).
  Content fitted to a `content` frame need only fit its width, from the first
  paint: the frame's height before the host answers is not the one it gets.
  Hosts that don't say leave it out; fit both dimensions then. The kit's
  `useFrameSizing()` returns it.
- `action`: `id` of an activated `action` control
- `filter`: `query`, `changesOnly`, `ids` (matching selection IDs, or `null`):
  the host's find and "changes only" settings (capability `filter`)
- `hover`: `id` or `null`: the entity the person is pointing at in any pane
  (capability `hover`)
- `scroll`: `x`, `y` (CSS px, ≥ 0), optional `key`: scroll that container to
  mirror another pane (capability `scrollSync`)
- `annotations`: `items`: `{id, count?, label?, tone?}` markers to draw on
  items, replacing any earlier ones (capability `annotations`)

- `ready`:
  `capabilities {changeHighlighting: 'supported' | 'none', toggleableRelationships?, drawsRelationships?, ownTimeline?, hover?, anchors?, scrollSync?, filter?, annotations?, properties?, comparisonModes?, pace?, controls?}`
  (flags are booleans)
- `rendered`: `progress` whose frame was painted
- `select`: `id` or `null`, optional `path` (only with an `id`): the person
  selected an item or a property of it
- `height`: `px` (host clamps to 120–20,000)
- `aspect`: `ratio`: width / height of the content the renderer fits to its
  stage, over the whole transition (0.01–100). Optional; a host uses it to stack
  side by side's panes for wide content. The kit's `useFitScale` sends it
- `steps`: `ends`: increasing progress values in 0..1 where the host may hold;
  optional `slots`: how many step slots the presentation spans (steps plus
  reading time, `timelineSlots`), for the host's default pace
- `open`: `path`, optional `line` (the host decides whether to navigate)
- `error`: `message`
- `hover`: `id` (non-empty) or `null`: the entity under the pointer or focus
- `anchor`: `id`, `rect {x, y, width, height}` or `null`: where the selected,
  hovered or an annotated entity is visible, in the frame's viewport (CSS px),
  for the host's connector between panes and overlays it places on items; `null`
  when it isn't visible
- `viewport`: `x`, `y` (CSS px, ≥ 0), optional `key`: the person scrolled a
  container
- `controls`: `controls`: replaces the declared controls (see
  [Controls](../../packages/renderers/sdk/README.md#controls))
- `annotation`: `id` (non-empty): the person activated the annotation marker on
  that item, after selecting it
- `legend`: optional `title`, `items [{label, token? | color?, shape?}]` (at
  most `rendererLimits.legendItems`, labels up to `legendLabel`): the host draws
  it once beside the frames; post it with `client.legend(...)`, which throws
  when it's invalid
- `summary`: `items`: counts
  `{type?: 'count', collection?, kind, noun {singular, plural}, count, added?, removed?, modified?}`
  and facts
  `{type: 'fact', id, icon?, count, noun, tone?, ids?, added?, removed?, modified?, description?}`
  (at most `rendererLimits.summaryItems`, nouns up to `summaryNoun`): the
  renderer's figures for the host's summary bar in display order (see
  [Summary bar](#summary-bar)); post it with `client.summary(...)`, which throws
  when it's invalid. Optional: without it the host words the kinds itself

### Summary bar

Hosts draw a thin bar along the bottom of every projection view: a figure per
extraction kind (`12 workspaces · 18 dependencies`), and in a comparison its
changes (`12 workspaces +1 −1 · 18 dependencies +2`, the change figures in their
change colors). Clicking a figure filters to those items. The words are the
renderer's: post `summary` with a figure per kind you want shown, in order, each
with the `noun` for one item and for any other count. `/presentation` counts
them for you: `summaryItems(init, nouns)` returns the figures of an
`InitPayload` (or the host's subject), worded with `nouns`
(`{kind: {singular, plural}}`, `false` to leave a kind out, a
`relationships:kind` or `entities:kind` key for one collection's kind; the kinds
an object lists come first) and `humanizeKind` for the rest:

```ts
client.summary({items: summaryItems(init, {package: {singular: 'workspace', plural: 'workspaces'}, resolved: false})})
```

A definition can word its own kinds and color them (`presentation.kinds`, see
[definitions](../contracts/definitions.md)); hosts send it as
`init.projection.kinds`, `{kind: {color?, noun?}}`. Its nouns should win over
yours: kit renderers apply them for you (`rendererSummary`). `humanizeKind`
counts an adjective kind without a plural (`24 hidden`, `5 not patchable`) and
keeps common prefixes hyphenated (`6 pre-releases`).

Each item has a `type`. A count (`type: 'count'`, the default when absent;
`summaryItems` sends it) names a kind: `count` is its total (in `after` for a
comparison); `added`, `removed` and `modified` count the comparison's changes of
that status by the item each names (`summaryCounts`). The previous total ("was
N") is `count − added + removed`, so it is never sent. Hosts show their own
counts of the kinds you name; the renderer checks hold you to the same counts. A
fact (`type: 'fact'`) is a finding no kind count says, or a measure that isn't a
kind,
`{type: 'fact', id, icon?, count, noun, tone?, ids?, added?, removed?, modified?, description?}`:
an optional theme icon name (`--projections-icon-<name>`), a `tone` (`added`,
`removed`, `modified` or `neutral`) that colors its figure, `ids` (at most
`rendererLimits.summaryFactIds` item or change IDs) that make it a filter to
those items, its changes in a comparison (how many of what it counts arrived,
left or changed, or a measure's net change, `added` when it grew and `removed`
when it shrank; hosts draw them in the change colors after it, as a count's),
and a `description` (at most `rendererLimits.summaryDescription` characters) for
its tooltip:

```ts
client.summary({
  items: [
    ...summaryItems(init, {selector: {singular: 'rule', plural: 'rules'}, probe: false}),
    {type: 'fact', id: 'enforcing', count: 1, noun: {singular: 'enforcing rule', plural: 'enforcing rules'}, added: 1},
    {type: 'fact', id: 'newly-enforced', icon: 'enforced', count: 1, noun: {singular: 'newly enforced', plural: 'newly enforced'}, ids: ['rule:guard']},
  ],
})
```

Hosts show a fact as sent; the checks verify that its `ids` exist, that one
extraction's facts have no changes and that what it counts as added or modified
is part of its count. The summary describes the whole document, so send the same
one at every progress, and draw no summary line of your own. Hosts drop an item
of a `type` they don't know and keep the rest, so later types are additive.
Without a `summary` the host words every kind from its name, so bundles written
before the message keep working. `summarySentence` writes the bar's words as one
line.

### Comparison modes

A host presents a comparison in one of four modes:

<!-- prettier-ignore -->
| Mode | Frames | Progress |
|---|---|---|
| `animated` | one | `progress` runs from 0 (before) to 1 (after), with playback and step holds |
| `side-by-side` | two, before and after | one frame held at 0, the other at 1 |
| `swipe` | the same two, stacked under a divider | as side by side |
| `diff` | one | none: `init.comparisonMode` is `'diff'` and the renderer draws its own static comparison of `before` and `after` |

A renderer declares which modes it supports as `capabilities.comparisonModes`
and in its `renderer.json` (the Vite helper's `comparisonModes` option writes
it); without a declaration it supports `side-by-side`, `animated` and `swipe`
(`defaultComparisonModes`). The renderer chooses only _which_ modes: hosts show
them in one canonical order (diff, side by side, animated, then swipe;
`orderComparisonModes`) and open in the first supported mode in that order: diff
whenever it is supported, else side by side (`defaultComparisonMode`). List them
in canonical order for readability. Not every renderer suits every mode: a text
diff explains a change best as one static view, so it declares only `diff`.

Implement `diff` first: it is the view a comparison opens in and where people
review changes. The defaults leave it out because only the renderer can draw it.
A union of both revisions has to be laid out in the renderer's own form, and a
frame drawn at After loses every removed item, so the SDK can't derive a diff
from the other modes. `projections check` warns about a renderer without one;
the kit's [diff mode](renderer-kit.md#diff-mode) has the pieces.

A renderer whose motion needs more time than the host's default playback can
declare `capabilities.pace: {stepMs}`, how long one comparison step should take
(an integer from 300 to 5000 ms, `rendererLimits.paceStepMs`). Hosts that size
playback by the step count use it instead of their default; the person's speed
setting still applies, and the host still owns progress. The kit's graph
canvases declare `graphCanvasPace` (1800 ms per step).

In `diff` mode the host sends no `progress`, playback or swipe. `useRenderer`
then reports progress 1 with `highlighting` 1 (`isDiff(init)` tells the modes
apart); a host that turns highlighting off may send one `progress` with
`highlighting: 0`. Selection, hover, controls, annotations and the host's filter
(find and "changes only") apply as in every mode.

Scroll `key` names a scroll container: the value of its
`data-projections-scroll` attribute, or a structural path such as
`div:0>section:2`; without it, the document. Keys match
`[A-Za-z0-9_.:> -]{1,256}`. Coordinates are finite and at most
`rendererLimits.maxCoordinate` (1,000,000) in absolute value; anchor sizes and
scroll offsets are never negative; unknown fields reject the message.

Selection IDs are the host's row IDs: in a comparison, the change ID for a
changed item and the item ID for an unchanged one; in an extraction, the item
ID. A `select` `path` is an RFC 6901 JSON pointer into the selected item (for
example `/data/owner`; `""` is the whole item; `~0` and `~1` escape `~` and
`/`), checked with `isPropertyPath`. A `path` without an `id` is invalid.

Annotations are generic markers a host draws through the renderer, for example
comment counts or findings; what they mean stays with the host. Each
`AnnotationMark` has the item's selection `id`, an optional `count` (an integer
0 to `rendererLimits.annotationCount`, 1,000,000), an optional short `label` (at
most `rendererLimits.annotationLabel`, 64 characters, used as the marker's
accessible description) and an optional `tone` (`annotationTones`: `neutral`,
`attention` for something unresolved, `done` for something resolved, `subtle`
for something outdated). Tones are deliberately unlike change colors. A message
carries at most `rendererLimits.annotations` (10,000) items and replaces every
earlier one; an empty list clears them. Unknown fields reject the whole message.
When the person activates a marker, the renderer reports `select` for the item
and then `annotation` with its ID; the host decides what to open.

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
| `annotations` | It draws the host's `annotations` on visible items, reports `annotation` when one is activated, and reports anchors for visible annotated items |
| `properties` | It draws item properties and may report `select` with a `path` |
| `controls` | The controls the host draws for it (see [Controls](../../packages/renderers/sdk/README.md#controls)) |

Host guarantees: messages reach the renderer only from its parent window on its
channel; progress is flow-controlled (at most one unacknowledged value, newer
values replace a pending one, a 1 s acknowledgement timeout); extraction mode
uses progress 1 and highlighting 0.

Host enforcement (`rendererLimits`): messages must come from the frame's window
and an opaque origin, carry the channel, validate strictly (unknown fields and
types are dropped), stay under 64 KiB and 240 per second. A renderer that isn't
ready within 10 s, navigates its frame or floods the host is stopped; the host's
table and text views stay available.

## Theme tokens

`init.theme` and `environment.theme` carry `{colorMode, version, tokens}`.
`version` is the token set (`themeTokenSetVersion`, currently 0). Token set 0
defines every token below with light and dark defaults
(`defaultThemeTokens(colorMode)`). `resolveThemeTokens(theme)` fills any token a
host omits, and `applyEnvironment` exposes the resolved set as
`--projections-<name>` custom properties, so renderers can rely on all of them.
Hosts map their design system onto these names: the default UI uses shadcn's
neutral palette, the VS Code UI VS Code's theme variables, and the agent viewer
in the GitHub Copilot app's canvas the app's canvas theme variables
(`copilotCanvasThemeTokens`). Every mapping keeps the contrast the token set
promises, and change colors and the categorical palette keep their meaning.

- Surfaces: `color-bg` (canvas), `color-bg-subtle`, `color-bg-inset`,
  `color-bg-overlay`
- Text: `color-fg`, `color-fg-muted`, `color-fg-subtle`, `color-fg-on-emphasis`
- Stacked surfaces: In elevation order: `color-surface-canvas` (the stage behind
  cards) < `color-surface-raised` (a card) < `color-surface-header` (a header
  band in a card) and `color-surface-inset` (a recessed column, such as a
  line-number gutter, or room with nothing in it), with visible steps in both
  modes
- Borders: `color-border`, `color-border-muted`, `color-border-emphasis`;
  `color-divider` separates any two stacked surfaces at 3:1 or more against both
  (a card's edge, a band's rule), while `color-border` stays the quieter rule
  between rows
- Accent and focus: `color-accent`, `color-accent-muted`,
  `color-accent-emphasis`, `color-focus`
- Changes: `color-{added,removed,modified,moved}`, each with `-muted` (subtle
  fill), `-border` (the fill's edge, in the same hue, at 3:1 or more against the
  raised surface and the canvas: a tinted region always has a defining edge,
  never a fill alone), `-highlight` (stronger fill still drawn behind plain
  `color-fg` text, for word-level changes) and `-emphasis` (strong fill behind
  `color-fg-on-emphasis`)
- Highlight: `color-highlight`: a neutral fill behind plain `color-fg` text, for
  hover emphasis and find matches
- Categorical palette: `chart-1` … `chart-16`: sixteen distinct hues, muted to
  sit on the theme's canvas (chroma capped well under the change colors, one
  lightness band, see
  [Languages](../../packages/renderers/sdk/README.md#languages)), each at least
  3:1 against `color-bg`, none gray (keep `color-border-emphasis` for "other");
  `chart-1` … `chart-8` avoid the change hues (green, red, amber, violet), so
  use them for categories that aren't changes. Color languages with `/languages`
  instead
- Type: `font-family`, `font-family-mono`, `font-size-xs`, `font-size-sm`,
  `font-size`, `font-size-lg`, `font-size-xl`,
  `font-weight-{normal,medium,semibold,bold}`, `line-height-tight`,
  `line-height`, `line-height-relaxed`
- Spacing: `space-1` (4px) … `space-8` (48px)
- Shape: `radius-sm`, `radius`, `radius-lg`, `radius-full`, `border-width`,
  `border-width-thick`
- Elevation: `shadow-sm`, `shadow-md`, `shadow-lg`
- Controls: `control-height-sm`, `control-height`, `control-height-lg`,
  `focus-ring-width`, `focus-ring-offset`
- Labels and badges: `label-font-size`, `label-font-weight`, `label-height`,
  `label-padding-x`, `label-radius`

The kit aliases these as `--stage`, `--raised`, `--band`, `--inset`, `--divider`
and `--{green,red,amber,violet}-border`, draws a change region with `pk-region`
and `data-change` (fill and edge, both scaled by `--emphasis`), and hatches
empty room with `--pk-vacant`.

`token` writes a token as a CSS value for an inline style, typed so a name that
isn't a token doesn't compile: `token.color('fg-muted')`, `token.space(2)`,
`token.fontSize('sm')`, `token.fontWeight('semibold')`, `token.radius('sm')`,
`token.chart(index)`, or `tokenVar(name)` for any token. The renderer checks
`palette`, `type-scale` and `spacing` hold every painted value to these tokens,
and `stage-surface` holds the field behind a renderer's content to
`color-surface-canvas` (see
[renderer testing](../../packages/renderers/testing/README.md)).

Hosts may send at most 256 tokens. Names are lowercase kebab-case and values are
at most 512 characters. Later token sets only add names.

### Icons

Renderers ask for an icon by meaning, never by glyph. The vocabulary is
`iconNames`: `added`, `removed`, `modified`, `renamed`, `moved`, `warning`,
`error`, `breaking`, `info`, `unknown`, `additive`, `compatible`, `upgraded`,
`downgraded`, `changed`, `enforced`, `unenforced`, `include`, `exclude`,
`visible`, `hidden`, `expand`, `collapse`, `rescoped`, `settings`, `agent`,
`replace`, `redeploy`, `import`, `read`, `blocked`, `varied` (a volatile value
that changed beyond its tolerance; neutral, drawn in the text color beside the
change's own status), the subjects a section holds, drawn beside its title
(`host`, `policy`, `workload`, `credential`, `process`, `file`, `network`,
`module`, `bytecode`, `namespace`, `application`, `other`), and the projection's
parts, `extractor`, `comparator` and `renderer` (Projections' own drawings: a
dot is the extraction, with strokes converging on it, two dots divided, or
strokes leaving it). Each is a theme token, `icon-<name>`, whose value is an SVG
image as a percent-encoded data URL (`url("data:image/svg+xml,…")`, at most
`iconTokenLength` characters, checked by `isIconValue`).

The change kinds, the planned actions and `breaking` (`badgeIconNames`) are
badges: a solid disc with the glyph cut out of it. Every other icon is an
outline glyph, so a note after a change's status (a comparator's interpretation,
such as Scope changed) asks for an outline icon of its own, never a change
kind's.

Badge glyphs are the SDK's own drawings, the same in every host (the default UI
and the VS Code UI send them unchanged): an icon set's glyph scaled into a disc
keeps neither its stroke nor its centre. Each is drawn in the badge's 24-unit
box (the disc a circle of radius 11 at its centre) at one stroke, 2.75 units
(1.83px at 16px), with round caps and joins and no transform, a dot being a
stroke of no length; and each is placed so that its ink's bounding box, caps and
joins included, is centred on the disc's centre, (12, 12), with no ink further
than 8 units from it. The margins are optical rather than weighted, so an
arrow's head points the way it goes; the arrows (`moved`, `upgraded`,
`downgraded`) are one drawing turned in quarter turns. The exception is
`redeploy`, a ring arrow whose ring is concentric with the disc and whose head
sits where the ring puts it. A host that draws its own badge glyphs keeps to the
same rules; the kit's browser suite
(`packages/renderers/kit/browser/badges.spec.ts`) measures the cut-outs'
bounding boxes and strokes in pixels.

Draw one with an element carrying `data-icon="<name>"` and the SDK's stylesheet
(`@githubnext/projections/renderer/icons.css`, which the kit's styles include):
it masks `--projections-icon-<name>` in `currentColor`, 1em square, so the icon
takes the size and color of the text beside it. Mark it `aria-hidden="true"` and
always put the word it stands for beside it; an icon never carries meaning
alone. The renderer policy already allows `data:` images, which masks use.

Outside a frame, where icons.css doesn't apply (a host's own UI, such as the
summary bar's facts), `iconMaskStyle(name)` gives the same mask as style
properties: the token, and for a badge the disc (`--projections-icon-badge`,
`badgeDiscValue` by default) with the glyph cut out. Give the element a size and
a `currentColor` background; a name the theme lacks draws nothing.

The SDK's defaults are Lucide icons (ISC) and its badge glyphs; the default UI
sends them, and a host with its own icon set sends its outline icons instead
(the VS Code UI sends codicons), so renderer icons match the surrounding
interface. A host overrides any icon like any token
(`hostTheme(mode, {'icon-warning': svgIconValue(svg)})`), and an embedder or
renderer author can override `--projections-icon-<name>` in CSS, or
`--projections-icon` on a single element.
