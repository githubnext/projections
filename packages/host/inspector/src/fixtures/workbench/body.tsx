import type {ReactNode} from 'react'
import {ComparisonError} from '@githubnext/projections-host'
import type {ComputedComparison, RendererDocuments, RendererEntry, TargetAnnotation, ViewSubject} from '@githubnext/projections-host'
import {LoadingStatus, ProjectionView} from '@githubnext/projections-host/ui'
import {Alert, AlertDescription, AlertTitle, cn} from '@githubnext/projections-host/ui/components'
import {CircleAlert, LoaderCircle} from 'lucide-react'
import type {FixtureCatalog, FixtureScenario} from '../../types.js'
import type {scenarioRenderer} from '../model.js'
import type {Viewport} from './catalog.js'
import {errorText} from '../../app/errors.js'

const initialMode = (['animated', 'side-by-side', 'swipe', 'diff'] as const).find(
  mode => mode === new URLSearchParams(location.search).get('mode'),
)

/**
 * The workbench's document: why the scenario can't be shown or its comparator failed, the scenario in the real host
 * view at the chosen viewport, and the check stage, which stays in view while the checks drive it.
 */
export function WorkbenchBody({
  catalog,
  scenario,
  comparison,
  subject,
  resolution,
  renderers,
  rendererDocuments,
  annotations,
  colorMode,
  viewport,
  width,
  running,
  stageRef,
}: {
  catalog: FixtureCatalog
  scenario: FixtureScenario | undefined
  comparison: {result?: ComputedComparison; error?: unknown} | undefined
  subject: ViewSubject | undefined
  resolution: ReturnType<typeof scenarioRenderer> | undefined
  renderers: RendererEntry[]
  rendererDocuments: RendererDocuments
  annotations: TargetAnnotation[] | undefined
  colorMode: 'light' | 'dark'
  viewport: Viewport
  width: number | undefined
  running: FixtureScenario | undefined
  stageRef: (element: HTMLDivElement | null) => void
}): ReactNode {
  return (
    <>
      {scenario?.error && (
        <Alert variant="destructive" className="pi-error pj:m-3 pj:w-auto">
          <CircleAlert className="pj:h-4 pj:w-4" />
          <AlertTitle>This scenario can&apos;t be shown.</AlertTitle>
          <AlertDescription className="pj:break-words">{scenario.error}</AlertDescription>
        </Alert>
      )}
      {comparison?.error !== undefined && (
        <Alert
          variant="destructive"
          className="pi-error pj:m-3 pj:w-auto"
          data-error-code={comparison.error instanceof ComparisonError ? comparison.error.code : 'error'}
        >
          <CircleAlert className="pj:h-4 pj:w-4" />
          <AlertTitle>The comparator failed.</AlertTitle>
          <AlertDescription className="pj:flex pj:flex-col pj:gap-1">
            <p className="pj:break-words">{errorText(comparison.error)}</p>
            {comparison.error instanceof ComparisonError && comparison.error.details.length > 0 && (
              <ul className="pj:list-disc pj:pl-4">
                {comparison.error.details.map((detail, index) => (
                  <li key={index} className="pj:break-words">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      {scenario && !scenario.error && !subject && comparison?.error === undefined && (
        <LoadingStatus className="ph-computing" label="Computing the comparison in this browser…" />
      )}
      {scenario && subject && (
        <div
          className={cn(
            'pi-viewport pj:mx-auto pj:flex pj:min-h-0 pj:w-full pj:min-w-0 pj:flex-1 pj:flex-col',
            width && 'pj:my-2 pj:overflow-hidden pj:rounded-lg pj:border pj:border-dashed',
          )}
          data-viewport={viewport}
          style={width ? {maxWidth: `${width + 2}px`} : undefined}
        >
          <ProjectionView
            key={`${scenario.key}:${resolution?.renderer?.url ?? ''}`}
            subject={subject}
            projection={{
              id: scenario.id,
              title: scenario.title,
              renderer: typeof scenario.renderer === 'string' ? scenario.renderer : (resolution?.renderer?.name ?? 'custom'),
            }}
            renderer={resolution?.renderer}
            rendererNotice={resolution?.notice}
            renderers={renderers}
            rendererDocuments={rendererDocuments}
            presentation={scenario.presentation}
            colorMode={colorMode}
            initialProgress={0}
            {...(initialMode ? {initialMode} : {})}
            {...(annotations ? {annotations} : {})}
          />
        </div>
      )}
      {!catalog.scenarios.length && (
        <div className="pj:m-auto pj:max-w-md pj:p-6 pj:text-center pj:text-xs pj:text-muted-foreground">
          No scenarios were loaded. Check the Diagnostics panel.
        </div>
      )}
      {/* The checks drive their own frame. It stays in view while they run: browsers pause hidden and offscreen frames. */}
      <aside
        aria-label="Check stage"
        className={cn(
          'pi-check-stage pj:fixed pj:bottom-8 pj:right-3 pj:z-40 pj:flex pj:w-[min(40rem,calc(100vw-1.5rem))] pj:flex-col pj:gap-2 pj:rounded-lg pj:border pj:bg-card pj:p-2 pj:text-card-foreground pj:shadow-pop pj:inset-shadow-bevel',
          !running && 'pj:hidden',
        )}
      >
        <p className="pj:flex pj:items-center pj:gap-2 pj:text-xs pj:text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="pj:h-3.5 pj:w-3.5 pj:animate-spin pj:motion-reduce:animate-none" />
          Checking {running?.title}: seeking, hovering, selecting and resizing the renderer in its own frame…
        </p>
        <div className="pj:max-h-[36vh] pj:overflow-hidden pj:rounded-md pj:border pj:bg-background">
          <div ref={stageRef} className="pj:max-w-full" />
        </div>
      </aside>
    </>
  )
}
