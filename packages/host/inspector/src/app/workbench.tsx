import type {ComponentProps, ReactNode} from 'react'
import {ScopedRoot, cn} from '@githubnext/projections-host/ui/components'
import {DetailsDock} from '../details.js'
import {shortcutLabel} from '../shell/controls.js'
import {Shell} from '../shell/shell.js'
import type {InspectorDefinitionList} from '../types.js'
import {SetupCard, Tip} from './cards.js'
import {repositoryKey} from './definitions.js'

/**
 * A bare view (`chrome` `none` or `viewer`): the host's banner line, then the view, edge to edge: an editor tab's
 * frame is the editor, and the viewer's page lays its flat chrome under its header.
 */
export function BareFrame({
  colorMode,
  viewer,
  mode,
  banner,
  children,
}: {
  colorMode: 'light' | 'dark'
  viewer: boolean
  mode: 'repository' | 'offline'
  banner: ReactNode
  children: ReactNode
}) {
  return (
    <ScopedRoot colorMode={colorMode} className={cn('pi pi-bare', viewer && 'pi-viewer')} data-mode={mode}>
      <div className="pi-frame pj:flex pj:h-dvh pj:w-full pj:flex-col pj:overflow-hidden pj:bg-background pj:text-foreground">
        {banner}
        {viewer ? <div className="pi-viewer-body pj:flex pj:min-h-0 pj:min-w-0 pj:flex-1 pj:flex-col">{children}</div> : children}
      </div>
    </ScopedRoot>
  )
}

/** The repository's tip and, until dismissed, its setup card, above the stage. */
export interface WorkbenchNotes {
  /** The repository's definitions, when a runner is connected. */
  definitions: InspectorDefinitionList | null | undefined
  /** The Inspector opened on a document, which says what it is without the tip. */
  opened: boolean
  setupDismissed: boolean
  onDismissSetup: () => void
}

function Notes({definitions, opened, setupDismissed, onDismissSetup}: WorkbenchNotes) {
  return (
    <>
      {!opened && definitions && (
        <Tip key={repositoryKey(definitions)} storageKey={`projections-inspector-tip:${repositoryKey(definitions)}`}>
          Edit your projection and save: both sides re-extract and replay · choose Before → After to test against real history ·{' '}
          <kbd className="pj:rounded-sm pj:border pj:bg-background pj:px-1 pj:font-mono pj:text-[10px]">{shortcutLabel('k')}</kbd> for
          everything
        </Tip>
      )}
      {definitions?.setup && !setupDismissed && (
        <SetupCard
          setup={definitions.setup}
          showing={definitions.definitions.map(definition => definition.title ?? definition.id)}
          onDismiss={onDismissSetup}
        />
      )}
    </>
  )
}

/** The workbench: the shell around the stage, with the docked Details panel and the repository's notes. */
export function InspectorWorkbench({
  shell,
  details,
  notes,
  children,
}: {
  shell: Omit<ComponentProps<typeof Shell>, 'sidebarLabel' | 'secondary' | 'children'>
  details: ComponentProps<typeof DetailsDock>
  notes: WorkbenchNotes
  children: ReactNode
}) {
  return (
    <Shell {...shell} sidebarLabel="Explorer" secondary={{label: 'Details', content: <DetailsDock {...details} />}}>
      <Notes {...notes} />
      {children}
    </Shell>
  )
}
