// The frame a renderer runs in: protocol version and limits, envelope, environment, fragment and content security policy.
import type {KindColor} from '@githubnext/projections-schemas'

/**
 * Renderer frame protocol, version 0.
 *
 * A renderer is a static web bundle that the host loads into
 * `<iframe sandbox="allow-scripts">` (an opaque origin) served with a content
 * security policy that includes `connect-src 'none'`. The host and the
 * renderer exchange `postMessage` envelopes that carry the protocol tag and a
 * per-frame channel nonce, which the host passes in the frame URL fragment.
 */
export const rendererProtocolVersion = 0 as const

/** Bounds the host enforces on renderer-to-host messages. */
export const rendererLimits = {
  /** Bounds of a declared `pace.stepMs`. */
  paceStepMs: {min: 300, max: 5000},
  /** Largest renderer-to-host message, measured as UTF-16 code units of its JSON. */
  messageBytes: 64 * 1024,
  /** Sustained renderer-to-host messages per second; a burst of this size is allowed. */
  messagesPerSecond: 240,
  /** Longest selection ID, file path or error message. */
  textLength: 4096,
  /** Most step boundaries a renderer may declare. */
  steps: 1000,
  /** Bounds of a reported content `aspect` ratio (width / height). */
  aspect: {min: 0.01, max: 100},
  /** Requested frame height bounds, in CSS pixels. */
  minHeight: 120,
  maxHeight: 20000,
  /** Most declared controls, and most choices per control. */
  controls: 32,
  choices: 50,
  /** Most matching IDs a host sends in one `filter`; beyond this it sends `null` and only the query. */
  filterIds: 20000,
  /** Most theme tokens a host may send. */
  themeTokens: 256,
  /** Longest theme token value, except icon tokens (`iconTokenLength`). */
  tokenLength: 512,
  /** Most annotated items in one `annotations` message. */
  annotations: 10000,
  /** Longest annotation label. */
  annotationLabel: 64,
  /** Largest annotation count. */
  annotationCount: 1_000_000,
  /** Most legend items, and the longest legend label or title. */
  legendItems: 24,
  legendLabel: 64,
  /** Most figures in one `summary`, and the longest summary noun or kind. */
  summaryItems: 32,
  summaryNoun: 64,
  summaryKind: 256,
  /** Most item IDs one summary fact filters to. */
  summaryFactIds: 1000,
  /** Longest summary fact description. */
  summaryDescription: 256,
  /** Largest absolute anchor or scroll coordinate, in CSS pixels. */
  maxCoordinate: 1_000_000,
  /** Time the host waits for `ready` after the frame loads, in milliseconds. */
  readyTimeoutMs: 10_000,
  /** Time a renderer waits for the host's `document` after a `document-request`, in milliseconds. */
  documentTimeoutMs: 10_000,
} as const

/**
 * The fields every protocol message carries. A message whose version or channel doesn't match is not part of this
 * conversation, and both sides ignore it.
 */
export interface Envelope {
  /** The protocol version, `rendererProtocolVersion`. */
  projections: typeof rendererProtocolVersion
  /** The frame's channel nonce from the URL fragment: 16 to 128 letters, digits, `_` or `-`. */
  channel: string
}

/** Whether the host is in light or dark mode; renderers draw in the same mode. */
export type ColorMode = 'light' | 'dark'

/**
 * Host theme. Tokens are CSS values keyed by name without the leading
 * dashes, for example `{"color-fg": "#1f2328"}`; `applyEnvironment` exposes
 * them to renderer CSS as `--projections-<name>`.
 */
export interface RendererTheme {
  /** The host's color mode, which `applyEnvironment` sets as the document's `color-scheme`. */
  colorMode: ColorMode
  /**
   * Token values by name, at most `rendererLimits.themeTokens`, each at most `rendererLimits.tokenLength` characters;
   * `icon-*` tokens hold icon values (`isIconValue`). Read them through `resolveThemeTokens`, which fills in defaults.
   */
  tokens: Record<string, string>
  /** The token set the host follows (`themeTokenSetVersion`). Missing tokens fall back to that set's defaults. */
  version?: number
}

