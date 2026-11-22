import elk from 'elkjs/lib/elk.bundled.js'
import type {ELK as ElkEngine} from 'elkjs/lib/elk-api.js'

let runs = 0

/** How many layouts ELK has run in this process: tests keep the runs a graph costs in check. */
export function layoutRuns(): number {
  return runs
}

/** ELK in the current thread, for Node (tests and tools); browsers use the worker engine. */
export function createLayoutEngine(): ElkEngine {
  const engine = new elk.default({algorithms: ['layered']})
  const layout = engine.layout.bind(engine)
  engine.layout = (graph, args) => {
    runs++
    return layout(graph, args)
  }
  return engine
}
