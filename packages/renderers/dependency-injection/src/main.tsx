import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {zoomControls} from '@githubnext/projections-renderer-kit'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {DependencyInjectionRenderer} from './renderer.js'
import {dependencyInjectionFacts, dependencyInjectionNouns} from './summary.js'
import {accepts} from './accepts.js'

mountRenderer(DependencyInjectionRenderer, {
  name: 'dependency-injection',
  accepts,
  capabilities: {changeHighlighting: 'supported', comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff']},
  // The host's summary bar counts services, registrations and links, and states the facets that changed.
  nouns: dependencyInjectionNouns,
  facts: dependencyInjectionFacts,
  controls: zoomControls,
})
