import * as vscode from 'vscode'
import type {Lease} from '../backends.js'
import type {ListedFile, TestLocation} from '../comparator-tests/wire.js'
import type {OutcomeMessage} from '../comparator-tests/outcomes.js'
import type {TestNode} from '../test-items.js'

/** The last outcome of each item, for tests driving the view (the extension's `comparatorTests` API). */
export interface RecordedOutcome {
  state: 'started' | 'passed' | 'failed' | 'skipped' | 'errored'
  messages: {message: string; path?: string; line?: number; expected?: string; actual?: string}[]
}

/** One projection's checks in a run: the included check items, and whether the whole projection runs. */
export interface Checks {
  folder: vscode.WorkspaceFolder
  projection: string
  whole: boolean
  items: vscode.TestItem[]
}

/** A test file's chosen cases in a run, for one projection or none. */
export interface Cases {
  folder: vscode.WorkspaceFolder
  projection?: string
  path: string
  items: vscode.TestItem[]
}

/** A folder's backend lease, notification subscription, listed test files and each projection's last checks. */
export interface Watched {
  folder: vscode.WorkspaceFolder
  lease: Lease
  unsubscribe?: (() => void) | undefined
  timer?: ReturnType<typeof setTimeout> | undefined
  files: ListedFile[]
  reported: Map<string, string[]>
  /** The tree last applied, to skip applying it again unchanged. */
  applied?: string
}

/** What a test item stands for: its folder and its node of the tree. */
export interface ItemData {
  folder: vscode.WorkspaceFolder
  node: TestNode
}

/** A position in a test file, as VS Code ranges it. */
export function range(location: TestLocation): vscode.Range {
  const position = new vscode.Position(location.line - 1, location.column - 1)
  return new vscode.Range(position, position)
}

/** An outcome's message as the Testing view shows it: a diff when it has an expected or actual value. */
export function testMessage(folder: vscode.WorkspaceFolder, outcome: OutcomeMessage): vscode.TestMessage {
  const message =
    outcome.expected !== undefined || outcome.actual !== undefined
      ? vscode.TestMessage.diff(outcome.message, outcome.expected ?? '', outcome.actual ?? '')
      : new vscode.TestMessage(outcome.message)
  if (outcome.location) {
    message.location = new vscode.Location(vscode.Uri.joinPath(folder.uri, ...outcome.location.path.split('/')), range(outcome.location))
  }
  return message
}

/** The Testing view's state: its controller, what each item stands for, the watched folders and the last outcomes. */
export class TestState {
  readonly data = new WeakMap<vscode.TestItem, ItemData>()
  readonly watched = new Map<string, Watched>()
  readonly recorded = new Map<string, RecordedOutcome>()

  constructor(readonly controller: vscode.TestController) {}

  items(): [string, vscode.TestItem][] {
    const all: [string, vscode.TestItem][] = []
    this.controller.items.forEach(item => all.push([item.id, item]))
    return all
  }

  /** The key an item's outcome is recorded under: `packages/check:extract`, `packages/case:<path>#<case>`, `<path>#<case>`. */
  private key(item: vscode.TestItem): string {
    const node = this.data.get(item)?.node
    if (!node) return item.id
    if (node.projection) return node.kind === 'projection' ? node.projection : `${node.projection}/${node.id}`
    return node.kind === 'case' ? `${node.path}#${node.case}` : (node.path ?? item.id)
  }

  record(item: vscode.TestItem, state: RecordedOutcome['state'], messages: OutcomeMessage[] = []) {
    this.recorded.set(this.key(item), {
      state,
      messages: messages.map(({message, location, expected, actual}) => ({
        message,
        ...(location ? {path: location.path, line: location.line} : {}),
        ...(expected !== undefined ? {expected} : {}),
        ...(actual !== undefined ? {actual} : {}),
      })),
    })
  }

  /** Errors every item with one message. */
  errored(run: vscode.TestRun, items: readonly vscode.TestItem[], message: string) {
    for (const item of items) {
      run.errored(item, new vscode.TestMessage(message))
      this.record(item, 'errored', [{message}])
    }
  }
}
