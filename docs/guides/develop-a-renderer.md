# Develop a renderer

A renderer is a static web page that the host runs inside a sandboxed frame. If
you want to see the bare minimum required for one to work, start with
[the minimal template](../../examples/renderers/minimal/README.md). As you build
your renderer, you develop it against **fixtures**—named scenarios made of a
before-and-after extraction pair (or a single extraction) that exercise the
cases your view needs to handle.

Most renderers are built with the
[renderer kit](../../packages/renderers/kit/README.md), where you only write a
single React component. You export `View` from `src/view.tsx` and point
`vite.config.ts` at it with
`rendererConfig({view: 'src/view.tsx', name, title, comparisonModes})`, so your
renderer's capabilities live in one place. From there, the build generates the
entry point that mounts your view in the kit's shell, writes those capabilities
to `renderer.json`, and remounts the view in place on every edit during
`npm run dev`. If you have a setup that a single view component cannot express,
you can supply your own entry (`entry: 'src/main.tsx'`); see the SDK's
[Build guide](../../packages/renderers/sdk/README.md#build).

**Start by building diff mode.** When a renderer supports diff mode, comparisons
open in it by default because it is where people actually review changes. Diff
mode shows one static picture of the union of both revisions, rendered in your
renderer's own visual language, with every addition, removal, and modification
marked in place. List `'diff'` first in `comparisonModes` and build it using the
kit's [diff mode helpers](renderer-kit.md#diff-mode) (`diffModel`, `changeMark`,
and `ValueChange`), then layer side-by-side and animated modes on top of the
same view.

