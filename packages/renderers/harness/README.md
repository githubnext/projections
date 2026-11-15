---
description: "The built-in renderers' browser suites and gallery"
---

# Renderer harness

`@githubnext/projections-renderer-harness` (private) runs the built-in
renderers' browser suites and the renderer gallery. Both use the fixtures
workbench of `@githubnext/projections-renderer-testing`
(`projections serve --stdio --fixtures` behind a loopback page) over every
`packages/renderers/<package>/scenarios.json`, serving every built bundle in
`packages/renderers/*` (any package with `"projections": {"renderer": …}`;
unbuilt ones fall back to the Inspector's copies with a warning). Suites drive
its stage page through `@githubnext/projections-renderer-testing`, so renderers
run in the real host frame (`RendererFrame`: sandboxed, opaque origin, renderer
content security policy, flow-controlled progress).

The harness keeps no page of its own: the testing package's stage is the same
one the Inspector's checks and third-party renderer tests use, so there is one
host page to maintain and the built-in renderers are tested exactly the way
authors test theirs.

## Gallery

```sh
npm run gallery -w @githubnext/projections-renderer-harness            # prints the gallery URL
npm run gallery -w @githubnext/projections-renderer-harness -- --port 4400
```

The gallery is the fixtures workbench over every built-in scenario: the real
host view with every comparison mode, light and dark, viewport presets, live
reload when a bundle is rebuilt or a scenario changes, and the **Checks** panel.
`?scenario=<package>/<id>` opens one scenario; add `&mode=side-by-side` or
`&mode=swipe` to start in that mode. Build the workspace first
(`npm run build`): it needs `packages/cli/dist/projections`.

Add scenarios to `packages/renderers/<package>/scenarios.json` (see
[the format](../../../docs/contracts/scenarios.md)). A scenario can name a
custom comparator file, for example
`examples/comparators/priority-order/priority-order.comparator.yaml`, to show
that a renderer follows a comparator's own order.

## Writing a suite

Put Playwright specs in `packages/renderers/<package>/browser/*.spec.ts`. The
harness config finds them; nothing in the harness needs editing. Don't add the
harness to the renderer package's dependencies: the Inspector depends on the
renderer packages, so that would be a workspace cycle. The import resolves
through the workspace's hoisted `node_modules`.

```ts
import {expect, test} from '@playwright/test'
import {extraction, openRenderer, samples} from '@githubnext/projections-renderer-harness/playwright'

test('tables never overlap while scrubbing', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'database', before, after, progress: 0})
  await renderer.scrub(samples(40, {roundTrip: true}), async progress => {
    const boxes = await renderer.frame.locator('[data-entity-id]').evaluateAll(/* … */)
    // invariants at this exact painted frame
  })
})
```

- `openRenderer(page, request)` is `openStage` from the testing package against
  the harness's Inspector, with comparisons computed by the native default
  comparator (`comparatorOptions` passes default comparator options,
  `comparison` supplies your own). See the testing package for the handle
  (`frame`, `seek`, `scrub`, `select`, `hover`, `setOptions`, `action`,
  `setEnvironment`, `setWidth`, `measure`, `state`).
- `compare(before, after, options?)` and
  `extraction(schema, entities, relationships?, metadata?)` help set up specs.
  `compareWithComparator(before, after, rules, options?)` runs a comparator file
  the way hosts do; `priorityOrderRules` is the example
  `examples/comparators/priority-order`.
- `harnessInspector()` is the running Inspector, for the testing package's other
  helpers such as `checkScenario`.

## Running

Build the workspace first (`npm run build`), then:

```sh
npm run test:browser -w @githubnext/projections-renderer-harness            # every suite, 4 projects
npm run test:browser -w @githubnext/projections-renderer-harness -- database/ --project chromium-desktop
```

Projects: Chromium and WebKit, desktop and mobile. Every run starts its own
Inspector on an OS-assigned loopback port. The harness's own suites check that
every scenario opens in the gallery without renderer errors
(`browser/gallery.spec.ts`), that every scenario passes the built-in checks
(`browser/checks.spec.ts`, Chromium desktop; known renderer issues are listed
there with their cause and must keep failing until fixed), and that hover and
selection stay inside their unit for every scenario
(`browser/affordances.spec.ts`).
