# Host UI components

These are [shadcn/ui](https://ui.shadcn.com) components in the **radix-vega**
style (the classic style, formerly new-york, built on Radix primitives), copied
from the shadcn@4.23.0 registry
(`https://ui.shadcn.com/r/styles/radix-vega/<name>.json`) and used under the MIT
license in [LICENSE.shadcn.txt](./LICENSE.shadcn.txt). The code stays close to
upstream so another style or token set can be pulled later. Each copied file
starts with an attribution comment that lists its local changes:

- every class carries the Tailwind v4 `pj:` prefix and theme variables are
  `--pj-*` (`[--card-spacing:…]` → `[--pj-card-spacing:…]`); upstream's
  unprefixed `cn-*` hook classes are kept;
- imports come from the individual `@radix-ui/react-*` packages instead of the
  `radix-ui` monolith, and icons from `lucide-react`;
- Radix portals (`select.tsx`, `popover.tsx`, `dropdown-menu.tsx`,
  `tooltip.tsx`) render into `ScopedRoot` through `usePortalContainer()`, marked
  `// local:`.

The first two are mechanical: `../../../scripts/shadcn/transform.mjs` applies
them (and the header) to a registry item. Anything else is a genuine edit,
listed in the file's header. `upstream/` keeps the pristine registry items we
adapted, and `upstream/manifest.json` their release.

`dropdown-menu.tsx` is shadcn's `DropdownMenu`
(`@radix-ui/react-dropdown-menu`): a menu of actions and
`DropdownMenuRadioGroup` / `DropdownMenuRadioItem` choices, with
`DropdownMenuLabel` and `DropdownMenuSeparator`, for example the Inspector's
Settings (gear) menu with its Theme choice. Its trigger can be a toolbar item
(`ToolbarButton asChild` around `DropdownMenuTrigger asChild` around a
`Button`); it opens with Enter, Space or Arrow Down, the arrows move between
items and Escape closes it and returns focus to the trigger. The chosen radio
item takes the Select's lens dot (see below).

`button-group.tsx` is shadcn's `ButtonGroup` (attached buttons, selects and
inputs, for example the Inspector's two title-bar pickers). `range.tsx` (a
native range input styled like Slider, see `.pj-range` in `../theme.css`),
`segmented-control.tsx`, `scoped-root.tsx` and `toolbar.tsx` are our own. shadcn
has no toolbar, so `toolbar.tsx` styles the Radix Toolbar primitive
(`@radix-ui/react-toolbar`) with the same tokens: one Tab stop, roving focus
with the arrow keys, and `ToolbarButton asChild` to make a `Button`,
`SelectTrigger` or input an item. `useFitPlan` (the headless core's, from
`../../fit-plan.ts`, exported here too) chooses among a bar's planned layouts by
measuring the bar itself, with hysteresis; an optional `ceiling` skips a plan on
a bar wider than it suits (the view toolbar uses it to avoid a second row whose
first row is mostly empty). The default UI's view toolbar and the Inspector's
title bar both use it. The host's default UI keeps native `<select>` and range
inputs where embedders and tests rely on native form semantics.

`index.ts` is the `@githubnext/projections-host/ui/components` export for
Projections apps such as the Inspector; Tailwind also scans
`packages/host/inspector/src/**`, so classes used there are compiled into
`dist/ui.css`.

## Embedding rules

- Classes use the `pj:` variant prefix (`pj:flex`, `pj:hover:bg-accent`,
  `pj:-mx-1`, `pj:peer`). `../theme.css` is the Tailwind v4 CSS-first source
  (`@theme`, custom variants, `--pj-*` tokens and a scoped reset; no preflight).
  `scripts/build-ui-css.mjs` compiles it to `dist/ui.css`, removes the cascade
  layers in order, prefixes every selector with `.pj-root`, turns `@property`
  registrations into scoped defaults, renames keyframes to `pj-*`, converts
  `rem` to `px` and fails if anything escapes the root. Render everything inside
  `ScopedRoot` (`<ScopedRoot colorMode="dark">` adds `pj-dark`, which drives the
  `dark:` variant).
