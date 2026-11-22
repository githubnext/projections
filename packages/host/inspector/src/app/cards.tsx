import {useState, type ReactNode} from 'react'
import type {Diagnostic} from '@githubnext/projections-schemas'
import {Alert, AlertDescription, AlertTitle, Button, cn} from '@githubnext/projections-host/ui/components'
import {CircleAlert, Copy, Lightbulb, RefreshCw, ShieldAlert, Sparkles, X} from 'lucide-react'
import {copyText, useInspectorHost} from '../host.js'
import {iconButton} from '../shell/controls.js'
import type {InspectorInvalidDefinition, InspectorJob} from '../types.js'
import {failureMessage} from '../notices.js'
import {refName} from './revisions.js'
import {noop} from '../noop.js'

/**
 * A dismissible one-line tip in its own row (never over content), remembered as dismissed under `storageKey`.
 */
export function Tip({storageKey, children}: {storageKey: string; children: ReactNode}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'dismissed'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  return (
    <div
      role="note"
      aria-label="Tip"
      className="pi-tip pi-card pj:mx-[var(--pi-gutter)] pj:mt-[var(--pi-gutter)] pj:flex pj:shrink-0 pj:items-center pj:gap-2 pj:py-1 pj:pr-1.5 pj:pl-3 pj:text-xs pj:text-muted-foreground"
    >
      <Lightbulb aria-hidden="true" className="pj:size-3.5 pj:shrink-0" />
      <p className="pj:min-w-0 pj:flex-1">{children}</p>
      <button
        type="button"
        className={cn(iconButton, 'pj:h-6 pj:w-6')}
        aria-label="Dismiss tip"
        title="Dismiss tip"
        onClick={() => {
          setDismissed(true)
          try {
            localStorage.setItem(storageKey, 'dismissed')
          } catch {
            /* storage may be unavailable */
          }
        }}
      >
        <X className="pj:h-3.5 pj:w-3.5" />
      </button>
    </div>
  )
}

