import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {followContext} from '@githubnext/projections-renderer-kit'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {RuntimePolicyView} from './view.js'
import {runtimePolicyFacts, runtimePolicyNouns} from './summary.js'
import {accepts} from './accepts.js'

mountRenderer(RuntimePolicyView, {
  name: 'runtime-policy',
  // The Changes scope lays out only the changed policies and their context, each whole: a changed selector or probe
  // keeps the probe and policy that declare it and the hook it attaches to, where it is drawn.
  scope: {
    layout: 'subset',
    parts: 'whole',
    context: (all, changes) =>
      followContext(all, changes, {incoming: kind => kind === 'declares' || kind === 'filters', outgoing: kind => kind === 'attaches'}),
  },
  accepts,
  // Which workloads a policy applies to is shown as chips inside the policy, not as drawn relationships.
  capabilities: {changeHighlighting: 'supported', comparisonModes: ['side-by-side', 'diff'], drawsRelationships: false},
  // The host's summary bar says how many policies, hooks and rules there are, how many rules enforce and what the
  // comparator found; the view draws no summary of its own.
  nouns: runtimePolicyNouns,
  facts: runtimePolicyFacts,
})
