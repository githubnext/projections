import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {codeStatisticsControls} from '@githubnext/projections-renderer-kit'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {CodeStatisticsRenderer} from './renderer.js'
import {codeStatisticsFacts, codeStatisticsNouns} from './summary.js'
import {accepts} from './accepts.js'

mountRenderer(CodeStatisticsRenderer, {
  name: 'code-statistics',
  accepts,
  capabilities: {changeHighlighting: 'supported', comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff']},
  // The host's summary bar counts the languages and states the measure's total and its change.
  nouns: codeStatisticsNouns,
  facts: codeStatisticsFacts,
  controls: codeStatisticsControls,
})
