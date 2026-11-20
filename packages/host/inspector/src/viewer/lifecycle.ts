// The agent viewer page's connection to its server, as a state machine: it long-polls the view state, stops (and keeps
// asking every 2 s) when the server doesn't answer, resumes when it answers again, and gives way to another server
// that answers at its URL. Its reports of what it presents go one at a time, the latest waiting for the one in flight,
// so an older report never arrives after a newer one.
import {defineMachine, emit, ignore} from '@githubnext/projections-machine'
import type {Step} from '@githubnext/projections-machine'
import type {ViewerState} from './state.js'

/** The shown projection's custom renderer build, as the server sends it with the state. */
export interface Build {
  readonly version: number
  readonly phase: string | null
}

/** One answer of the long poll: the state, and the server's instance and build with it. */
export type Answer = ViewerState & {readonly build?: Build}

/** A report of what the page presents; `text` is its body as sent, to skip one that says nothing new. */
export interface Report {
  readonly body: unknown
  readonly text: string
}

/** The page's reports: one in flight at most, and the latest one waiting for it. */
export interface Outbox {
  readonly sending: boolean
  readonly next: Report | null
  /** The last report sent or waiting, to skip one that says nothing new. */
  readonly last: string
}

type Connected = {
  /** The state the page shows, once one has arrived. */
  readonly state: ViewerState | undefined
  readonly instance: string | undefined
  readonly build: Build | undefined
  /** Whether the Inspector is mounted: once the state first shows a projection. */
  readonly mounted: boolean
  readonly outbox: Outbox
  /** How many times the page has asked; each ask is its own long poll. */
  readonly asks: number
}

/** The connection: answering (`live`, with the generation it waits past), `stopped`, `replaced` by another server, or `ended`. */
export type Connection =
  | (Connected & {readonly kind: 'live'; readonly since: number | undefined})
  | (Connected & {readonly kind: 'stopped'})
  | {readonly kind: 'replaced'}
  | {readonly kind: 'ended'}

/** What happens to the connection. */
export type ConnectionEvent =
  | {readonly type: 'answered'; readonly answer: Answer}
  | {readonly type: 'failed'}
  | {readonly type: 'report'; readonly report: Report}
  | {readonly type: 'posted'}
  | {readonly type: 'unmounted'}

/** What the connection asks the page to do. */
export type ConnectionEffect =
  /** A new state: show it; `mount` the Inspector the first time it shows a projection. */
  | {readonly type: 'show'; readonly state: ViewerState; readonly mount: boolean}
  /** The build phase changed. */
  | {readonly type: 'build'}
  | {readonly type: 'stop'}
  | {readonly type: 'resume'; readonly state: ViewerState}
  | {readonly type: 'reload'}
  | {readonly type: 'post'; readonly body: unknown}

/** A long poll: past `since` (at once without one), after `delayMs`. */
export type ConnectionActivity = {
  readonly type: 'poll'
  readonly key: string
  readonly since: number | undefined
  readonly build: number | undefined
  readonly delayMs: number
}

/** How long a stopped page waits before it asks again. */
export const retryMs = 2000

type Next = Connection | Step<Connection, ConnectionEffect>
type Open = Extract<Connection, {kind: 'live' | 'stopped'}>

/** A new answer: another server (which replaces the page), the build, and the state when its generation changed. */
function answered(connection: Open, answer: Answer): Next {
  if (connection.instance !== undefined && answer.instance !== undefined && answer.instance !== connection.instance)
    return emit({kind: 'replaced'}, {type: 'reload'})
  const effects: ConnectionEffect[] = []
  let outbox = connection.outbox
  if (connection.kind === 'stopped') {
    effects.push({type: 'resume', state: answer})
    // What the page reported before may never have arrived: it reports again.
    outbox = {...outbox, last: ''}
  }
  const build = answer.build && answer.build.version !== connection.build?.version ? answer.build : connection.build
  if (build !== connection.build && connection.state) effects.push({type: 'build'})
  const changed = answer.generation !== connection.state?.generation
  const mount = changed && !connection.mounted && Boolean(answer.projection)
  if (changed) effects.push({type: 'show', state: answer, mount})
  const {build: _build, ...state} = answer
  return emit(
    {
      kind: 'live',
      state: changed ? state : connection.state,
      instance: answer.instance,
      build,
      mounted: connection.mounted || mount,
      outbox,
      asks: connection.asks + 1,
      since: answer.generation,
    },
    ...effects,
  )
}

/** A report: sent at once, or waiting (replacing one that waited) while another is in flight; one that says nothing new is skipped. */
function report(connection: Open, {body, text}: Report): Next {
  const {outbox} = connection
  if (text === outbox.last) return connection
  if (outbox.sending) return {...connection, outbox: {sending: true, next: {body, text}, last: text}}
  return emit({...connection, outbox: {sending: true, next: null, last: text}}, {type: 'post', body})
}

/** The report in flight arrived (or failed): the one waiting goes next. */
function posted(connection: Open): Next {
  const {next} = connection.outbox
  if (!next) return {...connection, outbox: {...connection.outbox, sending: false}}
  return emit({...connection, outbox: {...connection.outbox, next: null}}, {type: 'post', body: next.body})
}

const ended = (): Next => ({kind: 'ended'})

/** The viewer page's connection to its server. */
export const viewerConnection = defineMachine<Connection, ConnectionEvent, ConnectionEffect, ConnectionActivity>()({
  states: {
    live: {
      on: {
        answered: (connection, {answer}) => answered(connection, answer),
        // The next ask is answered at once, so a server that answers again is noticed then, not after a long poll.
        failed: ({kind: _kind, since: _since, ...connection}) =>
          emit({...connection, kind: 'stopped', asks: connection.asks + 1}, {type: 'stop'}),
        report: (connection, event) => report(connection, event.report),
        posted,
        unmounted: ended,
      },
      activities: connection => [
        {type: 'poll', key: `poll:${connection.asks}`, since: connection.since, build: connection.build?.version, delayMs: 0},
      ],
    },
    stopped: {
      on: {
        answered: (connection, {answer}) => answered(connection, answer),
        failed: connection => ({...connection, asks: connection.asks + 1}),
        // Nothing the page does reaches a server that doesn't answer.
        report: ignore,
        posted,
        unmounted: ended,
      },
      activities: connection => [
        {type: 'poll', key: `poll:${connection.asks}`, since: undefined, build: connection.build?.version, delayMs: retryMs},
      ],
    },
    replaced: {on: {answered: ignore, failed: ignore, report: ignore, posted: ignore, unmounted: ended}},
    ended: {on: {answered: ignore, failed: ignore, report: ignore, posted: ignore, unmounted: ignore}},
  },
})
