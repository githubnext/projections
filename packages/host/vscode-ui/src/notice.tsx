import type {ReactNode} from 'react'
import {VscButton} from './elements.js'

/**
 * An inline message drawn like VS Code's input validation messages and notifications: the severity's codicon in its
 * color (`--vscode-notificationsInfoIcon-foreground` and its siblings) on the validation background and border, with
 * optional VS Code buttons. VSCode Elements has no banner.
 */
export function Notice({
  severity = 'info',
  title,
  hideTitle = false,
  children,
  actions,
  className,
}: {
  severity?: 'info' | 'warning' | 'error'
  title: string
  /** Name the message with its title without showing it (the description says it all). */
  hideTitle?: boolean
  children?: ReactNode
  actions?: readonly {label: string; onClick: () => void; secondary?: boolean}[]
  className?: string
}) {
  return (
    <div className={`phv-notice ${className ?? ''}`} data-severity={severity}>
      <span className={`codicon codicon-${severity} phv-notice-icon`} aria-hidden="true" />
      <div className="phv-notice-body">
        <p className={hideTitle ? 'phv-visually-hidden' : 'phv-notice-title'}>{title}</p>
        {children != null && <div className="phv-notice-description">{children}</div>}
        {actions && actions.length > 0 && (
          <div className="phv-notice-actions">
            {actions.map(action => (
              <VscButton key={action.label} secondary={action.secondary ?? false} onClick={action.onClick}>
                {action.label}
              </VscButton>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
