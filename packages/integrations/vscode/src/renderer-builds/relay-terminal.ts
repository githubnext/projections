import * as vscode from 'vscode'

/**
 * A run's task terminal: shows the output the backend reports for it, and closes with the run's exit code. Closing
 * it (or terminating the task) asks the backend to stop the build.
 */
export class RelayTerminal implements vscode.Pseudoterminal {
  private readonly written = new vscode.EventEmitter<string>()
  private readonly closed = new vscode.EventEmitter<number | void>()
  readonly onDidWrite = this.written.event
  readonly onDidClose = this.closed.event
  execution: vscode.TaskExecution | undefined
  private opened = false
  private ended = false
  private readonly pending: string[] = []
  private exit: number | null | undefined

  private readonly stopped: () => void

  constructor(stopped: () => void) {
    this.stopped = stopped
  }

  open() {
    this.opened = true
    for (const line of this.pending.splice(0)) this.written.fire(`${line}\r\n`)
    if (this.exit !== undefined) this.closed.fire(this.exit ?? 0)
  }

  write(lines: readonly string[]) {
    if (this.ended) return
    if (!this.opened) this.pending.push(...lines)
    else for (const line of lines) this.written.fire(`${line}\r\n`)
  }

  /** The run ended (`exit`), or the terminal is no longer needed (`null`). */
  end(exit: number | null) {
    if (this.ended) return
    this.ended = true
    if (this.opened) this.closed.fire(exit ?? 0)
    else this.exit = exit
    if (exit === null && this.execution && vscode.tasks.taskExecutions.includes(this.execution)) this.execution.terminate()
  }

  close() {
    if (this.ended) return
    this.ended = true
    this.stopped()
  }
}
