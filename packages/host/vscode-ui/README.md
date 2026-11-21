---
description: "The host's VS Code UI, themed from VS Code's variables"
---

# @githubnext/projections-host-vscode

An optional UI for the Projections browser host that looks and behaves like VS
Code. It draws the headless host core (`useProjection`, `ProjectionStage` and
`useComparisonPair` from `@githubnext/projections-host`) with VS Code's own
controls — [VSCode Elements](https://vscode-elements.github.io/) web components
and [codicons](https://github.com/microsoft/vscode-codicons) — and themes
everything, the sandboxed renderer frames included, from VS Code's `--vscode-*`
variables, so a projection follows the person's color theme in a webview. It is
the second host UI beside the default UI (`@githubnext/projections-host/ui`),
with the same props and block names.

The core still owns everything that must be correct and secure: renderer frames
and their protocol, progress, selection, pane sync, comparison modes and
settings. This package only presents them.

## Usage

In a VS Code webview, VS Code sets the variables on `html` and the theme kind
classes (`vscode-dark`, `vscode-light`, `vscode-high-contrast`,
`vscode-high-contrast-light`) on `body`. Load this package's stylesheet and link
the codicon stylesheet as `vscode-codicon-stylesheet` (VSCode Elements'
`vscode-icon` reads it); its font must be allowed by the webview's `font-src`:

```tsx
import {VscodeComparisonExplorer} from '@githubnext/projections-host-vscode'
import '@githubnext/projections-host-vscode/styles.css'
// <link id="vscode-codicon-stylesheet" rel="stylesheet" href="…/codicons/codicon.css"> (the package's ./codicon.css)

;<VscodeComparisonExplorer extractions={extractions} engine={engine} renderers={renderers} onOpen={openSource} />
```

Outside VS Code (Storybook, tests, a page that wants the look), apply a captured
theme with `applyVscodeTheme(element, theme)`: the variables as inline custom
properties and the kind classes on `element`. The fixtures in `fixtures/themes/`
(exported as `./themes/<id>`) are real VS Code themes: Dark Modern, Light
Modern, Dark High Contrast, Light High Contrast, Solarized Dark and Dark 2026,
captured from VS Code 1.145.2's webview with a screenshot of VS Code in each
(`*.vscode.png`).

`useVscodeTheme(ref)` reads the variables at an element before the first paint
and again whenever VS Code changes theme (a `MutationObserver` on `html`, `body`
and the nearest theme holder), and `vscodeThemeTokens(variables, kind)` maps
them to the renderer theme tokens, a pure function the unit tests run on every
fixture.

### Components

- `VscodeComparisonExplorer` — `VscodeProjectionView` with a `PairPicker` at the
  start of its toolbar (`useComparisonPair`); the same props as the default UI's
  `ComparisonExplorer`.
- `VscodeProjectionView` — the same props as the default UI's `ProjectionView`
  (a drop-in: the Inspector's `projectionView`), plus `features`,
  `toolbarStart`, `stageNotice`, `running`, `comparator`, `fill` and `toolbar`.
  `running` is the job a host runs for the view (`'extracting'`, `'comparing'`,
  or `null` while none runs; the Inspector passes it): the summary bar keeps a
  slot at its end for it, and spins a `sync` codicon there while one runs.
  `stageNotice` (a `StageNotice`) floats over the stage's top centre, 12px in
  (12px below the panes' header bands in side by side and swipe, the top pane's
  when stacked), over every view: it takes no layout space, so framing is
  unchanged, and stays put while the view scrolls under it. `toolbar={false}`
  (`data-toolbar="none"`) shows only the stage, notices and the detail card, for
  a host that draws the controls itself, for example as VS Code `editor/title`
  actions on a projection's editor tab: it drives mode, swap, playback and
  settings through the controller (`controllerRef`; the explorer's pair through
  `before`/`after`). Its root is `.phv-root[data-host-ui="vscode"]`, with the
  same `data-*` state attributes as the other UIs.
- `DetailCard` — VS Code's hover widget over the stage beside the selected item;
  `RawDetails` and `VscodeDetails` — a side bar view section with tree rows, for
  a docked panel.
- `VscodeTableView`, `VscodeTextView`, `VscodeLegend`, `LoadingStatus`,
  `Notice`, `StageNotice`.
- `runningIndicator`, `runningText` (and `runningDelayMs`, `runningMinimumMs`):
  when a running job's indicator shows, after 300 ms and then for at least 400
  ms, with injectable timers; no React or DOM, so an extension host imports it
  from `@githubnext/projections-host-vscode/running`. They are the host core's
  (`@githubnext/projections-host/running`), re-exported.

### Building blocks

The same names and props as the default UI's blocks: `Toolbar`, `PairPicker`,
`ModeSwitch`, `Playback`, `ZoomControls`, `ShowAsChip`, `SummaryBar`,
`VariedToggle`, `FilterButton`, `SettingsMenu`, `InfoButton`,
`FullscreenButton`, `MoreMenu`, `ProjectionPicker`, `ViewSwitch`,
`ComparatorLine`, `RawDetails`, `VariedList`, and the toolbar's
priority-collapse layout (`useToolbarLayout`, `toolbarGrid`, `toolbarSteps`),
which collapses in the same order as the default UI's. Animated playback always
has a second row to itself. Row 1 first centres the mode region (the mode and
scope switches), then puts it after the pickers (a VS Code tab passes
`centreModes: false`, so its switches lead the row instead); then compact
pickers, the mode menu, the varied count, zoom, About, full screen and Filter
into the toolbar's "…" (More Actions) one at a time, and merged pickers. Row 2
drops the slider's revision names, then moves its steps into its own "…" menu.
The toolbar's `data-rows`, `data-cluster`, `data-pickers`, `data-modes`,
`data-step` and `data-more-actions` say which layout applies. The host core's
`useFitPlan` plans it, with this UI's steps, measurement and 32px hysteresis.

- Toolbar actions: A view title bar's action bar: icon-only codicon buttons with
  VS Code's hover, active and focus states. The toolbar's edge controls sit as
  far from its ends as from its top and bottom, inside its hairline: a 22px
  action 6px in, the 26px mode group or pickers 4px, the playback row's controls
  4px; a first row of two keeps the one row's height, and a start slot that
  draws nothing leaves no gap. Component: `vscode-toolbar-button`
  (`ActionButton`).
- `ModeSwitch`: The diff editor's toggles: a radio group of toggle buttons in
  `--vscode-inputOption-*`; on a crowded toolbar, a menu. Component:
  `vscode-toolbar-button` (toggleable), `Menu`.
- `PairPicker`: VS Code dropdowns with a filterable list; merged, one action
  opening them in a widget. Component: `vscode-single-select`, `vscode-option`,
  `Overlay`.
- `Playback`: The debug toolbar: play/pause and step back/over codicons in the
  debug icon colors, and a slider. Component: `vscode-toolbar-button`, custom
  slider (`RangeInput`).
- `FilterButton`: An editor widget with VS Code's find input. Component:
  `vscode-textfield`, `Overlay`.
- `SummaryBar`: The status bar strip along the bottom of every view (22px,
  description foreground over the side bar background, a hairline above): a
  figure per kind in the renderer's words, `12 workspaces · 18 dependencies`,
  and in a comparison its changes, `+1 −1 ~2`, in the Git decoration colors;
  then the renderer's facts (`18 major upgrades`), its icon (a badge on its
  disc, `iconMaskStyle`) and words muted, its changes in the same colors and its
  description as its tooltip; each figure a filter toggle pressed in
  `--vscode-inputOption-*` (a fact when it names its items); the varied count
  with the `pulse` codicon at its end; for a host that runs the view's jobs
  (`running`), a slot after it, kept while none runs so nothing moves, where a
  `sync` codicon spins (still under reduced motion: `prefers-reduced-motion` or
  VS Code's `vscode-reduce-motion`) while one extracts or compares, shown after
  300 ms and then for at least 400 ms (`runningIndicator`, which the extension's
  status bar item shares), with "Extracting…" or "Comparing…" as its tooltip and
  in a polite live region; figures that don't fit in a "…" widget. Its text,
  like the toolbar's chip, varied and revisions labels, is centred by its cap
  height (`text-box`, or a line box one cap high without it): a capital E has
  the same space above, below and to its left in the strip, hairline included,
  and in a figure's pill. Component: custom buttons, `Overlay`.
- `VariedToggle`: "N varied within tolerance", with the `summary` feature off
  (else the summary bar's): a text toggle in the description foreground, pressed
  in `--vscode-inputOption-*`; in More, a check item. Component: custom button,
  `Menu`.
- `SettingsMenu`: VS Code's menu (`settingsModel`): "Show as" and "Changes
  only", then submenus ("Highlight changes", "Renderer", "Playback", the
  renderer's option groups). Component: `Menu` with submenus; declared ranges in
  a widget.
- `InfoButton`: An editor widget. Component: `Overlay`.
- `MoreMenu`: The "…" More Actions menu. Component: `Menu`.
- `ProjectionPicker`: A dropdown action opening a quick pick. Component:
  `QuickPick` (`vscode-textfield` filter), `vscode-badge`.
- `ViewSwitch`: Panel tabs. Component: `vscode-tabs`, `vscode-tab-header`.
- Renderer controls: Radios, a toggle checkbox, a dropdown, action buttons, a
  slider. Component: `vscode-radio-group`/`vscode-radio`, `vscode-checkbox`,
  `vscode-single-select`, `vscode-button`.
- Table view: VS Code's table with zebra rows and count badges. Component:
  `vscode-table` and its rows and cells, `vscode-badge`.
- `DetailCard`: The hover widget (`--vscode-editorHoverWidget-*`). Component:
  custom.
- `VariedList`: The detail card's volatile values: path and values in the editor
  font, "within tolerance" or "beyond tolerance (volatile)" with the pulse
  codicon, no change colors. Component: custom.
- `RawDetails`: A side bar section with tree rows (`symbol-property` codicons).
  Component: custom.
- `LoadingStatus`: The document's one thin progress bar at the top, as VS Code
  shows progress, after 300 ms (still under reduced motion); with a description,
  a short muted label after a 16px spinning `loading` codicon (a projection
  tab's skeleton shows the same) and the description in the box. Component:
  `--vscode-progressBar-background`.
- `Notice`: Input validation messages with the notification icons' colors.
  Component: custom, `vscode-button` actions.
- `StageNotice`: A pill floating over the stage's top centre (`stageNotice`),
  not a toolbar control: VS Code's warning validation fill over a widget
  background, a widget shadow, and an edge and `warning` codicon in the warning
  hue held to at least 3:1 against the fill (lightened on dark themes, darkened
  on light ones; the contrast border in high contrast). Its label and a flat
  Refresh-style action stay whole; the detail truncates first. A `status`,
  centred by cap height like the toolbar's labels. Component: custom.

Codicons map the UI's icons (`uiCodicons`, `modeCodicons`, `vscodeControlIcons`
for the renderer control icons), and the renderer icon vocabulary is sent to
renderers as codicon images (`codiconTokens`, generated by `npm run icons` from
`@vscode/codicons`), except the badge icons (`badgeIconNames`), which are the
SDK's badge glyphs as in every host: a codicon scaled into a disc keeps neither
its stroke nor its centre (`add` became a hairline beside a heavier tilde, half
a pixel off centre), so each badge is cut at one stroke and centred on its disc
(see the SDK's README, "Icons"). No comparison mode uses a playback glyph:
animated is `device-camera-video`, side by side `split-horizontal`, swipe
`arrow-both`, diff `diff-single`.

### Keyboard and accessibility across shadow DOM

VSCode Elements render their controls in shadow roots. The wrappers
(`src/elements.tsx`) are typed React 19 components (properties, `on…` events,
refs) and add what the elements leave out, on the shadow control itself so
assistive technology and `getByRole` see it: `ActionButton` gives
`vscode-toolbar-button`'s button `disabled`, `aria-pressed`,
`role="radio"`/`aria-checked` for a choice, `aria-haspopup`/`aria-expanded` and
a roving tab index; `Radio` exposes `vscode-radio`'s input (a checkbox
underneath) as `role="radio"`. `focusControl` focuses an element's shadow
control when the element doesn't delegate focus, which the toolbar layout uses
to keep focus on a control that changes form. Focus rings are VS Code's: a 1px
`--vscode-focusBorder` outline inside the control, from the elements' own styles
and `styles.css`.

## Theme tokens

`vscodeThemeTokens` reads each token from the first VS Code variable that is
set, then keeps the contrast the token set promises: text 4.5:1 on every surface
(7:1 for `color-fg` and `color-fg-muted` in high contrast themes), change hues
4.5:1 (moved toward white or black, which keeps the hue), edges, the divider and
focus 3:1, and fills drawn behind text keep that text readable. A theme's own
color is sent unchanged wherever it already has the contrast. Tokens VS Code has
no variable for (`chart-*`, spacing, control heights) keep the token set's
defaults or VS Code's metrics (a 22px row, 26px controls, 13px type); `icon-*`
are codicons. High contrast themes send no shadows.

<!-- prettier-ignore -->
| Token                                                   | VS Code variable                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `color-bg`, `color-surface-canvas`, `color-fg-on-emphasis` | `--vscode-editor-background`                                                          |
| `color-fg`                                              | `--vscode-editor-foreground`, `--vscode-foreground`                                     |
| `color-fg-muted`, `color-fg-subtle`                     | `--vscode-descriptionForeground`, `--vscode-disabledForeground`                         |
| `color-surface-raised`, `color-bg-overlay`              | `--vscode-editorWidget-background`, `--vscode-editorHoverWidget-background`             |
| `color-surface-header`                                  | `--vscode-sideBarSectionHeader-background`, `--vscode-editorGroupHeader-tabsBackground` |
| `color-surface-inset`, `color-bg-subtle`, `color-bg-inset` | `--vscode-sideBar-background`                                                        |
| `color-border*`, `color-divider`                        | `--vscode-contrastBorder`, `--vscode-panel-border`, `--vscode-widget-border`, `--vscode-input-border` |
| `color-accent*`                                         | `--vscode-textLink-foreground`, `--vscode-list-inactiveSelectionBackground`             |
| `color-focus`                                           | `--vscode-focusBorder`                                                                  |
| `color-highlight`                                       | `--vscode-editor-selectionHighlightBackground`                                          |
| `color-added`, `-emphasis`                              | `--vscode-gitDecoration-addedResourceForeground`                                        |
| `color-removed`, `-emphasis`                            | `--vscode-gitDecoration-deletedResourceForeground`                                      |
| `color-modified`, `-emphasis`, `-border`                | `--vscode-gitDecoration-modifiedResourceForeground`                                     |
| `color-moved`, `-emphasis`, `-border`                   | `--vscode-charts-purple`                                                                |
| `color-added-muted`, `color-removed-muted`              | `--vscode-diffEditor-insertedLineBackground`, `--vscode-diffEditor-removedLineBackground` |
| `color-added-highlight`, `color-removed-highlight`      | `--vscode-diffEditor-insertedTextBackground`, `--vscode-diffEditor-removedTextBackground` |
| `color-added-border`, `color-removed-border`            | `--vscode-diffEditor-insertedTextBorder`/`removedTextBorder` (high contrast), the gutter colors |
| `font-family`, `font-family-mono`                       | `--vscode-font-family`, `--vscode-editor-font-family`                                   |
| `font-size*`, `font-weight-*`                           | `--vscode-font-size`, `--vscode-bodyFontSize-*`, `--vscode-fontSize-heading2`, `--vscode-fontWeight-semiBold` |
| `radius*`, `border-width`                               | `--vscode-cornerRadius-*`, `--vscode-strokeThickness`                                   |
| `shadow-*`                                              | `--vscode-widget-shadow`                                                                |

The chrome reads the same variables directly in `styles.css` (`--phv-*` custom
properties on every block's root), so host chrome and renderer frames stack the
same surfaces.

## The Inspector

`./inspector.css` restyles the Inspector's shell for mount roots marked
`data-host-ui="vscode"`: it maps VS Code's variables onto the shell's `--pj-*`
tokens and draws the title bar as an editor's title area, the Explorer as side
bar view sections with tree rows, the bottom panel's tabs as panel tabs, the
command palette and projection switcher as quick picks, menus as VS Code menus
and the status bar as VS Code's. Pass `VscodeProjectionView` as
`mountInspector`'s `projectionView`; the VS Code extension's webview does both.

## Decisions

- **VSCode Elements, not Elements Lite.** `@vscode-elements/elements` 2.5.1
  (MIT, Adam Bender; Lit 3.3.3 and `@lit/context` 1.1.6, BSD-3-Clause, Google
  LLC) is used everywhere it has a component. Its Lit web components carry their
  own keyboard behavior (the dropdown's filtering combobox, tabs, tree, table),
  focus handling and VS Code's look from the `--vscode-*` variables, so the UI
  tracks VS Code without copying its CSS. Elements Lite is CSS for native
  elements only: it has no dropdown with a filterable list, no tabs, tree,
  table, badge or progress ring behavior, so this UI would reimplement them.
  Pinned exactly: the wrappers patch the elements' shadow controls (above),
  which a minor version could change; upgrade deliberately and rerun the browser
  suite.
- **Custom where the library has nothing, or nothing accessible.** VSCode
  Elements has no popover or widget, no quick pick, no slider and no banner, so
  `Overlay`, `QuickPick`, `RangeInput` and `Notice` are custom, drawn with
  `--vscode-*`. `vscode-context-menu` exists but has no menu roles, no item
  icons or checked items, and keeps focus on its wrapper with the highlight
  drawn by index, so assistive technology can't follow it: `Menu` is custom
  (`menu`, `menuitem`, `menuitemradio`, `menuitemcheckbox`, VS Code's keys). The
  hover widget (detail card) and tree rows (details) are custom; `vscode-tree`
  is a data-driven tree that doesn't fit an item's properties and evidence.
- **Codicons.** `@vscode/codicons` 0.0.45 (the latest stable release; later
  versions are prereleases). Its font and icon artwork are CC BY 4.0, its code
  MIT, both Copyright (c) Microsoft Corporation: `THIRD_PARTY_NOTICES.md`
  carries both licences and the attribution. The renderer icon tokens embed
  codicon SVGs, unmodified; the badge icons are the SDK's own glyphs.
- **Fixtures, not guesses.** The theme mapping and Storybook use variables
  captured from VS Code itself, so contrast checks run on the themes people use,
  including both high contrast themes and a third-party one (Solarized Dark).

## Development

```sh
npm run build --workspace @githubnext/projections-host-vscode      # tsc, then copies the codicon font and CSS to dist/codicons
npm test --workspace @githubnext/projections-host-vscode           # theme mapping on every fixture, codicon map
npm run typecheck --workspace @githubnext/projections-host-vscode
npm run icons --workspace @githubnext/projections-host-vscode      # regenerate src/icons.generated.ts
npm run notices --workspace @githubnext/projections-host-vscode    # regenerate THIRD_PARTY_NOTICES.md
npm run test:browser --workspace @githubnext/projections-host-vscode -- --project=chromium-desktop
```

The browser suite (`browser/vscode.spec.ts`) drives Storybook's "VS Code UI"
stories in the captured themes: rendering in every theme, every mode by click
and by arrow keys through the shadow DOM, Tab order and VS Code focus outlines,
menus, Filter, playback, the toolbar's collapse from 1440 to 320px without
overflow, contrast in both high contrast themes, and the Inspector shell. Run it
with one project and few workers (`--project=chromium-desktop --workers=2`) on a
workstation.

## License

MIT. Third-party notices for VSCode Elements, Lit and codicons are in
`THIRD_PARTY_NOTICES.md`.
