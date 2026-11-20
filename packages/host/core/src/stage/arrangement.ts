import {useEffect, useState} from 'react'

/** The size of an element's content box, as it resizes. */
export function useSize(element: {current: HTMLElement | null}): {width: number; height: number} {
  const [size, setSize] = useState({width: Infinity, height: 0})
  useEffect(() => {
    const target = element.current
    if (!target) return
    const observer = new ResizeObserver(([entry]) =>
      setSize(previous => {
        const width = entry?.contentRect.width ?? Infinity,
          height = entry?.contentRect.height ?? 0
        return previous.width === width && previous.height === height ? previous : {width, height}
      }),
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [element])
  return size
}

/** How side by side places its two held panes: left and right, or stacked (before above after). */
export type PaneArrangement = 'columns' | 'stacked'

/** The other arrangement must fit the content this much larger before a stage switches to it, so it never flickers. */
export const arrangementHysteresis = 1.15
/**
 * The geometry `ProjectionStage` lays its panes out with (CSS px): label band, gaps and the stacked connector gutter.
 * `columnGap` is the gutter between left and right panes whose edge has no rule between them (`PaneEdge.between`);
 * with one, they meet at that 1px rule instead (`ruleGap`).
 */
export const paneGeometry = {band: 28, columnGap: 16, ruleGap: 1, rowGap: 20, gutter: 18}

/**
 * The arrangement of side by side's two panes that fits content of shape `aspect` (width / height, as a renderer
 * reports it) at the larger scale in a stage of `width` × `height`: a wide, short graph stacks (each pane gets the
 * full width), a tall one sits left and right. Below `stackBelow` the panes always stack; without an aspect or a
 * height (a content-sized stage) they stay left and right. With `current`, the other arrangement must win by
 * `arrangementHysteresis`, so small resizes and changes in reported shape don't flip it back and forth. `columnGap` is
 * the space between left and right panes: `paneGeometry.columnGap` by default, `ruleGap` where they meet at a rule;
 * `rowGap` and `gutter` are the stacked panes' (see `stackedGapsOf`).
 */
export function paneArrangement({
  width,
  height,
  aspect,
  stackBelow,
  current,
  columnGap = paneGeometry.columnGap,
  rowGap = paneGeometry.rowGap,
  gutter = paneGeometry.gutter,
  band = paneGeometry.band,
}: {
  width: number
  height: number
  aspect: number | undefined
  stackBelow: number
  current?: PaneArrangement | undefined
  columnGap?: number
  rowGap?: number
  gutter?: number
  /** The height of each pane's label band: `paneGeometry.band`, or 0 when it has none (chips or hidden labels). */
  band?: number
}): PaneArrangement {
  if (width < stackBelow) return 'stacked'
  if (!aspect || !(height > 0) || !Number.isFinite(width)) return current ?? 'columns'
  // The fitted content's width in each arrangement: its pane's width, or its pane's height times the aspect.
  const fitted = (paneWidth: number, paneHeight: number) => Math.max(0, Math.min(paneWidth, paneHeight * aspect))
  const columns = fitted((width - columnGap) / 2, height - band)
  const stacked = fitted(width - gutter, (height - rowGap) / 2 - band)
  if (current === 'stacked') return columns > stacked * arrangementHysteresis ? 'columns' : 'stacked'
  if (current === 'columns') return stacked > columns * arrangementHysteresis ? 'stacked' : 'columns'
  return stacked > columns ? 'stacked' : 'columns'
}
