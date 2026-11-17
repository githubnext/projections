import '@githubnext/projections-renderer-kit/react.css'
import './styles.css'
import {zoomControls} from '@githubnext/projections-renderer-kit'
import {mountRenderer} from '@githubnext/projections-renderer-kit/react'
import {defineControls} from '@githubnext/projections-renderer-sdk/protocol'
import {DatabaseRenderer} from './view.js'
import {databaseFacts} from './facts.js'
import {accepts} from './accepts.js'

mountRenderer(DatabaseRenderer, {
  name: 'database',
  // The Changes scope lays out only the changed tables and their context; a shown table's other columns fold into one row.
  scope: {layout: 'subset', parts: 'fold'},
  accepts,
  capabilities: {changeHighlighting: 'supported', comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff']},
  // The schema's own words, cards first; the relationships that only attach columns, keys and enums to a table, or a
  // key to the table it references, are structure. Foreign keys are `foreign-key` or `relation` relationships.
  nouns: {
    table: {singular: 'table', plural: 'tables'},
    column: {singular: 'column', plural: 'columns'},
    'primary-key': {singular: 'primary key', plural: 'primary keys'},
    'relationships:foreign-key': {singular: 'foreign key', plural: 'foreign keys'},
    relation: {singular: 'foreign key', plural: 'foreign keys'},
    'entities:index': {singular: 'index', plural: 'indexes'},
    'entities:constraint': {singular: 'constraint', plural: 'constraints'},
    'unique-key': {singular: 'unique key', plural: 'unique keys'},
    'check-constraint': {singular: 'check constraint', plural: 'check constraints'},
    'many-to-many': {singular: 'many-to-many relationship', plural: 'many-to-many relationships'},
    enum: {singular: 'enum', plural: 'enums'},
    references: false,
    'relationships:index': false,
    'relationships:constraint': false,
    contains: false,
    constrains: false,
    'enum-type': false,
    'index-column': false,
    'key-column': false,
  },
  // What the kind counts can't say: type and nullability changes, renames and the enums' values.
  facts: ({model}) => databaseFacts(model),
  controls: defineControls([
    ...zoomControls,
    {
      id: 'showRelationships',
      label: 'Relationships',
      description: 'Draw foreign-key and many-to-many relationships between tables',
      type: 'toggle',
      default: true,
    },
  ]),
})
