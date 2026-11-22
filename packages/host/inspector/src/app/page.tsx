import type {ComponentProps, ComponentType, ReactNode} from 'react'
import type {Definition, ExtractionDocument} from '@githubnext/projections-schemas'
import {ComparisonError, type ComparisonPair, type LoadingStatusProps, type ViewSubject} from '@githubnext/projections-host'
import type {ProjectionView} from '@githubnext/projections-host/ui'
import {Alert, AlertDescription, AlertTitle, Button, cn} from '@githubnext/projections-host/ui/components'
import {CircleAlert, Inbox, Square, X} from 'lucide-react'
import type {InspectorApi} from '../client/api.js'
import type {ControllerStore} from '../details.js'
import type {InspectorRunning} from '../control.js'
import {iconButton, shortcutLabel} from '../shell/controls.js'
import type {InspectorPolicy} from '../types.js'
import type {Artifact} from './artifacts.js'
import {TrustPrompt} from './cards.js'
import {partPath} from './definitions.js'
import {refName} from './revisions.js'

const pathStart = /(?:^|[\s("'\x60])(?:\/|~\/|\.{1,2}\/|[A-Za-z]:\\)/u

/**
 * Whether a message names a file or directory: an absolute or relative path, or a file name with an extension. The
 * viewer leaves such messages to the agent rather than showing them.
 */
export function mentionsPath(text: string): boolean {
  return pathStart.test(text) || nestedPath(text) || fileName(text)
}

const fileExtension = /^(?:json|ya?ml|[cm]?[jt]sx?|py|go|rs|cs|java|rb|toml|lock|md|html|css|sh)$/u
const wordCharacter = /\w/u

/** `a/b/`: two segments of word characters, dots and hyphens, each followed by a slash. */
function nestedPath(text: string): boolean {
  for (const run of text.split(/[^\w./-]+/u)) {
    const segments = run.split('/')
    // The last segment has no slash after it.
    for (let index = 0; index + 2 < segments.length; index++) if (segments[index] && segments[index + 1]) return true
  }
  return false
}

/** `name.json`: a run of word characters and hyphens, at least one a word character, then a known extension. */
function fileName(text: string): boolean {
  let named = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (character === '.' && named) {
      let end = index + 1
      while (end < text.length && wordCharacter.test(text[end]!)) end++
      if (fileExtension.test(text.slice(index + 1, end))) return true
    }
    if (character !== '-') named = wordCharacter.test(character)
  }
  return false
}

/** A viewer's message in plain words, in place of what the workbench would show. */
export function PlainMessage({text}: {text: string}) {
  return (
    <div className="pi-plain pj:m-auto pj:flex pj:max-w-md pj:flex-col pj:items-center pj:gap-2 pj:p-6 pj:text-center">
      <p className="pj:text-sm pj:text-muted-foreground">{text}</p>
    </div>
  )
}

/** An error of the Inspector's own (a request or extraction that failed), until dismissed. */
export function ErrorBanner({error, onDismiss}: {error: string; onDismiss: () => void}) {
  return (
    <Alert variant="destructive" className="pi-error pj:mx-[var(--pi-gutter)] pj:mt-[var(--pi-gutter)] pj:w-auto pj:py-2">
      <CircleAlert className="pj:h-4 pj:w-4" />
      <AlertDescription className="pj:flex pj:items-start pj:gap-2 pj:break-words">
        <span className="pj:flex-1">{error}</span>
        <button type="button" className={cn(iconButton, 'pj:h-5 pj:w-5')} aria-label="Dismiss" onClick={onDismiss}>
          <X className="pj:h-3.5 pj:w-3.5" />
        </button>
      </AlertDescription>
    </Alert>
  )
}

/** Why the presented extractions can't be compared, with a retry. */
export function ComparisonFailure({error, onRetry}: {error: ComparisonError | Error; onRetry: () => void}) {
  return (
    <Alert
      variant="destructive"
      className="ph-error pj:m-3 pj:w-auto"
      data-error-code={error instanceof ComparisonError ? error.code : 'error'}
    >
      <CircleAlert className="pj:h-4 pj:w-4" />
      <AlertTitle>These extractions can&apos;t be compared.</AlertTitle>
      <AlertDescription className="pj:flex pj:flex-col pj:gap-2">
        <p className="pj:break-words">{error.message}</p>
        {error instanceof ComparisonError && error.details.length > 0 && (
          <ul className="pj:list-disc pj:pl-4">
            {error.details.map((detail, index) => (
              <li key={index} className="pj:break-words">
                {detail}
              </li>
            ))}
          </ul>
        )}
        <p>
          <Button type="button" variant="outline" size="sm" className="pj:text-foreground" onClick={onRetry}>
            Try again
          </Button>
        </p>
      </AlertDescription>
    </Alert>
  )
}

/** The projection's view of the presented pair (or one extraction), its selection shown in the docked Details. */
export function PresentedView({
  View,
  subject,
  pair,
  document,
  bare,
  showing,
  projection,
  artifact,
  colorMode,
  themeTokens,
  notices,
  banner,
  rendererNotice,
  onOpen,
  controllers,
  running,
  toolbarStart,
  utilityArea,
}: {
  View: ComponentType<ComponentProps<typeof ProjectionView> & {running?: InspectorRunning | null}>
  subject: ViewSubject
  pair: ComparisonPair
  document: ExtractionDocument
  bare: boolean
  showing: 'live' | 'artifact'
  projection: string
  artifact: Artifact | null
  colorMode: 'light' | 'dark'
  /** The host theme's renderer token overrides (`InspectorHostTheme.tokens`), for the shown color mode. */
  themeTokens?: Record<string, string> | undefined
  /** The notices shown with the view: the artifact's, or the last job's. */
  notices: readonly string[]
  /** A panel under the view's toolbar, such as a side that didn't extract while the other is shown. */
  banner?: ReactNode
  rendererNotice: ComparisonPair['resolution']['notice']
  onOpen: ((path: string, line?: number) => void) | undefined
  controllers: ControllerStore
  /** What the shown pair's job is doing (`null` while none runs), for a host UI's view; none for the default UI's. */
  running?: InspectorRunning | null
  /** What a one-revision view shows, at its toolbar's start (`InspectorAppProps.toolbarStart`); a comparison has its modes there. */
  toolbarStart?: ReactNode
  /** The stage's utility area (`ProjectionViewProps.utilityArea`). */
  utilityArea?: boolean
}) {
  return (
    <div
      className={cn(
        'pi-view pj:flex pj:min-h-0 pj:min-w-0 pj:flex-1 pj:flex-col',
        // In the workbench the view is a card on the gutter, its flat chrome inside; a bare view (an editor tab, the
        // viewer's page) is its frame, edge to edge, as the full screen view was.
        !bare && 'pi-card pj:m-[var(--pi-gutter)]',
      )}
    >
      <View
        key={`${showing}:${showing === 'live' ? projection : artifact?.name}`}
        subject={subject}
        projection={{
          id: document.projection.id,
          title: document.projection.title,
          renderer: typeof document.projection.renderer === 'string' ? document.projection.renderer : document.projection.renderer.bundle,
        }}
        renderer={pair.resolution.renderer}
        rendererNotice={rendererNotice}
        renderers={pair.renderers}
        rendererDocuments={pair.rendererDocuments}
        presentation={pair.presentation}
        {...(subject.mode === 'comparison'
          ? {beforeLabel: pair.subjectLabels.before ?? 'A', afterLabel: pair.subjectLabels.after ?? 'B'}
          : {})}
        colorMode={colorMode}
        {...(themeTokens ? {themeTokens} : {})}
        {...(notices.length ? {notices} : {})}
        {...(banner !== undefined ? {banner} : {})}
        {...(pair.outcome.status === 'compared' ? {comparator: pair.outcome.result.comparator} : {})}
        {...(onOpen ? {onOpen} : {})}
        // The docked Details panel presents the selection, so the view draws no detail card of its own.
        details="none"
        controllerRef={controllers.set}
        {...(running !== undefined ? {running} : {})}
        {...(toolbarStart !== undefined && subject.mode !== 'comparison' ? {toolbarStart} : {})}
        {...(utilityArea ? {utilityArea} : {})}
      />
    </div>
  )
}

/**
 * The main view with nothing to present: an extraction running, trust needed, a bare view (an editor tab) loading or
 * waiting for a fix, or how to begin.
 */
export function EmptyState({
  Loading,
  api,
  projection,
  openedProjection,
  bare,
  viewer,
  busy,
  active,
  cancel,
  showing,
  needsTrust,
  authorized,
  runCommand,
  usesOwnRenderer,
  rendererPolicy,
  ownDefinition,
  failedSides,
}: {
  Loading: ComponentType<LoadingStatusProps>
  api: InspectorApi | undefined
  projection: string
  /** The projection a host opened this Inspector on. */
  openedProjection: string | undefined
  bare: boolean
  /** A page an agent drives (`chrome` `viewer`): what failed is said in plain words. */
  viewer: boolean
  busy: boolean
  active: {projection: string; ref: string; id?: string} | undefined
  cancel: () => Promise<void>
  showing: 'live' | 'artifact'
  needsTrust: boolean
  authorized: boolean
  runCommand: string | undefined
  usesOwnRenderer: boolean
  rendererPolicy: InspectorPolicy
  ownDefinition: Definition | undefined
  failedSides: readonly {side: string; ref: string}[]
}) {
  return busy ? (
    <Loading
      className="pi-empty"
      label={viewer ? 'Extracting…' : active ? `Extracting ${refName(active.ref)}…` : 'Extractor is running…'}
      description={
        viewer ? undefined : (
          <span className="pj:flex pj:flex-col pj:items-center pj:gap-2">
            {/* A bare view (an editor tab) has no panel. */}
            {!bare && 'Raw output and diagnostics appear in the panel as the job completes.'}
            <Button type="button" size="sm" variant="outline" className="pj:h-7" onClick={() => void cancel()}>
              <Square />
              Cancel
            </Button>
          </span>
        )
      }
    />
  ) : api && projection && needsTrust && !authorized && showing === 'live' && viewer ? (
    <PlainMessage text="This projection runs code from the repository, so the viewer needs trust to show it. Ask the agent to review the projection's code and restart the viewer with trust; this page reconnects on its own." />
  ) : api && projection && needsTrust && !authorized && showing === 'live' ? (
    <TrustPrompt
      command={runCommand}
      renderer={usesOwnRenderer && rendererPolicy.rendererRequiresTrust ? partPath(ownDefinition, 'renderer') : undefined}
    />
  ) : bare && (projection || openedProjection) && !failedSides.length ? (
    // A bare view (an editor tab) opened for a projection is loading until its first result: its host knows what
    // it opens, so the workbench's empty state (and its title bar and Explorer copy) never shows there.
    <Loading className="pi-empty" label="Loading…" />
  ) : viewer && failedSides.length ? null : viewer && !projection ? (
    <PlainMessage text="Waiting for the agent…" />
  ) : bare ? (
    <div className="pi-empty pj:m-auto pj:flex pj:max-w-md pj:flex-col pj:items-center pj:gap-2 pj:p-6 pj:text-center">
      <p className="pj:text-xs pj:text-muted-foreground">
        {failedSides.length ? 'Fix the extractor and save: both sides are extracted again.' : 'Nothing to show yet.'}
      </p>
    </div>
  ) : (
    <div className="pi-empty pj:m-auto pj:flex pj:max-w-md pj:flex-col pj:items-center pj:gap-2 pj:p-6 pj:text-center">
      <Inbox aria-hidden="true" className="pj:h-6 pj:w-6 pj:text-muted-foreground" />
      <h2 className="pj:text-sm pj:font-semibold">No extraction loaded</h2>
      <p className="pj:text-xs pj:text-muted-foreground">
        {failedSides.length ? (
          'Fix the extractor and save: both sides are extracted again.'
        ) : api ? (
          <>
            Choose a projection in the title bar and a Before → After pair in the Explorer. Press{' '}
            <kbd className="pj:rounded-sm pj:border pj:px-1 pj:font-mono">{shortcutLabel('k')}</kbd> for commands.
          </>
        ) : (
          'Open a saved artifact to begin.'
        )}
      </p>
    </div>
  )
}
