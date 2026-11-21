// The host messages a renderer receives: its handlers, and the state replayed to a client that connects again.
import type {
  AnnotationMark,
  HostMessage,
  InitPayload,
  ProgressPayload,
  RendererEnvironment,
  RendererOptions,
  ScrollPosition,
} from '../protocol.js'

type Of<T extends HostMessage['type']> = Omit<Extract<HostMessage, {type: T}>, 'type'>

/** Handlers for host messages. Each is optional; unknown or foreign messages never reach them. */
export interface RendererHandlers {
  /**
   * The document to present and the environment, first after `ready` and again whenever the host replaces the
   * document; reset any per-document state.
   */
  init?(message: InitPayload): void
  /** A new position to draw; acknowledge it with `client.rendered` once painted. */
  progress?(message: ProgressPayload): void
  /** The host's selection: an item ID or `null`, and optionally a property of it (`path`, an RFC 6901 pointer). */
  select?(message: Of<'select'>): void
  /** Markers to draw on items, replacing earlier ones (capability `annotations`). */
  annotations?(items: AnnotationMark[]): void
  /** New settings, replacing the earlier ones: declared controls' values by `id` (see `controlValues`). */
  options?(options: RendererOptions): void
  /** The frame's size in CSS px, on load and whenever it changes. */
  viewport?(message: Of<'viewport'>): void
  /** A new theme, motion preference, locale, pane or sizing; `applyEnvironment` applies it to CSS. */
  environment?(message: RendererEnvironment): void
  /** The entity the person points at in any pane, or `null` (capability `hover`). */
  hover?(message: Of<'hover'>): void
  /** Scroll a container to mirror another pane (capability `scrollSync`); don't report that scroll as `viewport`. */
  scroll?(position: ScrollPosition): void
  /** The person activated one of the renderer's `action` controls. */
  action?(message: Of<'action'>): void
  /** The host's find and "changes only" settings changed. */
  filter?(message: Of<'filter'>): void
}

/** Host messages that set state, in the order a reconnecting client replays them. */
export const replayed = ['init', 'environment', 'options', 'viewport', 'select', 'annotations', 'hover', 'filter', 'progress'] as const

/**
 * The latest state-setting host message of each type, per document and
 * channel. A client that connects again in the same document, as a renderer
 * does when a development server's hot update remounts it, is replayed the
 * host's current state instead of waiting for an `init` the host has already
 * sent. The host sees only a repeated `ready`, which it ignores.
 */
const sessions = new WeakMap<Window, {channel: string; messages: Map<HostMessage['type'], HostMessage>}>()

/** The document's session on `channel` (a new one for another channel), and the state to replay from it. */
export function resumeSession(view: Window, channel: string) {
  let session = sessions.get(view)
  const replay = session?.channel === channel && session.messages.has('init') ? [...session.messages] : []
  if (session?.channel !== channel) {
    session = {channel, messages: new Map()}
    sessions.set(view, session)
  }
  return {messages: session.messages, replay}
}

/** The generation of each `init` payload handed to a renderer, so a paint of it echoes its own. */
const generations = new WeakMap<InitPayload, number>()

/**
 * What a renderer's `rendered` echoes (see `HostMessage`): the generation of the `init` it painted when it says which,
 * else the latest `init`'s; nothing when that had none.
 */
export function echoedGeneration(latest: HostMessage | undefined, painted?: InitPayload): {generation?: number} {
  const generation = painted ? generations.get(painted) : latest?.type === 'init' ? latest.generation : undefined
  return generation === undefined ? {} : {generation}
}

/** Hands a host message to its handler, as the handler's own payload. */
export function dispatch(handlers: RendererHandlers, message: HostMessage) {
  switch (message.type) {
    case 'init': {
      const {type: _type, generation, ...payload} = message
      if (generation !== undefined) generations.set(payload, generation)
      handlers.init?.(payload)
      break
    }
    case 'progress':
      handlers.progress?.({progress: message.progress, highlighting: message.highlighting, direction: message.direction})
      break
    case 'select':
      handlers.select?.({id: message.id, ...(message.path === undefined ? {} : {path: message.path})})
      break
    case 'annotations':
      handlers.annotations?.(message.items)
      break
    case 'options':
      handlers.options?.(message.options)
      break
    case 'viewport':
      handlers.viewport?.({width: message.width, height: message.height})
      break
    case 'environment':
      handlers.environment?.({
        theme: message.theme,
        reducedMotion: message.reducedMotion,
        locale: message.locale,
        ...(message.pane === undefined ? {} : {pane: message.pane}),
        ...(message.sizing === undefined ? {} : {sizing: message.sizing}),
      })
      break
    case 'hover':
      handlers.hover?.({id: message.id})
      break
    case 'scroll':
      handlers.scroll?.({x: message.x, y: message.y, ...(message.key === undefined ? {} : {key: message.key})})
      break
    case 'action':
      handlers.action?.({id: message.id})
      break
    case 'filter':
      handlers.filter?.({
        query: message.query,
        changesOnly: message.changesOnly,
        ids: message.ids,
        ...(message.scope === undefined ? {} : {scope: message.scope}),
      })
      break
  }
}
