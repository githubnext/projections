# Host browser suite

The browser suite of `@githubnext/projections-host` drives the workspace's
[Storybook](../../../../tools/storybook/README.md) static build; its harness
stories (`tools/storybook/harness/`) are the pages under test. Run it with
`npm run test:browser -w @githubnext/projections-host`.

The explorer harness is a synthetic four-revision projection: base, first push,
latest push, and the latest push extracted with a changed definition. Its
controls cover every domain schema (each with its dedicated built-in renderer),
the `minimal` example renderer, an unavailable renderer, and the default
comparator or the priority-order comparator file (`comparator=priority`).
`tools/storybook/scripts/serve.mjs` serves the build with a production-like page
policy and the renderer policy on renderer bundles. Query parameters on the
story URL (`iframe.html?id=harness-default-ui--explorer&viewMode=story&…`:
`schema`, `renderer` (`minimal`, `none` or `hostile` instead of the schema's
renderer), `mode` (`side-by-side`, `animated`, `swipe` or `diff`; without it the
renderer's default, diff when supported, else side by side; the hostile
renderer's `probe=diff` declares diff and animated, and `probe=paired` side by
side and swipe), `connector` (turns the side by side connector on),
`loop=false`, `holds` (`timeline` or `pause`), `controlled` (the page owns
progress, playback, mode and divider), `comparator`, `before`, `after`,
`single`, `view`, `presentation`, `defaults` (JSON for the definition's
`presentation` block), `lateCatalog` (mounts the view before the renderer
catalog loads), `width` (sizes the view so its toolbar is that many pixels wide;
`browser/toolbar-layout.spec.ts` sweeps it), `details=none` (no detail card) and
`evidenceLinks` (links each evidence location to
`https://example.test/<side>/<path>#L<line>`)) select a scenario.
`renderer=hostile&probe=…` loads the misbehaving renderer the tests use
(`tools/storybook/test-renderers/hostile/`).

The browser suite runs on Chromium and WebKit, desktop and mobile. It checks:

- Sandbox attributes and the response policies.
- That no request of any kind from a renderer reaches the server, verified by a
  server-side probe log.
- That forged and foreign messages are ignored.
- That flooding and navigating renderers are stopped.
- Open requests, progress acknowledgement, and flow control against a slow
  renderer.
- That the table and text views are equivalent.
- Shared selection, and the pair picker with the default comparator and with the
  priority-order comparator file.
- Definition mismatch explanations, renderer labels and the explicit fallback.
- Reduced motion, playback endpoints, keyboard focus moving into and out of the
  frame, all seven domain schemas, dark mode and page overflow.
- Comparison modes: shared selection and hover, the counterpart pulse (none
  under reduced motion), annotations in both panes, no connector unless opted in
  (`panes.spec.ts`), the swipe divider by pointer and keyboard, and scroll
  mirroring.
- The dense layout (`dense.spec.ts`): the planned toolbar at 1440×900 and on an
  iPhone 13 (two rows only for animated playback), the stage at least 80% of the
  view's height, the collapsed forms' popovers and More, and their keyboard
  semantics.
- The toolbar's layout rules (`toolbar-layout.spec.ts`): a sweep of toolbar
  widths from 1600 to 320px in animated and side by side modes and the animated
  table view (at most two rows, a full-width slider in the second, no empty
  fragments, row 1 collapsing nothing while it has room, no overlap or clipping,
  slider minimums, the slider's thumb clear of the toolbar's edge at both ends,
  every control 32px tall, a gap below the toolbar, every control reachable),
  the one/two-row hysteresis, and mode icons distinct from the playback icons.
- Renderer controls, host settings and definition defaults.
- Core-only usage (`core.spec.ts`; the core-only story takes `fill`, `mode`
  (`animated` or `swipe`) and `paneLabels` (`chips` or `hidden`)), pane bands
  and chips (`pane-labels.spec.ts`), and no style leakage in either direction
  for an embedded default UI (`embed.spec.ts`).
- The headless fit plan's interaction lifecycle (`fit-plan.spec.ts`, on the Fit
  plan story, which takes `lock`): focus following a control a new plan remounts
  or moves into an overflow, and no replanning between a press and its click.