Skip drawing your own summary line. The host's summary bar already counts each
kind and its changes using the domain vocabulary and facts you provide via
`nouns` and `facts` (see the kit's
[summary bar documentation](renderer-kit-components.md#presentation-helpers-and-components)).
Running `projections init --renderer custom` scaffolds a renderer wired up this
way, and `projections check` will warn you if a renderer does not provide a diff
mode.

## Install @githubnext/projections

Your renderer only needs one Projections dependency:
[`@githubnext/projections`](../../packages/sdk/README.md). Keep it on the same
version as `projections --version`, since the CLI and package release together.
The package is not on npm yet while security approval is pending (see
[npm publishing](../maintainers/npm-publishing.md)). Instead, each
[GitHub release](https://github.com/githubnext/projections/releases) attaches it
as `githubnext-projections-<version>.tgz` alongside the CLI, complete with a
`.sha256` checksum and a build provenance attestation. Reference it by URL in
`package.json`:

```json
"dependencies": {
  "@githubnext/projections": "https://github.com/githubnext/projections/releases/download/v0.1.0/githubnext-projections-0.1.0.tgz"
}
```

`projections init --renderer custom` writes this entry automatically for its own
version. When you upgrade, update the version in both places in the URL and run
`npm install`. Both `projections doctor` and `projections check` will flag a
mismatch if your renderer's package version drifts from the CLI.

A few practical details to keep in mind with URL dependencies:

- **Registries** — npm fetches the tarball directly from github.com rather than
  your configured registry, then resolves its transitive dependencies (ELK,
  Lucide, TypeBox, and others) through your registry as usual. An `.npmrc` that
  points `registry` at a proxy like `packagefeedproxy.microsoft.io` continues to
  work, and the lockfile records both the URL and its integrity hash. If a
  machine can only reach the proxy, it will need github.com access for this one
  tarball or the submodule setup below.
- **Policy** — npm blocks URL dependencies when `allow-remote` is set to `none`.
  Both `all` (the default) and `root` permit it, since the dependency lives in
  your renderer's own `package.json`.
- **Updates** — `npm outdated`, `npm update`, and Dependabot do not track new
  releases behind a URL dependency, so rely on the version warning from
  `projections doctor` instead.

You can verify a downloaded tarball against its provenance attestation with
`gh attestation verify githubnext-projections-0.1.0.tgz --repo githubnext/projections`.

### Or build it from a Git submodule

If your environment cannot download GitHub release assets, you can vendor this
repository as a Git submodule checked out at the release tag, then build and
pack the tarball the same way a release does:

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

Point your renderer's `package.json` at the resulting tarball using a relative
path—for example,
`"@githubnext/projections": "file:../../../../vendor/packs/githubnext-projections-0.1.0.tgz"`.
You can also scaffold new renderers with `PROJECTIONS_RENDERER_PACKAGES` set to
`vendor/packs` so `init` wires up that dependency automatically. Whenever you
bump the submodule to a new release, rebuild and repack the tarball. Stick to
the packed tarball rather than `npm link` or a `file:` link straight to the
`package` directory, because direct links resolve React and other peer
dependencies from the submodule's `node_modules` and leave your renderer with
two copies of React.

### With or without React

The [renderer kit](renderer-kit.md) ships inside `@githubnext/projections`, so
there is nothing extra to install. Its entry points are split so you can work
with or without React:

- **With React** (the default scaffold): add `react` and `react-dom` (v19) to
  your renderer's dependencies. Import model utilities from
  `@githubnext/projections/kit` and the shell, components, and hooks from
  `@githubnext/projections/kit/react`. When you use `rendererConfig({view})`, it
  automatically imports `/kit/react.css` and mounts your view. If you write a
  custom entry instead, import `@githubnext/projections/kit/react.css` and call
  `mountRenderer` yourself.
- **Without React**: depend only on `@githubnext/projections` and Vite. Because
  React and react-dom are optional peer dependencies, npm skips them. Import the
  framework-free kit (`@githubnext/projections/kit` for the comparison model,
  timeline, layout, diff mode, status, and colors) alongside its plain
  stylesheet (`@githubnext/projections/kit/base.css`). Connect to the host with
  `connectRenderer` from `@githubnext/projections/renderer` (see the
  [minimal template](../../examples/renderers/minimal/README.md)), put
  `class="pk"` on the root element so the kit's scoped styles apply, and build
  with `rendererConfig({entry: 'src/main.ts', …})`. Nothing on this path imports
  React, keeping it out of your bundle.

## 1. Describe scenarios

Create a `scenarios.json` file next to your renderer's `package.json`:

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

Each extraction can be written inline or referenced as a path to a JSON file
(such as output saved from `projections show --json`). Scenarios can also point
directly at a renderer bundle (`"renderer": {"bundle": "dist"}`), attach a
custom comparator (`"comparator": "priority.comparator.yaml"` or
`{"file": ..., "options": {}}`), and include presentation defaults or a
description.

Focus your scenarios on the awkward cases that tend to break layouts: lots of
steps, renames, removals sitting next to additions, long labels, and
single-revision views. For the full schema, see
[the scenarios format](../contracts/scenarios.md).

## 2. Open the fixtures workbench

Build your renderer with `npm run build` (or run `npm run watch` to rebuild on
every save). From VS Code, run **Projections: Open Renderer Scenarios…** on the
renderer's folder—it is also available in the Explorer context menu and from the
Definition view's Renderer → Scenarios row. If you prefer working in a browser,
launch the same workbench from the terminal:

```sh
npx projections-renderer-workbench --fixtures scenarios.json --renderer .   # npm run workbench in a scaffolded renderer
```

The command prints a local URL. While `npm run dev` is running, the browser
workbench loads your renderer from its dev server with hot updates (VS Code
always loads the built bundle). Pick a scenario from the sidebar to see it
inside the real host view, complete with playback, step holds, selection, every
comparison mode, and the host's table and text views. The title bar lets you
toggle light and dark themes and switch between desktop, tablet, and phone
widths. Whenever the bundle, scenarios file, or a fixture changes, the workbench
reloads automatically, so a rebuild is all you need to see your edit. Any bundle
you pass via `--renderer` overrides a built-in renderer of the same name, which
makes it easy to work on a fork.

To test your renderer against your projection's real extractions, open the
projection's tab in VS Code. In a trusted workspace, you do not even need to run
a watcher yourself: saving a renderer source file while the tab is open starts
`npm run watch` in the background as a task (with build errors routed to
Problems). The Definition view's **Renderer** row shows whether it is building,
built, or failed, and the tab reloads as soon as the new bundle is ready. The
watcher stops automatically once you close the projection's tabs. The CLI viewer
(`projections view --trust`) works the same way, displaying **Building
renderer…** in its status line while a rebuild is in progress.

## 3. Run the checks

Press **Run checks** (⌘E / Ctrl+E) to run the same suite of invariants that
every built-in renderer must pass. Each check reports as passed, failed (with
what broke and where), or skipped:

- **Every change shown in diff mode**, **unchanged items neutral in diff mode**,
  and **nothing clipped in diff mode** — Every changed entity must look
  distinctly different from an unchanged comparison, unchanged items must look
  identical to an unchanged comparison of After, and nothing may be clipped at
  either full or phone width. Affordances, selection, status text, and layout
  stability are verified in diff mode as well.
- **Neutral endpoints** — At progress 0 and 1, nothing should be emphasized.
  Every entity should look the same as it would in an unchanged comparison of
  that revision.
- **No motion inside step holds** — Around every hold you report via
  `client.steps(ends)`, nothing should move or fade while progress remains in
  that hold.
- **Per-step highlighting scope** — After any given step, only entities changed
  in that step or an earlier one may be emphasized.
- **Affordances inside their unit** — Hover and selection rings must stay within
  their card or row. Nested parts should be tinted rather than outlined.
- **No change colors inside change colors** — Color only the innermost changed
  elements. A container that displays changes inside it stays neutral.
- **Change hues only through the kit** — A renderer built on the kit never names
  a change hue (`--green`, `--red-soft`, `--projections-color-added`, …). It
  marks the item with its change (`changeMark`: `data-change`, or `pk-region`),
  or a part of one (a value's old and new text, an inserted word) with
  `data-change-hue`, and reads `--pk-change-ink`, `--pk-change-strong`,
  `--pk-change-highlight`, `--pk-region-fill` or `--pk-region-edge`, which
  follow the kit's nesting rule. `npm run check:change-hues` holds this
  repository's renderers to it; a hue that is categorical rather than a change
  is a reasoned entry in `.change-hues.yaml`.
- **Rounded edges drawn over their contents** — A rounded, bordered box whose
  fills reach its corners draws its border again over them (the kit's
  `pk-frame`, or a `Group`), so its corners are never thinner than its sides.
  That border is drawn in the frame's `::after`, so a kit frame's `::after` is
  reserved: a rule may recolor it (its border color and opacity), but anything
  drawn there instead loses to the kit's or moves the edge, and the check fails
  it. Draw a badge or label in an element of its own.
- **Labels centred on their capitals** — A chip, bar or button's text has as
  much room above its capitals as below its baseline. Centring a line box leaves
  it a little high or low, by how the font's ascent, descent and cap height
  compare, and differently in each engine. Put the text in an element of its own
  with the kit's `pk-label` class: a block or flex item, in the text's own font.
  It trims the text's box to its capitals and baseline and pads it back to its
  line height, so whatever centres it centres the capitals. Extra room goes in
  `--pk-label-inset`.
- **Legend shown once** — Render at most one legend, and omit it altogether when
  the host already draws one.
- **No horizontal overflow at phone width** — The page must never scroll
  horizontally at 390 px.
- **Colors from the theme**, **text on the type scale**, and **spacing, radii
  and borders on the scale** — Every painted color must come from a theme color
  token in both light and dark modes. Text must use a font-size token (never
  smaller than 11 px) along with the theme's font families and weights. Padding,
  margins, and gaps must sit on the spacing scale (or be a 1–2 px hairline), and
  radii and border widths must use tokens. The kit's components satisfy these
  rules automatically, and any failure points to the offending element, its
  computed value, and the nearest token. If a subtree genuinely needs custom
  styling—such as a data-driven heat map—mark it with
  `data-projections-off-system="<reason>"` so the check skips it and lists your
  reason.
- **Selection round trip** — Clicking an entity must report it to the host,
  clicking it again or clicking the background must clear the selection, and
  selections pushed from the host must display and clear cleanly. Renderers
  built with the kit get both clear behaviors out of the box.

These checks work on any renderer that marks entities with `data-entity-id` and
units with `data-projections-unit`, which the SDK's interaction helpers add for
you.

## 4. Test it in CI

You can run the exact same checks in Playwright inside the real host frame using
`@githubnext/projections/testing`. Renderers created with
`projections init --renderer custom` come preconfigured with this in
`browser/renderer.spec.ts` and run it via `npm test`:

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

For custom assertions, `openStage` loads a scenario (or extractions you build in
your test) and exposes `seek`, `scrub`, `select`, and `hover`, each waiting for
the renderer to acknowledge the painted frame before resolving. See the
[minimal template](../../examples/renderers/minimal) for a full setup including
a GitHub Actions workflow. The test harness starts
`projections serve --stdio --fixtures` on its own, so make sure `projections` is
on your `PATH` or set `PROJECTIONS_CLI`.

## Develop a custom comparator the same way

The workbench executes a scenario's comparator right in the browser, just as
viewers do, which makes it a convenient place to iterate on comparator rules
against fixture pairs. Point a scenario at your file with
`"comparator": {"file": "priority.comparator.yaml", "options": {...}}`, open the
workbench, and inspect the resulting steps in the **Text** view or the
**Changes** panel. Saving the file reloads the comparison automatically. If the
comparator file has syntax or schema issues, the workbench lists every problem
with its line and column; if the resulting comparison is invalid, it shows the
Engine's diagnostics.

In VS Code, clicking **Configure…** on the Definition view's Comparator row
lists every `*.comparator.yaml` file in your repository. Open tabs pick up your
edits right away (click **Refresh** to see the updated comparison), and you can
return to the committed version at any time with **Show committed** or by
discarding your edits.

---
