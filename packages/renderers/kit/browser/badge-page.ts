// The badge page's script (badges.spec.ts bundles it): every badge icon at each size, once as the kit's `Icon` (a CSS
// mask) and once as its `SvgIcon` (an SVG mask), at whole CSS pixels in the page's text color.
import {createElement as h, Fragment} from 'react'
import {flushSync} from 'react-dom'
import {createRoot} from 'react-dom/client'
import type {IconName} from '@githubnext/projections-renderer-sdk/protocol'
import {Icon, SvgIcon} from '../src/react/icons.js'

export interface BadgeCell {
  name: IconName
  kind: 'icon' | 'svg-icon'
  size: number
  x: number
  y: number
}

declare global {
  interface Window {
    showBadges: (cells: BadgeCell[]) => void
  }
}

const root = createRoot(document.getElementById('root')!)
globalThis.showBadges = cells =>
  flushSync(() =>
    root.render(
      h(
        Fragment,
        null,
        ...cells
          .filter(cell => cell.kind === 'icon')
          .map(cell =>
            h(
              'div',
              {
                key: `${cell.name}-${cell.size}`,
                style: {position: 'absolute', left: cell.x, top: cell.y, display: 'flex', fontSize: cell.size, lineHeight: 0},
              },
              h(Icon, {name: cell.name}),
            ),
          ),
        h(
          'svg',
          {key: 'svg', style: {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, width: 1, height: 1},
          ...cells
            .filter(cell => cell.kind === 'svg-icon')
            .map(cell => h(SvgIcon, {key: `${cell.name}-${cell.size}`, name: cell.name, x: cell.x, y: cell.y, size: cell.size})),
        ),
      ),
    ),
  )
