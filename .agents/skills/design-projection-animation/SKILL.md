---
name: design-projection-animation
description: Design, implement and review animated comparisons in the Projections repository's built-in renderers and renderer kit (staged motion, graph transitions, layout, routes, framing, playback). Use when changing transition timing or staging, graph layout or routing during a transition, or when an intermediate scrubbed frame looks wrong. For a custom renderer in another repository, use the `projections` skill that `projections init` writes instead.
metadata:
  internal: "true"
---

# Design a projection animation

An animated comparison must explain the change at **every** progress value, not
just look right at Before and After. Every frame is a pure function of
`progress`; diff emphasis is a separate choice and is gone at both endpoints.
The contracts are in
[renderer frames](../../../docs/contracts/renderer-frames.md), the kit's
[timeline and staged motion](../../../docs/guides/renderer-kit.md#timeline) and
the [graph canvas and geometry](../../../docs/guides/renderer-kit-graphs.md)
guide. Read them, and the code they name in `packages/renderers/kit/src/`
(`timeline.ts`, `stages.ts`, `motion.ts`, `graph-transition/`, `routes/`,
`layout/`), before changing timing.

## 1. Specify the visual sequence

- Name the persistent, entering, leaving and rewired entities, and the order of
  removal, reflow, arrival and rewiring. A temporary layout must not imply a
  relationship, or move a card one way that the final layout immediately
  reverses.
- Treat each intermediate frame as a complete graph. Make room before an
  arrival, then reveal the card **with** its relationships; remove a card and
  its relationships before closing the gap. Keep connected changes in one step
  when splitting them would show a state that never existed.
- Keep stable identities where they are. An entering item fades or scales in at
  its destination; it never travels from an unrelated origin.
- Route at the cards' positions at the **same** progress. Check shaft,
  arrowhead, tail and emphasis together; a route between overlapping cards is
  wrong however good the router is.
- Emphasize only the innermost changes. While a step highlights a change inside
  a card, boundary or group, the container stays neutral (no change fill or
  edge, its status muted); never an amber container around green and red
  parts, in any frame (the `nested-accents` check).

## 2. One clock and a steady frame

- Derive positions, routes, opacity and framing from the one progress value. No
  second wall-clock spring, CSS transition or path animation: playback animates
  progress, and rendering adds no lag after a seek.
- Give structural phases non-overlapping windows, keep exact endpoints and
  reverse symmetry (a reversed comparison draws the same frames), and hold still
  around every step the renderer reports.
- Frame from every layout of the transition, so the view never zooms while one
  card moves. Keep card sizes fixed across progress.
- Keep reduced motion, the host's playback settings and highlighting off
  working.

## 3. Scrub and inspect real frames

A required review step, not an endpoint smoke test:

1. Open a representative comparison in the real host frame: the renderer gallery
   (`npm run gallery -w @githubnext/projections-renderer-harness`, then
   `?scenario=<package>/<id>`) reloads as bundles rebuild. Add a scenario to the
   renderer's `scenarios.json` when none shows the case. Once `npm run build`
   has rebuilt the CLI, it draws single frames too: save a comparison with
   `projections compare … --output c.json`, then
   `projections show --from c.json --progress 0.42 --png /tmp/f42.png`. Keep
   images outside the repository.
2. Find the window where structure changes, then step through it at 0.01, and
   finer at the first bad frame or a phase boundary. Look at each image; a
   smooth-looking Play run or two endpoint images prove nothing.
3. Repeat backwards, jump between distant values, and play it. Repeat at desktop
   and phone width, and pan a scrollable graph rather than assume what is off
   screen is right.
4. In every frame look for colliding cards, needless sideways motion, items
   flying in, stretched or looped routes, detached heads or tails, routes
   through cards, a relationship and its card at different opacity, leftover
   emphasis and zoom or clipping. Compare position and size frame to frame.

When a frame fails, find whether staging, layout, routing, lag or framing caused
it, fix that cause, rebuild and scrub the affected window again.

## 4. Turn the failure into a regression

- Unit-test the transition densely through the failing window, both ways
  (`packages/renderers/kit/test/timeline.test.mjs`, `layout.test.mjs`,
  `routes.test.mjs`): assert the order of reflow and appearance, stable
  destinations, relationship timing and that **visible** cards don't overlap.
  Test the invariant that failed, not that frames were produced.
- Add the fixture pair to the renderer's browser suite. `scrubSuite` in
  `packages/renderers/kit/browser/suite.ts` scrubs a pair densely both ways in
  the real host frame and fails on per-frame issues (`measureFrame`), arrowheads
  off their borders (`contactIssues`), framing changes, emphasis at an endpoint
  and a frame that differs by direction (`scrubFailures`). The renderer checks
  (`neutral-endpoints`, `step-holds`, `highlight-scope`, `stable-layout`) run on
  every scenario.
- Run the focused unit tests, the browser suite
  (`npm run tools -- test <workspace> --browser <project>`, one project at a
  time; see [AGENTS.md](../../../AGENTS.md)), typecheck, and build when the UI
  changed. Report which progress ranges and widths you looked at, and separate
  measured checks from images you actually reviewed.
