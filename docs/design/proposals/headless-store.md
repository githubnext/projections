# Proposal: a framework-agnostic projection store

Status: **Proposal.** It builds on the machine package
(githubnext/projections#110), the playback machine (#115) and the status events
(#122). It does not change the renderer protocol or the public
`ProjectionController`.

## Why

The host core is headless in the sense that it draws nothing: `useProjection`
returns a `ProjectionController`, and a host draws its own controls around
`ProjectionStage`. But every piece of it is a React hook. `useProjection`
composes about thirty hooks across `packages/host/core/src/projection/`:
controllable settings, the playback loop, filtering, selection, anchors, pane
state, renderer payloads and the stage binding. A host written in Vue, Svelte,
Lit or plain DOM can reuse the core's pure modules (the comparison, the renderer
catalog, `RendererFrame`, the view model, the summary, details and targets), but
it has to rewrite the part `useProjection` describes as "the state that must be
correct and secure". That is the part with the most bug history in the
state-machine survey.

Even React hosts pay for it:

- the controller is a snapshot (`controllerRef`), with no subscription, so code
  outside the component tree polls or reads the DOM;
- the orchestration can only be tested through a browser, because it only runs
  inside React's effects.

## The shape

```ts
// @githubnext/projections-host: no React
const projection = createProjection(options) // ProjectionOptions, as today
projection.getSnapshot() // the ProjectionController, actions included; the same object until something changes
projection.getSnapshot().seek(0.5) // every action, unchanged
projection.subscribe(listener) // () => unsubscribe; one notification per settled change
projection.update(options) // new props: controlled values and callbacks, the subject
projection.start() // activate: frames, the person's preferences, reports; restartable after stop()
projection.stop()

const stage = mountStage(element, projection, {labels, paneLabels, fill, renderStatus}) // vanilla DOM (step 6)
stage.update({labels}) // and stage.destroy()

// React: today's API, now an adapter over the same phases
const controller = useProjection(options) // read during render, commit in a layout effect,
// report in an effect, useSyncExternalStore for the version
```

The snapshot is the whole controller, actions included, so a framework adapter
passes one object to its views as React's does.

Vue wraps `subscribe` in a `shallowRef`, Svelte in a `readable`, and Lit in a
reactive controller. Each adapter is about twenty lines. `ProjectionStage`
becomes `mountStage` behind a React component, so the frames and their protocol
stay in one implementation.

## How it's composed

The store is a composition of small parts that follow the state-machine guide
(`docs/guides/state-machines.md`, from #110): pure transitions, effects as data
and activities by key. The actor runs them without React.

| Concern                          | Today                                                                   | In the store                                                                                                                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controllable settings            | `useControllable`, refs and `setInternal`                               | A reducer over the uncontrolled values. `update` delivers controlled values as events; a change becomes a `request` effect that calls `on…Change`, and sets the value only while it is uncontrolled.                                                                        |
| Playback                         | `usePlaybackControl` around `playbackLifecycle` (#115)                  | `playbackLifecycle` itself, run by `createActor`. The store lifts out the React-only runners: `requestPosition` through the settings reducer, the `frames` activity as a `requestAnimationFrame` runner, and the `*Shown` events, sent from `update` and from pane reports. |
| Panes and renderer status        | `useState` of `PaneState` per pane, `rendererState`, and `paint` (#122) | A pane-status machine per pane (loading, ready, failed; rendered progress, capabilities). `onRendererStatusChange` and `onPainted` become its effects, with the same names.                                                                                                 |
| Comparison modes                 | `useComparisonModes`                                                    | A pure function of the declared modes, which the pane machine records, and the chosen mode.                                                                                                                                                                                 |
| Rows, scope, summary, find       | `useRowFilter` and memos                                                | Memoized selectors over the subject and the settings, each recomputed only when its inputs change.                                                                                                                                                                          |
| Selection, hover, anchors        | `useSelection`                                                          | A reducer: select, hover, anchor reports and target resolution.                                                                                                                                                                                                             |
| Renderer payloads, stage binding | `useRendererPayloads`, `useStageBinding`                                | Selectors that `mountStage` reads; the frames report back as events.                                                                                                                                                                                                        |

Derived arrays keep their identity while their inputs do, as the memos do today,
so a snapshot changes only where something changed.

## Timing

Two parts of today's behaviour depend on React's timing, and the store keeps
them:

- **Before paint.** Playback's `*Shown` events and the fit plan's measurements
  run in layout effects, so a change never paints a stale frame. The store runs
  in three phases: `read` derives the controller from the state and the options
  without side effects, so a render may read and discard it; `commit` keeps what
  a shown read used and reconciles playback with it; `report` records what the
  renderers declared and tells the embedder what changed. The React adapter
  reads during render, commits in a layout effect and reports in an effect, as
  the hooks did. `createProjection` runs all three after every change, before
  its listeners hear of it.
- **What a render implies.** A new subject restarted the settings during render
  (the `shownSubject` pattern), and a renderer's declared controls took the
  definition's defaults the same way. `read` derives both from the state it is
  given (`settle`), so the first render of a new subject already shows it
  restarted, and `commit` keeps them. Memos compare first with what the last
  commit used, so a discarded render evicts nothing.
- **Strict Mode.** React replays an effect's setup, cleanup and setup while
  keeping the state it committed, so a store destroyed in cleanup would be
  reused dead by the second setup. Construction is therefore side-effect free:
  `createProjection` starts no timers, frames or subscriptions. A store is
  activated with `start()` and deactivated with `stop()`, which can alternate
  any number of times, as #110's `useMachine` starts and stops its actor. The
  adapter creates the store in a `useState` initializer, calls `start()` in a
  layout effect (so activities run before paint) and `stop()` in its cleanup;
  events sent before it starts wait for it, as `useMachine`'s do. Stopping ends
  the current generation, so events from activities it started are dropped, and
  starting again begins a new one. A vanilla host calls `start()` once and
  `stop()` when it is done.

## Steps, as pull requests

1. **The settings reducer.** The controllable settings' rules (initial values,
   reading, requesting, restarting on a new subject) become framework-free
   functions in `projection/settings-store.ts`, with `createSettingsStore` to
   run them with `subscribe`. `useControllable` runs the same functions in
   component state, so React's timing is unchanged (a new subject still resets
   settings during render). Node tests cover controlled and uncontrolled
   settings without React. Nothing new is exported yet: the public
   `createProjection` arrives in step 5, once its snapshot is the whole
   controller, so its API doesn't churn.
2. **Panes as a machine.** `paneLifecycle` (`pane-lifecycle.ts`): loading until
   the frame is revealed, then ready; failed for good until a new bundle loads;
   each state keeps what the renderer reported. `RendererPane` runs it with
   `useMachine`, and `PaneState` is unchanged. `paint` stays a selector over the
   shown panes, and the Inspector's snapshot page uses it (`paintState`) for its
   readiness. #122's events depend on every shown pane, so they stay derived
   from `rendererStatus` and `paint` until the store composes the panes (step
   5), where they become its effects, with the same names.
3. **Playback without React.** `createPlaybackController`
   (`projection/playback-controller.ts`) drives `playbackLifecycle` with
   `createActor`: the frame loop runs on an injectable scheduler
   (`requestAnimationFrame` by default), the position and playing requests go to
   a host, and `show` sends the `*Shown` events from what the view shows. Like
   the actor, it does nothing until `start()`. `usePlaybackControl` keeps only
   React's part: it creates the controller once, starts it in a layout effect
   and calls `show` after every render. The store composes the controller in
   step 5, with the settings store as its host. Node tests cover playing,
   pausing, seeking, a new subject and a declined play with a hand-stepped
   scheduler.
4. **Selectors and selection.** The row filter (`createRowFilter`) and the
   renderer payloads (`createRendererPayloads`) become framework-free selectors,
   built from one-slot memos (`projection/memo.ts`) so each result keeps its
   identity while its inputs do. Selection is pure functions (`selectionOf`,
   `selectedPaths`, `selectedTarget`, `targetSelection`, and
   `createSelectionReport` for `onSelectionChange`), and the pinned target,
   hover and anchors are one reducer (`interaction`) that `useProjection` runs
   with `useReducer`. #122's events are told by `createStatusEvents`, which
   `useStatusEvents` calls after each commit. The hooks keep only React's part:
   one selector instance per component and the effects that report. The store
   composes these in step 5, where the status events become its effects, with
   the same names.
5. **The adapter.** `createProjection` (`projection/store.ts`) is exported, with
   `ProjectionStore`. It composes the parts of steps 1 to 4: the settings
   reducer, the playback controller run by its actor, the panes, the interaction
   reducer, the declared modes and seeded controls, and the person's preferences
   (`watchMedia`). `derive.ts` reads the controller from them. `useProjection`
   is about twenty lines over the same phases, with `useSyncExternalStore`; the
   per-concern hooks are gone. Node tests drive the store without React. A
   `controllerRef` host that needs to hear of changes uses `createProjection`
   itself; `ProjectionView` keeps its ref.
6. **`mountStage` and a vanilla host.** The stage without React, a Storybook
   story of a plain-DOM host as its conformance check, and `ProjectionStage` on
   top of it.

Each step keeps `ProjectionController` and the browser suites unchanged. Steps 1
to 4 also add node tests for orchestration that only browser specs cover today.

## Not in scope

- The renderer protocol and `RendererFrame`, which are already framework-free.
- The Inspector's extraction orchestration, which has its own coordinator
  (#102).
- The default UI and the VS Code UI, which keep using `useProjection`.
