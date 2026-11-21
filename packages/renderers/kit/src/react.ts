// The renderer kit's React entry: the renderer shell (`mountRenderer`), the graph canvas, presentation and layout
// components, and the hooks. React and react-dom are peer dependencies. Everything framework-free is the kit's main
// entry (src/index.ts), which a React renderer imports beside this one.
export {type RendererExtraction, type RendererProps, type MountOptions, type ViewOptions} from './react/shell/props.js'
export {mountRenderer, useControlActions} from './react/shell/mount.js'
export {KitRenderer} from './react/shell/kit-renderer.js'
export {
  useFrameFill,
  useFrameSizing,
  useFrameViewport,
  useStageInset,
  useStageInsetTop,
  useStageInsetBottom,
  useStageCover,
  useStageHeightCap,
  useContentAspect,
  usePaintGate,
  usePaintHold,
} from './react/shell/frame.js'
export * from './react/components.js'
export * from './react/status-tab.js'
export * from './react/generated.js'
export * from './react/diff-components.js'
export * from './react/icons.js'
export {Fold, useFolds} from './react/fold.js'
export {IdentifierText} from './react/identifiers.js'
export * from './react/layout-components.js'
export {DataTable, useTableProps} from './react/data-table.js'
export type {DataTableColumn, DataTableProps, TablePropsSource} from './react/data-table.js'
export {graphCanvasControls, graphCanvasPace, graphEntityLimit} from './react/graph-canvas/props.js'
export type {GraphAnchor, GraphCanvasProps} from './react/graph-canvas/props.js'
export {GraphCanvas} from './react/graph-canvas/canvas.js'
export {CardChangeMarks, cardCornerRadius} from './react/graph-canvas/card-change.js'
export {useBorderWidths} from './react/border.js'
export {useDomainIndex} from './react/domain.js'
export {useFitScale} from './react/fit.js'
export {useCoveredPadding, useScrolledPadding} from './react/covered-padding.js'
export {useLegend} from './react/legend.js'
export {useSummaryNouns} from './react/summary.js'
export {useOpeningFloor, useScrollAnchor, useStageZoom} from './react/zoom.js'
