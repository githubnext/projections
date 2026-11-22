import {useLayoutEffect, useState} from 'react'
import type {IconName} from '@githubnext/projections-renderer-sdk/protocol'

/**
 * An icon from the host's icon vocabulary (the SDK's `iconNames`): a
 * `data-icon` element the SDK's `icons.css` draws as a mask of the theme token
 * `--projections-icon-<name>` in `currentColor`, 1em square. It is hidden from
 * assistive technology: always put the word it stands for beside it.
 */
export function Icon({name, className}: {name: IconName; className?: string}) {
  return <span className={`pk-icon${className ? ` ${className}` : ''}`} data-icon={name} aria-hidden="true" />
}

/** The image layers `icons.css` masks an icon with, resolved in the document: its glyph, then its badge disc if it is a badge. */
const resolvedLayers = new Map<string, string[]>()
function iconLayers(name: IconName): string[] {
  if (typeof document === 'undefined' || !(document.body as HTMLElement | null)) return []
  // Tokens change only when the host's environment does, which rewrites the root's style.
  const key = `${name}\n${document.documentElement.getAttribute('style') ?? ''}`
  const cached = resolvedLayers.get(key)
  if (cached) return cached
  const probe = document.createElement('span')
  probe.setAttribute('data-icon', name)
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none'
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const value = style.getPropertyValue('mask-image') || style.getPropertyValue('-webkit-mask-image')
  probe.remove()
  const layers = [...value.matchAll(/url\(\s*(?:"((?:[^"\\]|\\.)*)"\s*|'((?:[^'\\]|\\.)*)'\s*|([^)\s][^)]*)?)\)/gu)].map(match =>
    (match[1] ?? match[2] ?? match[3] ?? '').replaceAll(/\\(.)/gu, '$1').trim(),
  )
  if (resolvedLayers.size > 200) resolvedLayers.clear()
  resolvedLayers.set(key, layers)
  return layers
}

/**
 * An icon inside SVG: a `size` square whose top-left corner is at `x`, `y`,
 * drawn in the SVG's `color`. It is SVG throughout (a rect in `currentColor`
 * under an SVG mask of the icon's images, which the SDK's `icons.css`
 * resolves from the theme tokens), so it follows every transform the
 * drawing is under: CSS masks inside a `foreignObject` don't in WebKit. A
 * badge is its disc with the glyph cut out.
 */
export function SvgIcon({name, x, y, size, className}: {name: IconName; x: number; y: number; size: number; className?: string}) {
  const [layers, setLayers] = useState<string[]>([])
  // The tokens change only with the host's environment, which rewrites the root's style.
  const environment = typeof document === 'undefined' ? '' : (document.documentElement.getAttribute('style') ?? '')
  useLayoutEffect(() => {
    const resolved = iconLayers(name)
    setLayers(current => (current.join('\n') === resolved.join('\n') ? current : resolved))
  }, [name, environment])
  const [glyph, disc] = layers
  // Definitions in the icon's own box units, so every icon of a name shares one id and frames stay deterministic.
  const id = `pk-icon-${name}`
  const image = (href: string, white: boolean) => (
    <image
      href={href}
      x="0"
      y="0"
      width="1"
      height="1"
      preserveAspectRatio="xMidYMid meet"
      {...(white ? {filter: 'url(#pk-icon-white)'} : {})}
    />
  )
  return (
    <g className={`pk-svg-icon${className ? ` ${className}` : ''}`} data-icon={name} aria-hidden="true">
      {glyph && (
        <>
          <defs>
            {/* Images are black shapes on transparent: white where the icon paints, black where a badge's glyph cuts out. */}
            <filter id="pk-icon-white" x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
            </filter>
            <mask id={id} maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1">
              {disc ? (
                <>
                  {image(disc, true)}
                  {image(glyph, false)}
                </>
              ) : (
                image(glyph, true)
              )}
            </mask>
          </defs>
          <rect x={x} y={y} width={size} height={size} fill="currentColor" stroke="none" mask={`url(#${id})`} />
        </>
      )}
    </g>
  )
}
