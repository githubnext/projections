// A live projection controller for building-block stories: the host core's `useProjection` on a prepared scenario.
import {useMemo, type ReactNode} from 'react'
import {useProjection, type AnnotationMark, type ProjectionController, type ProjectionOptions} from '@githubnext/projections-host'
import type {PreparedFixture} from './fixtures.js'

/**
 * Runs `useProjection` on a prepared scenario (with its resolved renderer, if any, and its presentation defaults) and
 * renders `children` with the controller and its annotation marks by item ID. `options` override the scenario's.
 */
export function WithProjection({
  prepared,
  colorMode,
  options,
  children,
}: {
  prepared: PreparedFixture
  colorMode: 'light' | 'dark'
  options?: Partial<ProjectionOptions>
  children: (projection: ProjectionController, marks: ReadonlyMap<string, AnnotationMark>) => ReactNode
}) {
  const {subject, projection, resolution, presentation} = prepared
  const p = useProjection({
    subject,
    projection,
    renderers: resolution.renderer ? [resolution.renderer] : [],
    presentation,
    colorMode,
    ...options,
  })
  const marks = useMemo(() => new Map(p.annotationMarks.map(mark => [mark.id, mark])), [p.annotationMarks])
  return <>{children(p, marks)}</>
}
