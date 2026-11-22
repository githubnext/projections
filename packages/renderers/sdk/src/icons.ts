import {
  Activity,
  AppWindow,
  ArrowLeftRight,
  Binary,
  Bot,
  Box,
  CircleMinus,
  CirclePlus,
  CircleQuestionMark,
  CircleX,
  Ellipsis,
  Equal,
  Eye,
  EyeOff,
  File,
  Globe,
  Info,
  KeyRound,
  Layers,
  Maximize2,
  Minimize2,
  Puzzle,
  Sparkle,
  Server,
  Shield,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  SquareTerminal,
  TriangleAlert,
} from 'lucide'
import type {IconNode} from 'lucide'
import {partIconSvgs} from './part-icons.generated.js'

/**
 * The icon vocabulary: semantic names a renderer asks for, never a specific
 * glyph. Each is a theme token, `icon-<name>`, whose value is a CSS image
 * (an SVG data URL) that renderers draw as a mask in `currentColor`, so its
 * shape comes from the host and its color from the text beside it. An icon
 * never carries meaning alone: it always accompanies its word.
 *
 * - Changes: `added`, `removed`, `modified`, `renamed`, `moved`.
 * - Severity: `warning`, `error`, `breaking`, `info`, `unknown`.
 * - Compatibility and versions: `additive`, `compatible`, `upgraded`,
 *   `downgraded`, `changed` (changed either way).
 * - Policy and coverage: `enforced`, `unenforced`, `include`, `exclude`,
 *   `visible`, `hidden`, `expand`, `collapse`, `rescoped` (a scope changed
 *   either way), `settings`, `agent`.
 * - Planned actions: `replace`, `redeploy`, `import`, `read`, `blocked`.
 * - Volatile data: `varied`, a volatile value (one an extraction declares may
 *   vary between runs) that changed beyond its tolerance. Neutral, never a
 *   change kind: draw it in the text color beside the change's own status.
 *   `generated`, a value an extractor generated from a recorded basis (a
 *   summary a language model wrote, say): the quiet mark beside every
 *   generated field's name. Neutral, never a change kind.
 * - Subjects, what a section holds, beside its title: `host` (the nodes a
 *   system runs on), `policy`, `workload`, `credential`, `process`, `file`,
 *   `network`, `module` (a loadable extension, such as a kernel module),
 *   `bytecode` (a loaded program, such as BPF), `namespace` (an isolation
 *   boundary or mount), `application` (user-space programs) and `other`.
 * - Projection parts: `extractor`, `comparator`, `renderer`. Their own
 *   drawings, not Lucide's: a dot is the extraction, the same size in all
 *   three; strokes converge on it (extract), two dots sit either side of a
 *   dashed divider (compare), and strokes leave it (render).
 */
export const iconNames = [
  'added',
  'removed',
  'modified',
  'renamed',
  'moved',
  'warning',
  'error',
  'breaking',
  'info',
  'unknown',
  'additive',
  'compatible',
  'upgraded',
  'downgraded',
  'changed',
  'enforced',
  'unenforced',
  'include',
  'exclude',
  'visible',
  'hidden',
  'expand',
  'collapse',
  'rescoped',
  'settings',
  'agent',
  'replace',
  'redeploy',
  'import',
  'read',
  'blocked',
  'varied',
  'generated',
  'host',
  'policy',
  'workload',
  'credential',
  'process',
  'file',
  'network',
  'module',
  'bytecode',
  'namespace',
  'application',
  'other',
  'extractor',
  'comparator',
  'renderer',
] as const

/** A name in the icon vocabulary (`iconNames`); validate untrusted input with `isIconName`. */
export type IconName = (typeof iconNames)[number]
/** The theme token that holds an icon's image, `icon-<name>` (`iconToken`). */
export type IconTokenName = `icon-${IconName}`

/** The theme token that holds an icon's image. */
export function iconToken(name: IconName): IconTokenName {
  return `icon-${name}`
}

/** Whether a value is in the icon vocabulary. */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (iconNames as readonly string[]).includes(value)
}

/** The longest icon token value a host may send (an SVG data URL), in UTF-16 code units. */
export const iconTokenLength = 4096

/**
 * Whether a token value is a valid icon image: `none`, or a `url("data:image/svg+xml,…")`
 * whose data is percent-encoded, so it needs no quoting and can't close the `url()`.
 */
export function isIconValue(value: string): boolean {
  return value === 'none' || (value.length <= iconTokenLength && /^url\("data:image\/svg\+xml,[\w%.~!$&'*+,;=:@/?-]*"\)$/u.test(value))
}

