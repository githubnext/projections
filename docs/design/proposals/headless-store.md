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
projection.getSnapshot() // ProjectionState: today's ProjectionController without `stage` and the methods
projection.subscribe(listener) // () => unsubscribe; one notification per batch of changes
projection.update(options) // new props: controlled values and callbacks, the subject
projection.seek(0.5) // every ProjectionController action, unchanged
projection.start() // activate: timers, frames, subscriptions; restartable after stop()
projection.stop()

const stage = mountStage(element, projection, {labels, paneLabels, fill, renderStatus}) // vanilla DOM
stage.update({labels}) // and stage.destroy()

// React: today's API, now an adapter
const controller = useProjection(options) // createProjection once, update in a layout effect,
// useSyncExternalStore for the snapshot
```

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
  run in layout effects, so a change never paints a stale frame. The React
  adapter calls `update` in a layout effect. A vanilla host calls it
  synchronously, before it draws.
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

1. **The store skeleton.** `createProjection` runs the settings reducer and
   `subscribe`, and `useProjection` keeps its implementation and reads the
   store's settings. Node tests cover controlled and uncontrolled settings
   without React.
2. **Panes as a machine.** The pane-status machine, with #122's events as its
   effects and `paint` as a selector. The Inspector's snapshot page uses it for
   its readiness.
3. **Playback in the store.** `playbackLifecycle` is driven by `createActor`
   inside the store, and `usePlaybackControl` goes.
4. **Selectors and selection.** Rows, scope, summary, payloads and selection
   move into the store; the remaining per-concern hooks go.
5. **The adapter.** `useProjection` becomes `useSyncExternalStore` over the
   store, and `controllerRef` hosts can `subscribe`.
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
