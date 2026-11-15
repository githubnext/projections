import {useEffect} from 'react'
import type {RendererLegend} from '@githubnext/projections-renderer-sdk/protocol'
import {boundedLegend} from '../legend.js'

/**
 * Reports the renderer's legend to the host whenever its content changes; the
 * host draws it once beside every pane. Pass `undefined` (or no items) to
 * clear it; unmounting clears it too. Describe the whole document, not the current progress, so the
 * legend never changes while scrubbing.
 */
export function useLegend(report: (legend: RendererLegend) => void, legend: RendererLegend | undefined): void {
  const key = JSON.stringify(legend ? boundedLegend(legend) : {items: []})
  useEffect(() => {
    report(JSON.parse(key) as RendererLegend)
    // A view that unmounts (another presentation, a new document) takes its legend with it.
    return () => report({items: []})
  }, [report, key])
}
