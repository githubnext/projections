import {Type} from 'typebox'

/** Where a case's extraction comes from: a fixture file (relative to the test file), an inline extraction or a revision. */
export type ComparatorTestSource = string | {file: string} | {extraction: {[key: string]: unknown}} | {revision: string}

/** A check on the one change `item` or `id` selects. */
export type ComparatorTestChange = ({item: string; id?: never} | {id: string; item?: never}) & {
  collection?: 'entities' | 'relationships'
  status?: 'added' | 'removed' | 'modified' | 'unchanged'
  correspondence?: 'exact' | 'declared' | 'split' | 'merge' | 'none'
  summary?: string | null
  before?: string[]
  after?: string[]
}

/** What a case's comparison must be; every field is optional, and objects match on the keys they list. */
export interface ComparatorTestExpectations {
  order?: string[]
  steps?: {kind?: 'remove' | 'restructure' | 'add'; summary?: string | null; changes?: string[]}[]
  changes?: ComparatorTestChange[]
  count?: {changes?: number; steps?: number}
  metadata?: {[key: string]: unknown}
  error?: string
}

/** One case: two extractions, and expectations, a snapshot or both. */
export interface ComparatorTestCase {
  name: string
  before: ComparatorTestSource
  after: ComparatorTestSource
  options?: {[key: string]: unknown}
  expect?: ComparatorTestExpectations
  snapshot?: string
}

/** A comparator test file (YAML), `X.comparator.test.yaml` beside the comparator file `X.comparator.yaml`. */
export interface ComparatorTests {
  $schema?: string
  format: 'projections.comparator-tests'
  version: 0
  description?: string
  options?: {[key: string]: unknown}
  cases: ComparatorTestCase[]
}

const id = {type: 'string', minLength: 1}
const ids = {type: 'array', items: {$ref: '#/$defs/id'}}
const path = {
  description: 'A path relative to the test file, inside the repository.',
  type: 'string',
  minLength: 1,
  pattern: '^(?![/\\\\])(?![A-Za-z]:)[^\\\\]*$',
}
const summary = {description: 'Exact text; `null` expects none.', type: ['string', 'null']}

/**
 * The comparator test file format, published at
 * `https://schemas.projections.githubnext.com/comparator-tests/v0.json`. The CLI checks test files
 * itself, with line and column; the schema is for editors and `npm run check:comparators`.
 */
export const ComparatorTestsSchema = Type.Unsafe<ComparatorTests>({
  description:
    'Tests for a custom comparator, in the file beside its comparator file (`X.comparator.test.yaml` for `X.comparator.yaml`), never part of the comparator or its digest. Each case gives two extractions and states what the comparator must make of them: partial expectations (step order, steps, changes, counts, metadata, or the error the comparator must fail with) and an optional snapshot of the whole comparison. `projections check` runs them. See docs/contracts.md, "Comparator tests".',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'version', 'cases'],
  properties: {
    $schema: {
      type: 'string',
      description: 'Editors: `# yaml-language-server: $schema=<url>` at the top of the file works too.',
    },
    format: {const: 'projections.comparator-tests'},
    version: {const: 0},
    description: {type: 'string'},
    options: {
      description: "Comparator options for every case without its own; without either, a projection's own options.",
      type: 'object',
    },
    cases: {
      type: 'array',
      minItems: 1,
      items: {$ref: '#/$defs/case'},
    },
  },
  $defs: {
    id: {...id, description: 'A change ID, or an item ID naming the changes whose `before` or `after` includes it.'},
    case: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'before', 'after'],
      anyOf: [{required: ['expect']}, {required: ['snapshot']}],
      properties: {
        name: {description: "Unique within the file: the case's ID.", type: 'string', minLength: 1},
        before: {$ref: '#/$defs/source'},
        after: {$ref: '#/$defs/source'},
        options: {description: "Comparator options for this case, replacing the file's.", type: 'object'},
        expect: {$ref: '#/$defs/expect'},
        snapshot: {
          ...path,
          description:
            'A JSON file, relative to the test file, holding the whole comparison (sorted keys, two-space indentation). `projections check --update` writes it.',
        },
      },
    },
    source: {
      description:
        "An extraction: a fixture file (an extraction, or a saved `projections.extraction` document) relative to the test file, written inline, or the projection extracted at a revision (`working-tree` for the working tree) with the working tree's definition.",
      oneOf: [
        path,
        {type: 'object', additionalProperties: false, required: ['file'], properties: {file: path}},
        {type: 'object', additionalProperties: false, required: ['extraction'], properties: {extraction: {type: 'object'}}},
        {type: 'object', additionalProperties: false, required: ['revision'], properties: {revision: id}},
      ],
    },
    expect: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        order: {
          description: 'Each listed change or item is in a strictly earlier step than the next.',
          ...ids,
          minItems: 2,
        },
        steps: {
          description: 'Every step, in order; each lists only what it checks.',
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: {enum: ['remove', 'restructure', 'add']},
              summary,
              changes: {...ids, description: "Changes or items naming exactly the step's changes."},
            },
          },
        },
        changes: {
          description: 'Each selects exactly one change, by `item` or `id`, and checks the fields it lists.',
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            oneOf: [{required: ['item']}, {required: ['id']}],
            anyOf: [
              {required: ['status']},
              {required: ['correspondence']},
              {required: ['summary']},
              {required: ['before']},
              {required: ['after']},
            ],
            properties: {
              item: {...id, description: 'Selects the change whose `before` or `after` includes this item ID.'},
              id: {...id, description: 'Selects the change with this ID.'},
              collection: {description: 'Narrows the selection.', enum: ['entities', 'relationships']},
              status: {enum: ['added', 'removed', 'modified', 'unchanged']},
              correspondence: {enum: ['exact', 'declared', 'split', 'merge', 'none']},
              summary,
              before: ids,
              after: ids,
            },
          },
        },
        count: {
          type: 'object',
          additionalProperties: false,
          properties: {
            changes: {type: 'integer', minimum: 0},
            steps: {type: 'integer', minimum: 0},
          },
        },
        metadata: {
          description: 'A subset of the comparison metadata: objects match on the keys they list, arrays and scalars exactly.',
          type: 'object',
        },
        error: {
          description: 'The comparator must fail with a message containing this text. A case expecting an error checks nothing else.',
          type: 'string',
          minLength: 1,
        },
      },
    },
  },
} as const)
