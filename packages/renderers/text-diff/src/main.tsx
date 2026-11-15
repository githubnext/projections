import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {TextDiffView} from './view.js'
import {accepts} from './accepts.js'
import {textDiffFacts, textDiffNouns} from './summary.js'

mountRenderer(TextDiffView, {
  name: 'text-diff',
  accepts,
  capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']},
  nouns: textDiffNouns,
  facts: textDiffFacts,
})
