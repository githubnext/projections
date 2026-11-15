// The header's full-screen control: where the host can show the view outside the conversation (a side panel or full
// screen, which hosts report as `fullscreen`) and doesn't yet, a button asks it to. Hosts grant it only from a click.
import {useSyncExternalStore} from 'react'
import type {ReactNode} from 'react'
import {PanelRight} from 'lucide-react'
import {Button} from '@githubnext/projections-host/ui/components'
import type {Host} from './host.js'

function Expand({host}: {host: Host}) {
  const subscribe = (listener: () => void) => host.onContext(listener)
  const offered = () => {
    const context = host.context()
    return Boolean(context.availableDisplayModes?.includes('fullscreen') && context.displayMode !== 'fullscreen')
  }
  if (!useSyncExternalStore(subscribe, offered, offered)) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="pi-viewer-expand"
      aria-label="Show beside the conversation"
      title="Show beside the conversation"
      onClick={() => void host.request('ui/request-display-mode', {mode: 'fullscreen'}).catch(() => {})}
    >
      <PanelRight aria-hidden="true" />
    </Button>
  )
}

export const expandButton = (host: Host): ReactNode => <Expand host={host} />
