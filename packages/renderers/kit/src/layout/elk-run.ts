// One ELK run over a laid-out graph's input, with its options, card ports and hinted places.
import type {ElkNode, LayoutOptions} from 'elkjs/lib/elk-api.js'
import {createLayoutEngine} from '#layout-engine'
import type {Point} from '../edge-arrows.js'
import {cardWidth, cardHeight} from './model.js'
import type {Alignment} from './alignment.js'
import {elkOptions, hintedPlaces, rootPadding} from './placement.js'
import type {ElkInput} from './elk-input.js'

let engine: ReturnType<typeof createLayoutEngine> | undefined

/** A boundary's padding round its children: its heading above them, its status footer below. */
const boundaryPadding = '[top=52,left=24,bottom=24,right=24]'
/** An empty boundary's height: its heading band and its footer. */
const emptyBoundaryHeight = 52 + 24

/**
 * One ELK run. `order` keeps a reference layout's layers and in-layer order. `ports` gives every card one port in
 * the middle of each face its relationships cross, so ELK lines cards up by their middles (a parent over its child)
 * rather than by wherever it spread their relationships along a face, and places them for straight relationships
 * (see `elkOptions`). An `ordering` run is read only for its layers and order: it places and routes the cheapest way.
 */
export type ElkRun = (
  order: ReadonlyMap<string, Point>,
  ports: boolean,
  alignment?: Alignment | 'NONE',
  ordering?: boolean,
) => Promise<ElkNode>

/** ELK runs over `input` with layers `gap` apart. */
export function elkRun(input: ElkInput, gap: number): ElkRun {
  const {nodes, direction, groups, member, laid, elkId, byElk, elkEdges, stages} = input
  return async (order, ports, alignment = 'BALANCED', ordering = false) => {
    const settings = {
      ...elkOptions(direction, order.size > 0 && !groups.size, gap, alignment),
      ...(ordering ? {'elk.layered.nodePlacement.strategy': 'SIMPLE', 'elk.edgeRouting': 'POLYLINE'} : {}),
      // Unconnected parts share the layers, so every layer has one baseline.
      ...(groups.size ? {} : {'elk.separateConnectedComponents': 'false'}),
      ...(order.size && groups.size ? {'elk.layered.crossingMinimization.semiInteractive': 'true'} : {}),
    }
    const hint = (id: string): LayoutOptions => {
      const point = order.get(id)
      return point ? {'elk.position': `(${point.x},${point.y})`} : {}
    }
    // ELK ignores interactive layering inside compound graphs: pin cards to the hinted layers and order instead.
    const pinned = groups.size && order.size ? hintedPlaces(nodes, groups, member, order, direction) : new Map<string, LayoutOptions>()
    const elkNodes = new Map<string, ElkNode>(
      laid.map(node => {
        const id = elkId.get(node.id)!
        if (groups.has(node.id)) {
          return [
            node.id,
            {
              id,
              children: [],
              // A boundary with nothing left in it (see `GraphLayoutOptions.boundaries`) keeps its heading and footer.
              ...(groups.get(node.id)!.length ? {} : {width: node.width ?? cardWidth, height: emptyBoundaryHeight}),
              layoutOptions: {...settings, ...hint(node.id), 'elk.padding': boundaryPadding},
            },
          ]
        }
        const width = node.width ?? cardWidth,
          height = node.height ?? cardHeight(node.kind)
        return [
          node.id,
          {
            id,
            width,
            height,
            ...cardPorts(direction, ports, id, width, height),
            // Interactive layering reads where a card is, by its corner, in either direction.
            ...(order.has(node.id) && !groups.size ? {x: order.get(node.id)!.x - width / 2, y: order.get(node.id)!.y - height / 2} : {}),
            layoutOptions: {
              // Cards in a layer line up on the side their relationships enter, the layer's left or top, so every layer has
              // one baseline. (ELK's hierarchical layering of boundaries, whose cards share one height, keeps its own.)
              ...(direction === 'RIGHT' ? {'elk.alignment': 'LEFT'} : groups.size ? {} : {'elk.alignment': 'TOP'}),
              ...(ports ? {'elk.portConstraints': 'FIXED_POS'} : {}),
              ...hint(node.id),
              ...pinned.get(node.id),
            },
          },
        ]
      }),
    )
    const root: ElkNode = {
      id: 'root',
      children: [],
      layoutOptions: {
        ...settings,
        'elk.padding': `[top=${rootPadding},left=${rootPadding},bottom=${rootPadding},right=${rootPadding}]`,
        'elk.json.shapeCoords': 'ROOT',
        'elk.json.edgeCoords': 'ROOT',
        ...(groups.size ? {'elk.hierarchyHandling': 'INCLUDE_CHILDREN'} : {}),
      },
    }
    for (const node of laid) (elkNodes.get(member.get(node.id) ?? '') ?? root).children!.push(elkNodes.get(node.id)!)
    for (const index of stages.keys()) root.children!.push({id: `j${index}`, width: 1, height: 1})
    const card = (id: string) => elkNodes.has(byElk.get(id) ?? '') && !groups.has(byElk.get(id)!)
    root.edges = elkEdges.map(edge => ({
      ...edge,
      sources: edge.sources.map(id => (ports && card(id) ? `${id}o` : id)),
      targets: edge.targets.map(id => (ports && card(id) ? `${id}i` : id)),
    }))
    engine ??= createLayoutEngine()
    return engine.layout(root)
  }
}

/** A card's ports, when it has them: the middles of the faces its relationships enter and leave. */
function cardPorts(direction: 'DOWN' | 'RIGHT', ports: boolean, id: string, width: number, height: number): Pick<ElkNode, 'ports'> {
  return ports
    ? {
        ports:
          direction === 'DOWN'
            ? [
                {id: `${id}i`, x: width / 2, y: 0, width: 0, height: 0, layoutOptions: {'elk.port.side': 'NORTH'}},
                {id: `${id}o`, x: width / 2, y: height, width: 0, height: 0, layoutOptions: {'elk.port.side': 'SOUTH'}},
              ]
            : [
                {id: `${id}i`, x: 0, y: height / 2, width: 0, height: 0, layoutOptions: {'elk.port.side': 'WEST'}},
                {id: `${id}o`, x: width, y: height / 2, width: 0, height: 0, layoutOptions: {'elk.port.side': 'EAST'}},
              ],
      }
    : {}
}
