import {defaultThemeTokens} from '@githubnext/projections-renderer-sdk/protocol'

type ColorMode = 'light' | 'dark'
type Pair = readonly [light: string, dark: string]

/**
 * The `--pj-*` color tokens in theme.css (the Projector theme, oklch), light then dark. Keep in sync with
 * theme.css; the embed browser test compares the two and test/theme.test.mjs checks their contrast.
 */
export const projectorPalette = {
  background: ['oklch(0.985 0.003 95)', 'oklch(0.175 0.003 265)'],
  foreground: ['oklch(0.22 0.004 265)', 'oklch(0.955 0.004 95)'],
  card: ['oklch(0.998 0.0015 95)', 'oklch(0.21 0.004 265)'],
  'card-foreground': ['oklch(0.22 0.004 265)', 'oklch(0.955 0.004 95)'],
  popover: ['oklch(0.998 0.0015 95)', 'oklch(0.235 0.004 265)'],
  'popover-foreground': ['oklch(0.22 0.004 265)', 'oklch(0.955 0.004 95)'],
  primary: ['oklch(0.255 0.005 265)', 'oklch(0.955 0.004 95)'],
  'primary-foreground': ['oklch(0.985 0.003 95)', 'oklch(0.21 0.004 265)'],
  secondary: ['oklch(0.948 0.004 95)', 'oklch(0.255 0.004 265)'],
  'secondary-foreground': ['oklch(0.255 0.005 265)', 'oklch(0.955 0.004 95)'],
  muted: ['oklch(0.962 0.004 95)', 'oklch(0.235 0.004 265)'],
  'muted-foreground': ['oklch(0.48 0.006 265)', 'oklch(0.72 0.006 265)'],
  accent: ['oklch(0.945 0.005 95)', 'oklch(0.27 0.004 265)'],
  'accent-foreground': ['oklch(0.22 0.004 265)', 'oklch(0.955 0.004 95)'],
  destructive: ['oklch(0.55 0.2 27)', 'oklch(0.66 0.19 25)'],
  'destructive-foreground': ['oklch(0.985 0.003 95)', 'oklch(0.175 0.003 265)'],
  border: ['oklch(0.905 0.005 95)', 'oklch(0.3 0.004 265)'],
  input: ['oklch(0.8 0.006 95)', 'oklch(0.42 0.005 265)'],
  'control-border': ['oklch(0.62 0.006 95)', 'oklch(0.54 0.006 265)'],
  ring: ['oklch(0.52 0.12 220)', 'oklch(0.75 0.12 220)'],
  lens: ['oklch(0.52 0.12 220)', 'oklch(0.75 0.12 220)'],
  'lens-foreground': ['oklch(0.99 0.005 95)', 'oklch(0.18 0.01 265)'],
  'lens-muted': ['oklch(0.965 0.018 220)', 'oklch(0.26 0.035 220)'],
  added: ['oklch(0.52 0.14 150)', 'oklch(0.74 0.16 150)'],
  removed: ['oklch(0.55 0.2 27)', 'oklch(0.7 0.17 25)'],
  modified: ['oklch(0.535 0.12 68)', 'oklch(0.8 0.14 80)'],
  moved: ['oklch(0.52 0.19 295)', 'oklch(0.74 0.14 295)'],
} as const satisfies Record<string, Pair>

/**
 * The surface scale and change fills the default UI shares with renderers: `--pj-<name>` in theme.css, each equal to
 * the renderer token set's `color-<name>` (sRGB hex, light then dark; test/theme.test.mjs keeps theme.css equal).
 * `surface-canvas` (the stage behind cards) < `surface-raised` (a card) < `surface-header` (a header band) and
 * `surface-inset` (a recessed gutter or empty room); `divider` edges and rules them; a change fill (`-muted`) always
 * takes its same-hue edge (`-border`).
 */
export const sharedSurfaceNames = [
  'surface-canvas',
  'surface-raised',
  'surface-header',
  'surface-inset',
  'divider',
  ...(['added', 'removed', 'modified', 'moved'] as const).flatMap(change => [`${change}-muted`, `${change}-border`] as const),
] as const

/** `sharedSurfaceNames` with their light and dark values, from the renderer token set's defaults. */
export const projectorSurfaces = Object.fromEntries(
  sharedSurfaceNames.map(name => [
    name,
    [defaultThemeTokens('light')[`color-${name}`], defaultThemeTokens('dark')[`color-${name}`]] as const,
  ]),
) as Record<(typeof sharedSurfaceNames)[number], Pair>

/**
 * `projectorPalette` under its former name.
 *
 * @deprecated Use `projectorPalette`; the default UI's palette is the Projector theme.
 */
export const shadcnPalette = projectorPalette

/** What the host UI uses beyond the token set's defaults: its own type stacks and control heights. */
const uiTokens = {
  'font-family':
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  'font-family-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  'control-height-sm': '32px',
  'control-height': '36px',
} as const

/** The pop shadow of overlays (`--pj-shadow-pop`), as sRGB hex. */
const shadowPop: Pair = ['0 1px 2px #1a1b1c0f, 0 8px 24px -6px #1a1b1c29', '0 1px 2px #00000066, 0 10px 28px -6px #0000008c']

/**
 * Renderer theme tokens matching the default UI's Projector theme, for
 * `hostTheme(colorMode, shadcnRendererTokens(colorMode))`. Colors are the token set's own defaults, which are the
 * Projector palette as sRGB hex (renderers parse colors, so never oklch): screen and chassis neutrals, the lens for
 * accent and focus, and the retuned change colors. Annotation badges use `color-accent-emphasis` (the lens), never a
 * change color.
 */
export function shadcnRendererTokens(colorMode: ColorMode): Record<string, string> {
  return {...defaultThemeTokens(colorMode), ...uiTokens, 'shadow-lg': shadowPop[colorMode === 'dark' ? 1 : 0]}
}

/** The same tokens under the theme's name. */
export const projectorRendererTokens = shadcnRendererTokens