/** The projection a renderer presents, as `init` names it. */
export interface RendererProjection {
  /** The projection definition's ID, stable across documents of the same projection. */
  id: string
  /** The definition's title, for headings and accessible names. */
  title: string
  /**
   * The definition's renderer: its renderer name (for example
   * `graph-horizontal`), or the bundle path of a custom renderer. A bundle that
   * handles several names uses it to choose a variant.
   */
  renderer: string
  /**
   * How the definition presents extraction kinds (`presentation.kinds`), keyed by kind: a color for renderers that
   * color items by kind (a meaning or a categorical hue, painted with theme tokens) and the summary bar's noun. Hosts
   * send it when the definition sets it; renderers ignore kinds they don't draw.
   */
  kinds?: Record<string, RendererKind>
}

/** How the definition presents one extraction kind (see `RendererProjection.kinds`). */
export interface RendererKind {
  /** The kind's color: a meaning or a categorical hue, which renderers paint with theme tokens. */
  color?: KindColor
  /** The kind's noun for counts, for example `{singular: 'service', plural: 'services'}`. */
  noun?: {singular: string; plural: string}
}

/**
 * The host's presentation context: theme, motion preference, locale and frame role. `init` carries it and
 * `environment` replaces it; `applyEnvironment` exposes it to CSS.
 */
export interface RendererEnvironment {
  /** The host's theme tokens and color mode. */
  theme: RendererTheme
  /**
   * Whether the person prefers reduced motion: skip the renderer's own animations (pulses, eased transitions) and draw
   * each `progress` as it arrives. `applyEnvironment` marks it as `data-reduced-motion`.
   */
  reducedMotion: boolean
  /** BCP 47 locale for formatting, for example `en-US`. */
  locale: string
  /**
   * Set while the frame is one held pane of a two-pane comparison mode (side by side or swipe): it shows only the
   * `before` (progress 0) or `after` (progress 1) revision, which the host labels. Narration of the transition, such
   * as step captions, doesn't apply there; omit it. Absent for a single frame (animated, diff or an extraction).
   */
  pane?: 'before' | 'after'
  /**
   * How the host sizes the frame. `content`: it gives the frame the height the renderer reports (`height`, within
   * `rendererLimits`), so content fitted to the frame need only fit its width, from the first paint on, rather than the
   * height the frame has before the host answers. `fill`: it sizes the frame itself, as a tab or pane does, and
   * content fits both dimensions. Absent from hosts that don't say: fit both dimensions.
   */
  sizing?: 'content' | 'fill'
}

/**
 * The URL fragment the host appends to a renderer entry URL: the channel
 * nonce, the host origin and, optionally, the color mode, so the document can
 * match the host's colors before `init` arrives.
 */
export function rendererFragment(channel: string, hostOrigin: string, colorMode?: ColorMode): string {
  return `#${new URLSearchParams({channel, origin: hostOrigin, ...(colorMode ? {color: colorMode} : {})})}`
}

/** Reads the channel nonce, host origin and color mode from a renderer document's URL fragment. */
export function readRendererFragment(hash: string): {channel: string; hostOrigin: string; colorMode?: ColorMode} | undefined {
  const params = new URLSearchParams(hash.replace(/^#/u, ''))
  const channel = params.get('channel')
  const hostOrigin = params.get('origin')
  if (!channel || !/^[\w-]{16,128}$/u.test(channel) || !hostOrigin) return undefined
  const color = params.get('color')
  return {channel, hostOrigin, ...(color === 'light' || color === 'dark' ? {colorMode: color} : {})}
}

/**
 * Content security policy for renderer documents. Serving layers send it as
 * a response header with every renderer bundle's `index.html`. A bundle is a
 * single self-contained document: scripts and styles are inline and other
 * assets are data or blob URLs, so the policy grants no source at all, not
 * even `'self'`, and the document load is the only request a renderer causes.
 * The `sandbox` directive keeps the document in an opaque origin even if it
 * is opened outside the host frame.
 */
export const rendererContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'worker-src blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'sandbox allow-scripts',
].join('; ')

/**
 * The same policy for a `<meta http-equiv>` element, which cannot carry the
 * `sandbox` directive. Built bundles include it so static hosting without
 * header control still forbids network access; hosts must not rely on it for
 * untrusted bundles.
 */
export const rendererMetaContentSecurityPolicy = rendererContentSecurityPolicy
  .split('; ')
  .filter(directive => !directive.startsWith('sandbox'))
  .join('; ')

/** The only sandbox tokens a host grants a renderer frame. Never add `allow-same-origin`. */
export const rendererSandbox = 'allow-scripts'
