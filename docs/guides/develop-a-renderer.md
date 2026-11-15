# Develop a renderer

A renderer is a static web page that the host runs in a sandboxed frame (see
[the minimal template](../../examples/renderers/minimal/README.md) for how one
works). You develop it against **fixtures**: named scenarios, each a before and
after extraction (or one extraction), that show what the renderer must handle.

With the [renderer kit](../../packages/renderers/kit/README.md), you write one
React component: `src/view.tsx` exports `View`, and `vite.config.ts` names it
with `rendererConfig({view: 'src/view.tsx', name, title, comparisonModes})`,
where the renderer's capabilities are declared once. The build generates the
entry that mounts the view in the kit's shell, writes the same capabilities to
`renderer.json`, and under `npm run dev` remounts the view in place on every
edit. An entry of your own (`entry: 'src/main.tsx'`) is for setups a view can't
express; see the SDK's [Build](../../packages/renderers/sdk/README.md#build).

**Build its diff mode first.** A comparison opens in diff when the renderer has
one, and it is where people review changes: one static picture of the union of
both revisions, in the renderer's own form, with every addition, removal and
change marked in place. Declare `'diff'` first in `comparisonModes` and draw it
with the kit's [diff mode](renderer-kit.md#diff-mode) helpers (`diffModel`,
`changeMark`, `ValueChange`); then add side by side and animated from the same
view. Draw no summary line: the host's summary bar counts each kind and its
changes in the renderer's words, with the facts it names (`nouns` and `facts`,
in the kit's
[summary bar](renderer-kit-components.md#presentation-helpers-and-components)).
`projections init --renderer custom` scaffolds a renderer that does exactly
this, and `projections check` warns about a renderer without a diff mode.

## Install @githubnext/projections

A renderer's one Projections dependency is
[`@githubnext/projections`](../../packages/sdk/README.md), at the same version
as your `projections --version`: the two release together. It is not on npm yet:
npm publishing awaits security approval
([npm publishing](../maintainers/npm-publishing.md)). Each
[GitHub release](https://github.com/githubnext/projections/releases) attaches it
instead, as `githubnext-projections-<version>.tgz` beside the CLI, with a
`.sha256` and a build provenance attestation, and a renderer depends on it by
URL:

```json
"dependencies": {
  "@githubnext/projections": "https://github.com/githubnext/projections/releases/download/v0.1.0/githubnext-projections-0.1.0.tgz"
}
```

`projections init --renderer custom` writes exactly that, for its own version.
To upgrade, change the version in both places in the URL and run `npm install`;
`projections doctor` and `projections check` warn when a renderer's package
isn't the CLI's version.

- **Registries.** npm downloads the tarball from github.com itself, not through
  your registry, then resolves its dependencies (ELK, Lucide, TypeBox and
  others) through your registry as usual: an `.npmrc` that points `registry` at
  a proxy, such as `packagefeedproxy.microsoft.io`, still works, and the
  lockfile records the URL and its integrity. A machine that can reach only the
  proxy needs github.com for this one download, or the submodule below.
- **Policy.** npm's `allow-remote` setting `none` refuses URL dependencies;
  `all` (the default) and `root` allow it, since it is in the renderer's own
  `package.json`.
- **Updates.** `npm outdated` and `npm update` don't see new releases of a URL
  dependency, and Dependabot doesn't update it; the doctor's version warning
  does.

To check a download against its provenance:
`gh attestation verify githubnext-projections-0.1.0.tgz --repo githubnext/projections`.

### Or build it from a Git submodule

If you can't download release assets, add this repository as a Git submodule at
the release's tag, and build and pack the package from it, as the release does:

```sh
git submodule add https://github.com/githubnext/projections vendor/projections
git -C vendor/projections checkout v0.1.0
cd vendor/projections
npm ci
for workspace in packages/schemas packages/renderers/sdk packages/renderers/kit packages/renderers/testing packages/sdk; do
  npm run build --workspace "$workspace"
done
node packages/sdk/scripts/release-asset.mjs ../packs   # npm pack, as the release packs it
```

Then depend on the tarball, relative to the renderer's `package.json`, such as
`"@githubnext/projections": "file:../../../../vendor/packs/githubnext-projections-0.1.0.tgz"`,
or scaffold with `PROJECTIONS_RENDERER_PACKAGES` naming `vendor/packs`, which
`init` then depends on. Rebuild and repack after moving the submodule to another
release. Use the tarball, not `npm link` or a `file:` reference to the `package`
directory: those resolve React and the other peer dependencies from the
submodule's `node_modules`, so a renderer gets two copies.

### With or without React

The [renderer kit](renderer-kit.md) comes with the package; nothing else to
install. Its entries split by framework:

- **With React** (the scaffold's way), add `react` and `react-dom` (19) to the
  renderer's dependencies, and import the model from
  `@githubnext/projections/kit` and the shell, components and hooks from
  `@githubnext/projections/kit/react`. `rendererConfig({view})` imports
  `/kit/react.css` and mounts the view; an entry of your own imports
  `@githubnext/projections/kit/react.css` and calls `mountRenderer`.
- **Without React**, depend on the package and Vite only: React and react-dom
  are optional peers, so npm doesn't install them. Import the framework-free kit
  (`@githubnext/projections/kit`: the comparison model, timeline, layout, diff
  mode, status and colors) and its plain CSS
  (`@githubnext/projections/kit/base.css`), talk to the host with the SDK's
  client (`connectRenderer` from `@githubnext/projections/renderer`, as the
  [minimal template](../../examples/renderers/minimal/README.md) does), put
  `class="pk"` on the root element the kit's styles are scoped to, and build
  with `rendererConfig({entry: 'src/main.ts', …})`. Nothing it loads imports
  React, so the bundle has none.

## 1. Describe scenarios

Put a `scenarios.json` beside your renderer's `package.json`:

```json
{
  "format": "projections.scenarios",
  "version": 0,
  "title": "Service map",
  "renderer": "service-map",
  "scenarios": [
    {
      "id": "payments-split",
      "title": "Payments split out of checkout",
      "before": "fixtures/before.json",
      "after": "fixtures/after.json"
    },
    {
      "id": "one-revision",
      "title": "One revision",
      "extraction": "fixtures/after.json"
    }
  ]
}
```

Each extraction is inline or a path to a JSON file, such as one saved with
`projections show --json`. A scenario can name a renderer bundle instead
(`"renderer": {"bundle": "dist"}`), a custom comparator
(`"comparator": "priority.comparator.yaml"`, or `{"file": ..., "options": {}}`),
presentation defaults and a description. Write scenarios for the cases that are
hard to present: many steps, renames, removals next to additions, long labels,
and one revision. See [the format](../contracts/scenarios.md).

## 2. Open the fixtures workbench

Build the renderer (`npm run build`, or `npm run watch` to rebuild on every
save), then in VS Code run **Projections: Open Renderer Scenarios…** on the
renderer's folder (also in the Explorer's context menu, and the Definition
view's Renderer → Scenarios row), or open the same workbench in a browser:

```sh
npx projections-renderer-workbench --fixtures scenarios.json --renderer .   # npm run workbench in a scaffolded renderer
```

It prints its URL; while `npm run dev` runs, the browser workbench loads the
renderer from its development server with hot updates (VS Code uses the built
bundle). The workbench opens on your scenarios. Pick one in the sidebar; the
main view presents it in the real host view, with playback, step holds,
selection, every comparison mode and the host's table and text views. Switch
light and dark, and preview desktop, tablet and phone widths from the title bar.
Whenever the bundle, the scenarios or a fixture changes, the page reloads them
by itself, so rebuilding is all it takes to see a change. Bundles you pass with
`--renderer` replace built-in renderers of the same name, so you can also work
on a fork of one.

To see the renderer on your projection's real extractions, open the projection's
tab in VS Code. In a trusted workspace you need no watch process there: saving
one of the renderer's sources while its tab is open starts the package's
`npm run watch` in the background (shown as a task, its errors in Problems), the
Definition view's **Renderer** row says whether it is building, built or failed,
and the tab reloads the renderer when the bundle is rebuilt. The watcher stops
once the projection's tabs are closed. The viewer (`projections view --trust`)
rebuilds the projection it shows the same way, and its status line says
**Building renderer…** while it does.

## 3. Run the checks

**Run checks** (⌘E / Ctrl+E) runs the invariants every built-in renderer is held
to against your renderer, and lists each as passed, failed (with what and where)
or skipped:

- **Every change shown in diff mode**, **unchanged items neutral in diff mode**
  and **nothing clipped in diff mode:** the diff draws every changed entity
  differently from an unchanged comparison, leaves everything else exactly as in
  an unchanged comparison of After, and cuts nothing off, at full and phone
  width. Affordances, selection, status text and stable layout are checked in
  diff too.
- **Neutral endpoints:** at progress 0 and 1 nothing is emphasized; every entity
  looks as it does in an unchanged comparison of that revision.
- **No motion inside step holds:** around each hold you report with
  `client.steps(ends)`, and while progress stays there, nothing moves or fades.
- **Per-step highlighting scope:** after each step, only what that step or an
  earlier one changed is emphasized.
- **Affordances inside their unit:** hover and selection rings stay inside the
  card or row they belong to; nested parts are tinted, not outlined.
- **Legend shown once:** at most one legend, and none when the host draws it.
- **No horizontal overflow at phone width:** the document never scrolls sideways
  at 390 px.
- **Colors from the theme**, **text on the type scale** and **spacing, radii and
  borders on the scale:** every painted color is a theme color token in both
  light and dark mode; text uses a font-size token (never under 11 px), the
  theme's font families and weights; padding, margins and gaps are on the space
  scale (or a 1–2 px hairline), and radii and border widths are tokens. The
  kit's components meet them; each failure names the element, the value and the
  nearest token. Mark a subtree that must style itself, such as a data-driven
  heat map, with `data-projections-off-system="<reason>"`: it is left out, and
  listed with its reason.
- **Selection round trip:** clicking an entity reports it, clicking it again or
  the renderer's background clears the selection, and the host's selection is
  shown and can be cleared. Kit renderers get both clears from the kit.

The checks work on any renderer that marks entities with `data-entity-id` (and
units with `data-projections-unit`), as the SDK's interaction helpers do.

## 4. Test it in CI

`@githubnext/projections/testing` runs the same checks from Playwright, in the
same real host frame. A renderer scaffolded with
`projections init --renderer custom` has this already, in
`browser/renderer.spec.ts`, and runs it with `npm test`:

```ts
import {
  expectScenarioToPass,
  openStage,
  scenarioKeys,
  test,
} from "@githubnext/projections/testing";

test.use({ projections: { fixtures: "scenarios.json", renderers: "." } });

for (const key of scenarioKeys("scenarios.json")) {
  test(`${key}: built-in renderer checks`, async ({ page, inspector }) => {
    await expectScenarioToPass(page, inspector, key);
  });
}
```

`openStage` loads a scenario (or extractions you build in the test) and lets you
`seek`, `scrub`, `select` and `hover` with the renderer's acknowledgement of
each painted frame, for your own assertions. The
[minimal template](../../examples/renderers/minimal) has a complete setup and a
GitHub Actions workflow. The tests start `projections serve --stdio --fixtures`
themselves; put `projections` on `PATH` or set `PROJECTIONS_CLI`.

## Develop a custom comparator the same way

The workbench runs a scenario's comparator in the browser, exactly as viewers
do, so you can preview a comparator file against fixture pairs: give the
scenarios a
`"comparator": {"file": "priority.comparator.yaml", "options": {...}}`, open the
workbench, and read the steps in the **Text** view or the **Changes** panel.
Saving the file reloads it. An invalid comparator file is shown with every
problem and its line and column; an invalid comparison with the Engine's
diagnostics.

In VS Code, the Definition view's Comparator row's **Configure…** offers every
`*.comparator.yaml` file in the repository for a projection. Its tabs apply the
edited definition (**Refresh** shows the result with it); **Show committed** in
the tab, or discarding the edit, goes back.

---
