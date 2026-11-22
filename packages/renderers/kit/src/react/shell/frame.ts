// The contexts a kit renderer's components reach the shell through: the paint gate, frame fill and sizing, and content aspect.
import {createContext, useContext, useEffect, useLayoutEffect} from 'react'
import type {RendererEnvironment} from '@githubnext/projections-renderer-sdk/protocol'
import {contentHeightCap} from '../../fit.js'
import type {CoverRect} from '../../fit.js'

export const PaintGate = createContext<() => () => void>(() => () => {})
export interface FrameFillControl {
  /** Starts filling the frame; the returned function stops. */
  start: () => () => void
  /** The content height to report while filling, once known. */
  prefer: (height: number | undefined) => void
}
export const FrameFill = createContext<FrameFillControl>({start: () => () => {}, prefer: () => {}})

/**
 * While the calling component is mounted, the renderer fills its frame's
 * height (`.pk[data-fill]`, a flex column whose child takes the remaining
 * height) and reports `preferredHeight` (CSS px) as its content height: the
 * height a host that sizes its frame to the content should give it. A host
 * that sizes the frame itself ignores the report, and the content still fills
 * the frame. Nothing is reported while `preferredHeight` is undefined.
 */
export function useFrameFill(preferredHeight: number | undefined): void {
  const control = useContext(FrameFill)
  useLayoutEffect(() => control.start(), [control])
  // Before paint, so the host has the height before the paint it is acknowledged with (see `useFrameFillReport`).
  useLayoutEffect(() => {
    control.prefer(preferredHeight)
  }, [control, preferredHeight])
}

export const FrameSizing = createContext<RendererEnvironment['sizing']>(undefined)

/**
 * How the host sizes the frame (`RendererEnvironment.sizing`): `content` when it gives the frame the height the
 * renderer reports, so content fitted to it need only fit its width; `fill` when it sizes the frame itself; undefined
 * when the host doesn't say.
 */
export function useFrameSizing(): RendererEnvironment['sizing'] {
  return useContext(FrameSizing)
}

export const FrameViewport = createContext<{width: number; height: number} | undefined>(undefined)

/**
 * The frame's width and the host window's height, CSS px, as the host last reported them (`viewport`); undefined
 * until it has. A content-sized frame lies in its host's scrolling page, so the window's height bounds how tall a
 * stage that pans and zooms should ask to be (see `useFitScale`).
 */
export function useFrameViewport(): {width: number; height: number} | undefined {
  return useContext(FrameViewport)
}

export const StageInset = createContext<number | undefined>(undefined)

/**
 * The host's `stage-inset` theme token in CSS px (the space between the frame's edges and the content on the stage,
 * on every side), or undefined when the host sends none and the renderer keeps its own. CSS reads it through the kit's
 * stage padding (`pk-stage`, `--pk-stage-padding`); this is for layout computed in script, such as a fitted canvas's
 * padding.
 */
export function useStageInset(): number | undefined {
  return useContext(StageInset)
}

export const StageInsetTop = createContext<number | undefined>(undefined)

/**
 * The host's `stage-inset-top` theme token in CSS px (the space between the frame's top edge and the content, where
 * the host overlays the frame's top, for example with a pane's label chip), or undefined when the host sends none and
 * the renderer keeps its own top padding. CSS reads it through the kit's stage padding (`pk-stage`,
 * `--pk-stage-padding-top`, the larger of it and `stage-inset`); this is for layout computed in script, such as a
 * fitted canvas's padding.
 */
export function useStageInsetTop(): number | undefined {
  return useContext(StageInsetTop)
}

export const StageInsetBottom = createContext<number | undefined>(undefined)

/**
 * The host's `stage-inset-bottom` theme token in CSS px (the space between the content and the frame's bottom edge,
 * where the host overlays the frame's foot, for example with a floating legend and summary), or undefined when it
 * sends none. CSS reads it through the kit's stage padding (`--pk-stage-padding-bottom`).
 */
export function useStageInsetBottom(): number | undefined {
  return useContext(StageInsetBottom)
}

export const StageCover = createContext<readonly CoverRect[] | undefined>(undefined)

/**
 * The rectangles of the frame the host overlays (its `stage-cover` theme token, see `parseStageCover`), CSS px from
 * the frame's top left, or undefined when it sends none. A fitted canvas keeps clear of them only where its drawing
 * would reach them (`useCoveredPadding`); content that scrolls pads by `stage-inset-top` instead.
 */
export function useStageCover(): readonly CoverRect[] | undefined {
  return useContext(StageCover)
}

export const StageMaxHeight = createContext<string | undefined>(undefined)

/**
 * The most, CSS px, a content-sized stage that pans and zooms asks its host for (see `contentHeightCap`), from the
 * host's optional `stage-max-height` theme token and its viewport; undefined when the host sends no such token. A host
 * that sends it lays the frame in its scrolling page: such a stage also pans by dragging, leaving the wheel to the page.
 */
export function useStageHeightCap(): number | undefined {
  return contentHeightCap(useContext(StageMaxHeight), useContext(FrameViewport))
}

/** The `stage-inset` token's value (or `name`'s, another length token) in CSS px, if it is one. */
export function stageInsetOf(
  tokens: Record<string, string> | undefined,
  name: 'stage-inset' | 'stage-inset-top' | 'stage-inset-bottom' = 'stage-inset',
): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/u.exec(tokens?.[name] ?? '')
  return match ? Number(match[1]) : undefined
}

export const ContentAspect = createContext<(ratio: number | undefined) => void>(() => {})

/**
 * Reports the shape (width / height) of the content a renderer fits to its stage, over the whole transition, so a
 * host can arrange held panes (side by side or stacked) for the larger fitted scale. `useFitScale` reports it; call
 * this from a renderer that fits content another way. Nothing is reported while `ratio` is undefined.
 */
export function useContentAspect(ratio: number | undefined): void {
  const report = useContext(ContentAspect)
  useEffect(() => {
    if (ratio !== undefined && Number.isFinite(ratio) && ratio > 0) report(ratio)
  }, [report, ratio])
}

/**
 * Holds the shell's `rendered` acknowledgement while `ready` is false, for a
 * component that paints asynchronously (for example after a layout). The host
 * keeps the frame hidden until the first acknowledgement, so the person never
 * sees a half-drawn first frame, and waits for each one before the next seek.
 */
export function usePaintGate(ready: boolean): void {
  const hold = useContext(PaintGate)
  useEffect(() => (ready ? undefined : hold()), [ready, hold])
}

/**
 * The shell's hold on its `rendered` acknowledgement (see `usePaintGate`), for
 * a hold taken outside React's render, such as in a `ResizeObserver` whose
 * measurement re-renders only later: call it to hold, and the function it
 * returns to release. Outside a kit renderer it holds nothing.
 */
export function usePaintHold(): () => () => void {
  return useContext(PaintGate)
}
