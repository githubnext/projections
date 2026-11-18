import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {GalleryView, options} from './view.js'
import {accepts} from './accepts.js'

mountRenderer(GalleryView, {
  name: 'gallery',
  accepts,
  // The documents' `contains` relationships are their structure: each document's cards are its scenarios.
  capabilities: {changeHighlighting: 'supported', drawsRelationships: false, comparisonModes: ['diff', 'side-by-side', 'animated']},
  ...options,
})
