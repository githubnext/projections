// The graph's footer strip: the focused item's label or caption, and the menu of shared dependencies.
import type {TransitionEdge, TransitionNode} from '../../graph-transition.js'
import {displayed} from './cards.js'

/**
 * The footer strip takes a row only when it has something to say: the focused item's label, the animated
 * comparison's caption (a held pane of side by side or swipe shows one revision, so it doesn't apply there) or the
 * shared dependencies. Otherwise its status stays mounted, visually hidden, so a new focus is still announced.
 */
export function GraphFooter(props: {
  caption: string
  shared: readonly TransitionEdge[]
  nodeById: ReadonlyMap<string, TransitionNode>
  sharedOpen: boolean
  setSharedOpen: (open: boolean | ((open: boolean) => boolean)) => void
  onSelect: (id: string) => void
}) {
  const {caption, shared, nodeById, sharedOpen, setSharedOpen, onSelect} = props
  return (
    <div className={caption || shared.length > 0 ? 'graph-footer' : 'sr-only'}>
      <span role="status">{caption}</span>
      {shared.length > 0 && (
        <div className="shared-routes">
          <button type="button" aria-expanded={sharedOpen} onClick={() => setSharedOpen(open => !open)}>
            <span className="pk-label">Inspect {shared.length} shared dependencies</span>
          </button>
          {sharedOpen && (
            <ul className="shared-routes-list" aria-label="Shared dependencies">
              {shared.map(edge => (
                <li key={edge.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setSharedOpen(false)
                      onSelect(edge.id)
                    }}
                  >
                    <span className="pk-label">
                      {displayed(nodeById.get(edge.fromId)!).label} → {displayed(nodeById.get(edge.toId)!).label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