/** Copies text, and says so for a moment. */
function CopyButton({text, label}: {text: string; label: string}) {
  const [copied, setCopied] = useState(false)
  const host = useInspectorHost()
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="pj:h-7 pj:shrink-0"
      aria-label={label}
      onClick={() => {
        void copyText(host, text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(noop)
      }}
    >
      <Copy />
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

/**
 * The main view's empty state when trust is the one thing needed: what would run (the extractor's command, and a
 * custom renderer that differs from the default branch's), and how to allow it. The runner's `--trust` is the grant, so
 * the page can only say how to get it; saved artifacts and built-in extractors work without it.
 */
export function TrustPrompt({command, renderer}: {command: string | undefined; renderer: string | undefined}) {
  return (
    <section
      aria-label="Trust"
      data-trust="unauthorized"
      className="pi-empty pi-trust pj:m-auto pj:flex pj:max-w-lg pj:flex-col pj:items-center pj:gap-2.5 pj:p-6 pj:text-center pj:text-xs"
    >
      <ShieldAlert aria-hidden="true" className="pj:h-6 pj:w-6 pj:text-modified" />
      <h2 className="pj:text-sm pj:font-semibold">This projection runs repository code</h2>
      {command && (
        <p className="pj:text-muted-foreground">
          Its extractor runs <code className="pj:rounded-sm pj:bg-surface-inset pj:px-1 pj:font-mono pj:text-foreground">{command}</code> in
          each revision it extracts.
        </p>
      )}
      {renderer && (
        <p className="pj:text-muted-foreground">
          Its custom renderer <code className="pj:font-mono">{renderer}</code> is repository code that differs from the default
          branch&apos;s.
        </p>
      )}
      <p className="pj:text-muted-foreground">
        Execution is not authorized. Review the repository&apos;s projection code, then trust it: in VS Code, trust the workspace, which
        restarts the runner with <code className="pj:font-mono">--trust</code>.
      </p>
      <p className="pj:text-muted-foreground">Saved artifacts and built-in extractors work without it.</p>
    </section>
  )
}

/**
 * Shown while the working tree defines no projections: how to make one, with a
 * prompt for a coding agent. The built-in defaults stay previewed below it.
 */
export function SetupCard({
  setup,
  showing,
  onDismiss,
}: {
  setup: {command: string; prompt: string}
  showing: readonly string[]
  onDismiss: () => void
}) {
  return (
    <section
      aria-label="Make a projection"
      className="pi-setup pj:m-2 pj:mb-0 pj:flex pj:flex-col pj:gap-2 pj:rounded-md pj:border pj:border-divider pj:bg-surface-raised pj:p-3 pj:text-xs"
    >
      <div className="pj:flex pj:items-start pj:gap-2">
        <Sparkles aria-hidden="true" className="pj:mt-0.5 pj:h-4 pj:w-4 pj:shrink-0 pj:text-muted-foreground" />
        <div className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col pj:gap-0.5">
          <h2 className="pj:text-sm pj:font-semibold">Make a projection of this codebase</h2>
          <p className="pj:text-muted-foreground">
            This repository defines no projections yet
            {showing.length === 1
              ? `, so the built-in ${showing[0]} projection is shown below`
              : showing.length
                ? `, so the built-in ${showing.slice(0, -1).join(', ')} and ${showing.at(-1)} projections are shown below`
                : ''}
            . Scaffold one, then have your coding agent build it: the preview updates as it saves.
          </p>
          <p>
            Start with what fits already:{' '}
            <a href="?view=explore" className="pj:underline pj:underline-offset-2">
              explore this repository
            </a>{' '}
            to try the built-in projections that apply here on its recent pull requests.
          </p>
        </div>
        <button type="button" className={cn(iconButton, 'pj:h-6 pj:w-6')} aria-label="Dismiss" onClick={onDismiss}>
          <X className="pj:h-3.5 pj:w-3.5" />
        </button>
      </div>
      <div className="pj:flex pj:min-w-0 pj:items-center pj:gap-2">
        <code className="pj:min-w-0 pj:flex-1 pj:truncate pj:rounded-sm pj:border pj:border-divider pj:bg-surface-inset pj:px-2 pj:py-1 pj:font-mono">
          {setup.command}
        </code>
        <CopyButton text={setup.command} label="Copy the command" />
      </div>
      <div className="pj:flex pj:min-w-0 pj:items-start pj:gap-2">
        <p className="pj:min-w-0 pj:flex-1 pj:rounded-sm pj:border pj:border-divider pj:bg-surface-inset pj:px-2 pj:py-1">{setup.prompt}</p>
        <CopyButton text={setup.prompt} label="Copy the agent prompt" />
      </div>
    </section>
  )
}

/**
 * A side's failed extraction, in the main view: what failed and where, once. The extractor's whole stderr is behind Raw
 * output. Shown with a view, it sits in the view below its toolbar; the last good extraction stays below.
 */
export function FailureCard({
  side,
  reference,
  job,
  error,
  previous,
  other,
  onRetry,
  onDiagnostics,
  onRawOutput,
}: {
  /** Which side failed: "Before", "After" or "The revision". */
  side: string
  reference: string
  job: InspectorJob | undefined
  /** The failure's message when no job reported diagnostics (for example a request that failed). */
  error?: string | undefined
  previous: boolean
  /** The other side, shown alone meanwhile, if it extracted. */
  other?: string | undefined
  onRetry?: (() => void) | undefined
  onDiagnostics: () => void
  onRawOutput: () => void
}) {
  const diagnostics = job?.diagnostics ?? []
  const errors = diagnostics.filter(item => item.severity === 'error')
  const shown = errors.length
    ? errors
    : diagnostics.length
      ? diagnostics
      : error
        ? [{severity: 'error', code: 'RUNNER_ERROR', message: error} as Diagnostic]
        : []
  return (
    <section
      role="alert"
      aria-label={`${side} extraction failed`}
      data-side={side.toLowerCase()}
      data-ref={reference}
      className="pi-failure pj:m-2 pj:mb-0 pj:flex pj:max-h-[40vh] pj:shrink-0 pj:flex-col pj:gap-2 pj:overflow-auto pj:rounded-md pj:border pj:border-destructive pj:bg-surface-raised pj:p-3 pj:text-xs"
    >
      <div className="pj:flex pj:flex-wrap pj:items-start pj:gap-2">
        <CircleAlert aria-hidden="true" className="pj:mt-0.5 pj:h-4 pj:w-4 pj:shrink-0 pj:text-destructive" />
        <div className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col pj:gap-0.5">
          <h2 className="pj:text-sm pj:font-semibold">
            {side} (<code className="pj:font-mono">{refName(reference)}</code>) didn&apos;t extract
          </h2>
          <p className="pj:text-muted-foreground">
            {previous ? 'Showing its last extraction that succeeded. ' : other ? `Showing ${other} alone. ` : ''}Saving a fix extracts it
            again.
          </p>
        </div>
        {onRetry && (
          <Button type="button" size="sm" variant="outline" className="pj:h-7" onClick={onRetry}>
            <RefreshCw />
            Extract again
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="pj:h-7" onClick={onDiagnostics}>
          Diagnostics
        </Button>
        <Button type="button" size="sm" variant="outline" className="pj:h-7" onClick={onRawOutput}>
          Raw output
        </Button>
      </div>
      {shown.length > 0 && (
        <ul className="pi-failure-diagnostics pj:flex pj:flex-col pj:gap-1">
          {shown.slice(0, 8).map((diagnostic, index) => (
            <li key={index} className="pj:flex pj:min-w-0 pj:flex-col">
              <span className="pj:flex pj:flex-wrap pj:items-baseline pj:gap-x-2">
                <span className="pj:font-semibold">{diagnostic.severity === 'error' ? 'Error' : 'Warning'}</span>
                <span className="pj:font-mono">{diagnostic.code}</span>
                {diagnostic.path && <code className="pj:break-all pj:font-mono pj:text-muted-foreground">{diagnostic.path}</code>}
              </span>
              {/* What the extractor reported, without the path of the process that ran it; Raw output has its stderr. */}
              <span className="pj:line-clamp-2 pj:break-words" title={failureMessage(diagnostic.message)}>
                {failureMessage(diagnostic.message)}
              </span>
            </li>
          ))}
          {shown.length > 8 && <li className="pj:text-muted-foreground">{shown.length - 8} more in the Diagnostics panel</li>}
        </ul>
      )}
    </section>
  )
}

/** Definition files that couldn't load, each with why and where; the other projections are shown as usual. */
export function InvalidDefinitions({invalid}: {invalid: readonly InspectorInvalidDefinition[]}) {
  return (
    <Alert className="pi-invalid-definitions pj:mx-[var(--pi-gutter)] pj:mt-[var(--pi-gutter)] pj:w-auto pj:py-2" role="status">
      <CircleAlert className="pj:h-4 pj:w-4" />
      <AlertTitle>
        {invalid.length === 1 ? 'A projection definition is invalid' : `${invalid.length} projection definitions are invalid`}; the others
        are shown.
      </AlertTitle>
      <AlertDescription>
        <ul className="pj:list-disc pj:pl-4">
          {invalid.flatMap(item =>
            item.diagnostics.map((diagnostic, index) => (
              <li key={`${item.path}:${index}`} className="pj:break-words" data-invalid-definition={item.id ?? item.path}>
                <span className="pj:font-mono">
                  {diagnostic.location ? `${diagnostic.location.path}:${diagnostic.location.line}` : item.path}
                </span>
                : {diagnostic.message}
              </li>
            )),
          )}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
