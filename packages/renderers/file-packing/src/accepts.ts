import type {RendererAccepts} from '@githubnext/projections-renderer-sdk/protocol'

/** The extractions this renderer presents: its manifest declares them, and they type what it receives. */
export const accepts = [{schema: 'treemap/v0'}, {schema: 'graph/v0'}] as const satisfies readonly RendererAccepts[]