- Colors come from `--pj-*` tokens via `pj:bg-background`,
  `pj:text-muted-foreground`, `pj:text-added`, … `cn()` in `../lib/utils.ts`
  merges `pj:` classes. The theme is **Projector** (oklch, shadcn token names):
  warm screen-white light and graphite dark neutrals, plus `lens` /
  `lens-foreground` / `lens-muted` (cyan, hue 220), the only chrome accent:
  focus, the selected Select item, active A/B marks, selected rows, the slider
  thumb's dot, open-thread annotation badges and the playing play control.
  Primary stays graphite (light) or screen-white (dark). `pj:inset-shadow-bevel`
  and `pj:shadow-pop` give surfaces their top-edge bevel and overlays their
  shadow.
- The Projector material and accent for these components live in
  `@layer projector` in `../styles/projector.css` (imported by `../theme.css`),
  keyed on the components' `data-slot` hooks, so the component files stay as
  upstream: the 2px lens focus outline, bevelled cards, Select menus, dropdown
  menus and popovers, raised active tabs, the Select's (and a dropdown menu's
  radio) lens dot (on the left, with every item's text equally indented) and
  `control-border` on fields, checkboxes, select triggers and the slider track.
  `control-border` is the control-boundary color (3:1 against background and
  card, WCAG 1.4.11; `pj:border-control-border`); `border` and `input` stay
  decorative hairlines.
- Press: `Button` has no `active:translate-y-px`. Instead one rule in
  `@layer projector` moves the content (element children, not the box) of every
  pressable control 1px down while it is pressed (`:active`) or while the menu,
  popover or listbox it opens is open: buttons, menu and select triggers, toggle
  and segmented items, tabs, the play lens (its face too) and a file button's
  face. Wrap a button's bare text in a `<span>` so it moves with its icon.
  Nothing moves under `prefers-reduced-motion: reduce`.
- Radix portals must stay inside the root: pass `usePortalContainer()` from
  `../lib/portal.ts` as the `container` of any `*.Portal`.
- Only classes that appear in `src/ui/**` (and `packages/host/inspector/src/**`)
  end up in `dist/ui.css`.
- The `hidden` attribute beats display utilities (`.pj-root [hidden]` in
  `../theme.css`), so `hidden` panels stay hidden.

## Updating from upstream

Run `npm run tools -- update shadcn --check` (from the repository root) now and
then, or before taking a shadcn/ui fix: it reports which components changed
upstream and writes nothing. To update, run `npm run tools -- update shadcn`
(`--dry-run` to preview, `--version x.y.z` for a release other than the latest).
It needs the network, so `tools fix` never runs it. The work is done by
[`scripts/shadcn/update.mjs`](../../../scripts/shadcn/update.mjs), which also
runs on its own (`--help`). For each component it transforms the pristine base
and the new item into our form and three-way merges our file against them with
`git merge-file`. It then replaces the base and manifest and bumps the release
in the headers, `index.ts`, this README and `LICENSE.shadcn.txt`. Mechanical
changes never conflict, so a conflict means upstream changed a line we edited.
Resolve its diff3 markers (ours, base, upstream) by keeping upstream's change
and reapplying our edit, and update the header if the edit itself changes. Then
run the checks under "Adding a component", step 4. Keep each Tailwind class list
on one line, as upstream writes it, so the line-based merge stays precise.

The registry serves only the build deployed from shadcn-ui/ui `main`, and tags
don't contain built items. The script takes the items from the registry and uses
the GitHub API to check that no input of the radix-vega build has changed since
the release's tag. If one has, it stops; `--unreleased` takes the items as
`<version>+<main sha>`.

## Adding a component

1. Run `npm run tools -- update shadcn <name>`. It writes the transformed
   `<name>.tsx` and its base at the release in `upstream/manifest.json`.
2. Make any genuine edit, for example route portals through
   `usePortalContainer()` with a `// local:` comment, and list it in the header.
   Add it to `genuineEdits` in `../../../test/shadcn.test.mjs`, which checks
   that every file is its transformed base plus those edits.
3. Install its Radix package into the host workspace, check its license and
   export it from `index.ts`. `build/ui-notices.mjs` picks up new runtime
   dependencies for apps' third-party notices.
4. Run `npm run build -w @githubnext/projections-host` (the CSS scope check runs
   as part of it) and the embedding test:
   `cd host && npx vite build && npx playwright test embed`.
