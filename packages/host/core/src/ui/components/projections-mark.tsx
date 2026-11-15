import * as React from 'react'

import {cn} from '../lib/utils.js'

/** The props of `ProjectionsMark`: an SVG element's, without children, plus its size, tone and accessible name. */
export interface ProjectionsMarkProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  /** Rendered width and height in px; the mark is drawn on a 16px grid, so multiples of 8 stay pixel-aligned. */
  size?: number
  /** `mono` is a single `currentColor`; `two-tone` colors the glass with the theme's lens accent. */
  tone?: 'mono' | 'two-tone'
  /** Accessible name; without it the mark is decorative. */
  title?: string
}

/** The Projections mark: a side-view projector with a solid lens glass (see brand/). */
export function ProjectionsMark({size = 16, tone = 'mono', title, className, ...props}: ProjectionsMarkProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('pj:shrink-0', className)}
      data-projections-mark={tone}
      {...props}
    >
      <path d="M3 6h2.5a.5.5 0 0 1 0 1H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5a.5.5 0 0 1 1 0V12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
      <path fillRule="evenodd" d="M10.5 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
      <path d="M4.5 9h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1ZM3 13h2v1a1 1 0 0 1-2 0v-1Zm8 0h2v1a1 1 0 0 1-2 0v-1Z" />
      <circle cx="10.5" cy="5.5" r="1.25" style={tone === 'two-tone' ? {fill: 'var(--pj-lens, #007798)'} : undefined} />
    </svg>
  )
}
