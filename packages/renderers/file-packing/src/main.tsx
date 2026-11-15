import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {FilePackingRenderer} from './view.js'
import {accepts} from './accepts.js'

mountRenderer(FilePackingRenderer, {
  name: 'file-packing',
  accepts,
  // Containment relationships are shown as nesting, never drawn on their own.
  capabilities: {
    changeHighlighting: 'supported',
    comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff'],
    drawsRelationships: false,
  },
  nouns: {file: {singular: 'file', plural: 'files'}, directory: {singular: 'directory', plural: 'directories'}, contains: false},
})
