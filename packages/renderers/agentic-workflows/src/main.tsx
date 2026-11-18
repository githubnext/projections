import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {AgenticWorkflowsView} from './view.js'
import {agenticWorkflowsControls, agenticWorkflowsFacts, agenticWorkflowsNouns} from './summary.js'
import {accepts} from './accepts.js'

mountRenderer(AgenticWorkflowsView, {
  name: 'agentic-workflows',
  accepts,
  // Groups hold their workflows' cards, and dispatches are named in what a workflow writes, not drawn.
  capabilities: {changeHighlighting: 'supported', comparisonModes: ['side-by-side', 'diff'], drawsRelationships: false},
  controls: agenticWorkflowsControls,
  // The host's summary bar counts workflows and groups, the lock files out of date and what the comparator found; the
  // view draws no summary of its own.
  nouns: agenticWorkflowsNouns,
  facts: agenticWorkflowsFacts,
})
