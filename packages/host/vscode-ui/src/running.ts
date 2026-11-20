// The running indicator is the host core's (`@githubnext/projections-host/running`), React- and DOM-free, so the
// extension host keeps importing it from here (`@githubnext/projections-host-vscode/running`).
export {runningDelayMs, runningIndicator, runningMinimumMs, runningText} from '@githubnext/projections-host/running'
export type {Running, RunningTimers} from '@githubnext/projections-host/running'
