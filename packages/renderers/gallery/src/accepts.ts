import type {RendererAccepts} from '@githubnext/projections-renderer-sdk/protocol'

/** The extractions this renderer presents: renderer scenarios as data (`scenarios/v0`, which `renderer-scenarios` writes). */
export const accepts = [{schema: 'graph/v0', vocabulary: 'scenarios/v0'}] as const satisfies readonly RendererAccepts[]
