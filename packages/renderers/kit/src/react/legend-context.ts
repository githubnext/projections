import {createContext} from 'react'
import type {RendererLegend} from '@githubnext/projections-renderer-sdk/protocol'

/** The kit's legend reporter, for components such as `KindLegend`; absent outside a kit renderer. */
export const LegendContext = createContext<((legend: RendererLegend) => void) | undefined>(undefined)