/** An SVG document as a CSS image value, for an icon token. */
export function svgIconValue(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/[()]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}")`
}

function lucide(node: IconNode): string {
  const attributes = (values: Record<string, string | number | undefined>) =>
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ` ${key}="${String(value).replace(/"/gu, '&quot;')}"`)
      .join('')
  const children = node.map(([tag, values]) => `<${tag}${attributes(values as Record<string, string | number | undefined>)}/>`).join('')
  return svgIconValue(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`,
  )
}

const badges = [
  'added',
  'removed',
  'modified',
  'renamed',
  'moved',
  'upgraded',
  'downgraded',
  'changed',
  'replace',
  'redeploy',
  'import',
  'read',
  'blocked',
  'breaking',
] as const
/**
 * The icons drawn as badges, a solid disc with the glyph cut out of it, so they read as marks rather than text: the
 * change kinds (`added` to `moved`, and a version's `upgraded`, `downgraded` or `changed`), the planned actions
 * (`replace` to `blocked`) and `breaking`, which sits beside them in a change's status. Every other icon is an
 * outline glyph: severity, compatibility levels, the policy and coverage notes a comparator adds after a change's
 * status, and `varied`. A note asks for an outline icon of its own, never a change kind's.
 */
export const badgeIconNames: readonly IconName[] = badges
type BadgeIconName = (typeof badges)[number]

/** A badge's disc by default (`--projections-icon-badge`): a solid circle filling the icon's box, as in icons.css. */
export const badgeDiscValue = svgIconValue(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11"/></svg>',
)

/**
 * The mask that draws icon `name` where the SDK's icons.css doesn't apply, such as a host's own UI, exactly as
 * icons.css draws it in a frame: its token (`--projections-icon-<name>`, defined on the element or an ancestor) and,
 * for a badge (`badgeIconNames`), the disc (`--projections-icon-badge`, a circle by default) with the glyph cut out.
 * Camel-cased CSS properties for a style object; give the element a size and a `currentColor` background. A name the
 * theme lacks draws nothing.
 */
export function iconMaskStyle(name: string): Record<string, string> {
  // Without the token, an empty layer rather than no mask, which would paint the whole box.
  const glyph = `var(--projections-icon-${name}, linear-gradient(transparent, transparent))`
  const badge = (badgeIconNames as readonly string[]).includes(name)
  const image = badge ? `${glyph}, var(--projections-icon-badge, ${badgeDiscValue})` : glyph
  return {
    WebkitMaskImage: image,
    WebkitMaskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    ...(badge ? {WebkitMaskComposite: 'xor'} : {}),
    maskImage: image,
    maskSize: 'contain',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    ...(badge ? {maskComposite: 'exclude'} : {}),
  }
}

/**
 * The stroke every badge glyph is drawn with, in the badge's 24-unit box (its disc a circle of radius 11 at its
 * centre): 1.83px at 16px and 1.6px at 14px, heavy enough that the cut reads at text size and light enough that the
 * counters of the ring arrow and the eye stay open.
 */
const badgeStrokeWidth = 2.75

/** The one arrow, pointing right: a shaft 9 long and a head whose legs reach 3.5 back and out. */
const arrowRight: readonly (readonly [number, number])[][] = [
  [
    [7.5, 12],
    [16.5, 12],
  ],
  [
    [13, 8.5],
    [16.5, 12],
    [13, 15.5],
  ],
]

/** The arrow turned a whole number of quarter turns clockwise about the disc's centre, so every arrow is the same shape. */
function arrow(quarterTurns: number): string[] {
  return arrowRight.map(line => {
    const points = line.map(([x, y]) => {
      let point: [number, number] = [x, y]
      for (let turn = 0; turn < quarterTurns; turn++) point = [24 - point[1], point[0]]
      return point
    })
    return `M${points.map(([x, y]) => `${x} ${y}`).join('L')}`
  })
}

/**
 * Each badge's glyph, drawn for its badge rather than scaled from an icon set, so every glyph has the same stroke:
 * strokes (a dot is a stroke of no length) in the badge's own box, no transform, each placed so its ink's bounding
 * box, round caps and joins included, is centred on the disc's centre, (12, 12): the same margin on opposite sides,
 * so an arrow's head points the way it goes rather than being pulled back towards the centre by its weight. The
 * exception is `redeploy`, whose ring is concentric with the disc, its head left where the ring puts it. No glyph's
 * ink comes further than 8 from the centre. Drawn in Lucide's style.
 */
const badgeGlyphs: Record<BadgeIconName, readonly string[]> = {
  added: ['M7.5 12H16.5', 'M12 7.5V16.5'],
  removed: ['M7.5 12H16.5'],
  // A tilde: one wave, its ends level and the same distance from the centre, as in the system fonts' tildes.
  modified: ['M6.5 12.5C8.5 9 10.25 9.5 12 12S15.5 15 17.5 11.5'],
  // A text cursor: renamed, a change to an item's name (moved is the arrow).
  renamed: ['M9.5 7.5H14.5', 'M12 7.5V16.5', 'M9.5 16.5H14.5'],
  moved: arrow(0),
  upgraded: arrow(3),
  downgraded: arrow(1),
  // The arrow with a head at each end: changed either way, beside upgraded and downgraded.
  changed: ['M12 5.5V18.5', 'M8.5 9L12 5.5L15.5 9', 'M8.5 15L12 18.5L15.5 15'],
  // A dashed line: replace, one item swapped for another. Three dashes 4 long, caps included, 2 apart, spanning 16.
  replace: ['M12 5.375V6.625', 'M12 11.375V12.625', 'M12 17.375V18.625'],
  // A ring arrow, clockwise: an arc of radius 5.25 about the disc's centre and, at twelve, an equilateral head of side
  // 2.75 pointing along the ring's tangent, filled by its own stroke (so its corners are rounded uniformly).
  redeploy: ['M17.153 10.995A5.25 5.25 0 1 1 12 6.75', 'M12 5.375L14.382 6.75L12 8.125Z'],
  import: ['M12 7V13', 'M9 10L12 13L15 10', 'M8 17H16'],
  read: ['M5.75 12C5.75 12 8 7.5 12 7.5S18.25 12 18.25 12S16 16.5 12 16.5S5.75 12 5.75 12Z', 'M11.995 12h.01'],
  // A slash: blocked, a no-entry sign whose circle is its badge's disc.
  blocked: ['M7.75 7.75L16.25 16.25'],
  // A crack: breaking, the disc split by a jagged line, point-symmetric about the centre.
  breaking: ['M12.7 3.875L10.3 8.344L14 10.781L10 13.219L13.7 15.656L11.3 20.125'],
}

/**
 * A badge icon's glyph: the disc and the cut are CSS (icons.css), the glyph a mask layer excluded from the disc's, so
 * both stay vectors at any size and density.
 */
function badgeGlyph(name: BadgeIconName): string {
  return svgIconValue(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="${badgeStrokeWidth}" stroke-linecap="round" stroke-linejoin="round">${badgeGlyphs[name].map(d => `<path d="${d}"/>`).join('')}</svg>`,
  )
}

