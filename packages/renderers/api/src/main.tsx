import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {ApiView} from './view.js'
import {apiFacts, apiNouns} from './summary.js'
import {accepts} from './accepts.js'

// Containment relationships are shown as nesting, never drawn on their own.
mountRenderer(ApiView, {
  name: 'api',
  accepts,
  capabilities: {changeHighlighting: 'supported', comparisonModes: ['side-by-side', 'diff'], drawsRelationships: false},
  // The host's summary bar counts declarations and, in a classified comparison, the changes at each compatibility level.
  nouns: apiNouns,
  facts: apiFacts,
})
