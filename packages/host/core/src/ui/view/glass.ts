/**
 * Whether the stage's overlays can be glass: a translucent fill blurred behind (`backdrop-filter`). Not where the
 * browser lacks it, nor in WebKit (Safari, and every iOS browser), which doesn't blur a renderer's iframe behind an
 * overlay: its content would show through sharp and hurt the overlay's contrast, so the fill stays solid there.
 */
export function glassSupported(agent = globalThis.navigator?.userAgent ?? ''): boolean {
  const css = globalThis.CSS
  if (!css?.supports('backdrop-filter', 'blur(1px)') && !css?.supports('-webkit-backdrop-filter', 'blur(1px)')) return false
  // Desktop Chromium names itself (`Chrome/`, `Edg/`); Chrome, Edge and Firefox on iOS are WebKit (`CriOS/`, `EdgiOS/`, `FxiOS/`).
  return !(agent.includes('AppleWebKit') && !/Chrome\/|Chromium\/|Edg\//.test(agent))
}

/** The glass's fill, as a share of its surface: muted text on it keeps at least 4.5:1 over a busy drawing. */
const glassFill = 70
/** What the glass blurs behind it. */
export const glassBackdrop = 'blur(8px) saturate(1.2)'

/**
 * The stage's overlays' fill and backdrop (`--ph-utility-bg`, `--ph-utility-backdrop`): glass where it is supported
 * (`glassSupported`), else the solid surface.
 */
export function overlaySurface(glass: boolean): {'--ph-utility-bg': string; '--ph-utility-backdrop': string} {
  return glass
    ? {
        '--ph-utility-bg': `color-mix(in oklab, var(--pj-surface-header) ${glassFill}%, transparent)`,
        '--ph-utility-backdrop': glassBackdrop,
      }
    : {'--ph-utility-bg': 'var(--pj-surface-header)', '--ph-utility-backdrop': 'none'}
}