/** The projection parts, drawn by Projections rather than Lucide (`partIconSvgs`, generated from brand/parts). */
type PartIconName = keyof typeof partIconSvgs

/** The Lucide icon (ISC license) drawn for each outline icon by default, the default UI's icon set. */
const lucideIcons: Record<Exclude<IconName, PartIconName | BadgeIconName>, IconNode> = {
  warning: TriangleAlert,
  error: CircleX,
  info: Info,
  unknown: CircleQuestionMark,
  additive: CirclePlus,
  compatible: Equal,
  enforced: ShieldCheck,
  unenforced: ShieldOff,
  include: CirclePlus,
  exclude: CircleMinus,
  visible: Eye,
  hidden: EyeOff,
  expand: Maximize2,
  collapse: Minimize2,
  rescoped: ArrowLeftRight,
  settings: SlidersHorizontal,
  agent: Bot,
  varied: Activity,
  generated: Sparkle,
  host: Server,
  policy: Shield,
  workload: Box,
  credential: KeyRound,
  process: SquareTerminal,
  file: File,
  network: Globe,
  module: Puzzle,
  bytecode: Binary,
  namespace: Layers,
  application: AppWindow,
  other: Ellipsis,
}

const isPartIcon = (name: IconName): name is PartIconName => name in partIconSvgs
const isBadgeIcon = (name: IconName): name is BadgeIconName => badgeIconNames.includes(name)

/** The default value of every icon token: the badge glyphs, Lucide icons and the part icons, the same in light and dark. */
export const defaultIconTokens = Object.fromEntries(
  iconNames.map(name => [
    iconToken(name),
    isPartIcon(name) ? svgIconValue(partIconSvgs[name]) : isBadgeIcon(name) ? badgeGlyph(name) : lucide(lucideIcons[name]),
  ]),
) as Record<IconTokenName, string>
