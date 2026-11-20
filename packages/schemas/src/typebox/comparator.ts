import {Type} from 'typebox'

/** A named CEL expression, evaluated once and in order, read as `variables.<name>`. */
export interface ComparatorVariable {
  name: string
  description?: string
  expression: string
  /** The values it can take, for checking a `match` on it. */
  values?: (string | number)[]
}

/** A typed, named CEL expression; its call graph must be acyclic. */
export interface ComparatorFunction {
  description?: string
  params?: (string | {name: string; type?: string; values?: (string | number)[]})[]
  returns?: string
  variables?: ComparatorVariable[]
  body: string
}

/** An assertion over the inputs; the first that fails fails the comparison. */
export interface ComparatorCheck {
  assert: string
  message: string
  code?: string
  path?: string
}

/** An identity pass over what earlier passes left unmatched: `key` or `claims`. */
export interface ComparatorIdentityPass {
  name: string
  description?: string
  collections?: ('entities' | 'relationships')[]
  when?: string
  key?: string
  claims?: string
}

/** A step the rules add, made of the changes `changes` selects. */
export interface ComparatorNewStep {
  changes: string
  kind?: 'remove' | 'restructure' | 'add'
  place?: string
  sort?: string
  summary?: string
}

/** A `context` rule: per change it selects, the other items of each revision a person needs to read it. */
export interface ComparatorContextRule {
  name: string
  description?: string
  where?: string
  before?: string
  after?: string
  variables?: ComparatorVariable[]
}

/** Declarative step operations, or `value`, one expression for the whole list. */
export type ComparatorSteps =
  | string
  | {value: string; variables?: ComparatorVariable[]}
  | {
      add?: ComparatorNewStep[]
      rank?: string
      descending?: boolean
      summary?: string
      variables?: ComparatorVariable[]
    }

/** A comparator file (YAML, `<name>.comparator.yaml`), as parsed. */
export interface ComparatorFile {
  $schema?: string
  format: 'projections.comparator'
  version: 0
  description?: string
  defaults?: {[option: string]: unknown}
  checks?: ComparatorCheck[]
  variables?: ComparatorVariable[]
  functions?: {[name: string]: ComparatorFunction}
  identity?: ComparatorIdentityPass[]
  classify?: {where?: string; summary?: string; annotation?: string; variables?: ComparatorVariable[]}
  context?: ComparatorContextRule[]
  steps?: ComparatorSteps
  metadata?: {values: {[key: string]: string}; variables?: ComparatorVariable[]}
}

/**
 * The comparator file format, published at
 * `https://schemas.projections.githubnext.com/comparator/v0.json`. The
 * rules interpreter (`packages/comparators/rules`) validates every file against it
 * after reading the YAML, then checks every expression's types.
 */
export const ComparatorFileSchema = Type.Unsafe<ComparatorFile>({
  description:
    'A custom comparator file (`<name>.comparator.yaml`): YAML declarations the rules interpreter runs over the default comparator, sandboxed. Identity passes add correspondences; comparator rules, CEL expressions checked against declared types when the file loads, classify changes, order them into steps and add metadata. See the guide\'s "Write a custom comparator" and docs/design/declarative-comparators.md.',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'version'],
  properties: {
    $schema: {
      type: 'string',
      description: 'Editors: `# yaml-language-server: $schema=<url>` at the top of the file works too.',
    },
    format: {
      const: 'projections.comparator',
    },
    version: {
      const: 0,
    },
    description: {
      type: 'string',
    },
    defaults: {
      description:
        "Option values for options the comparison doesn't set. Every expression, functions included, reads them as `options.<name>`; an option the definition sets replaces its default.",
      type: 'object',
    },
    functions: {
      description:
        "Named, typed expressions. A body sees its parameters, its own variables and the inputs (`before`, `after`, `lookup`, `options`, `baseline`), never its caller's variables or the file's (share option defaults through `defaults`). The call graph must be acyclic, so every evaluation terminates.",
      type: 'object',
      propertyNames: {
        $ref: '#/$defs/identifier',
      },
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['body'],
        properties: {
          description: {
            type: 'string',
          },
          params: {
            type: 'array',
            items: {
              oneOf: [
                {
                  $ref: '#/$defs/identifier',
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name'],
                  properties: {
                    name: {
                      $ref: '#/$defs/identifier',
                    },
                    type: {
                      $ref: '#/$defs/type',
                    },
                    values: {
                      $ref: '#/$defs/values',
                    },
                  },
                },
              ],
            },
          },
          returns: {
            $ref: '#/$defs/type',
          },
          variables: {
            $ref: '#/$defs/variables',
          },
          body: {
            $ref: '#/$defs/cel',
          },
        },
      },
    },
    checks: {
      description:
        "Evaluated first, in order. The first `assert` that isn't true fails the comparison with `code` (default `invalid-options`), `path` (default `/options`) and `message`.",
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assert', 'message'],
        properties: {
          assert: {
            $ref: '#/$defs/cel',
          },
          code: {
            type: 'string',
            pattern: '^[a-z][a-z0-9-]*$',
          },
          path: {
            $ref: '#/$defs/cel',
          },
          message: {
            $ref: '#/$defs/cel',
          },
        },
      },
    },
    identity: {
      description:
        'Identity passes, in order. Each pass sees only the items earlier passes left unmatched. Entity passes all run before relationship passes.',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        oneOf: [
          {
            required: ['key'],
          },
          {
            required: ['claims'],
          },
        ],
        properties: {
          name: {
            $ref: '#/$defs/identifier',
          },
          description: {
            type: 'string',
          },
          collections: {
            type: 'array',
            items: {
              enum: ['entities', 'relationships'],
            },
            minItems: 1,
            uniqueItems: true,
          },
          when: {
            description: 'Skips the pass unless true. Sees `pairs`.',
            $ref: '#/$defs/cel',
          },
          key: {
            description:
              'A key per unmatched `item` (on `side` `before` or `after`): any JSON value, compared as canonical JSON, such as `[item.kind, item.label]`; null skips the item. Items whose key is unique on both sides correspond.',
            $ref: '#/$defs/cel',
          },
          claims: {
            description:
              "The other side's IDs an unmatched `item` claims to be. Each connected group of claims is one change: one-to-one, a split, a merge, or an ambiguous-correspondence error.",
            $ref: '#/$defs/cel',
          },
        },
      },
    },
    classify: {
      description:
        'Evaluated per change, in change order, with `change`, `origin` (the identity pass that matched it, or null), `befores`, `afters`, `beforeItem`, `afterItem`, `changes`, `pairs` and `changeOf`.',
      type: 'object',
      additionalProperties: false,
      properties: {
        where: {
          $ref: '#/$defs/cel',
        },
        summary: {
          description: 'A string, or null to leave the summary unset.',
          $ref: '#/$defs/cel',
        },
        annotation: {
          description: 'Any JSON value, or null; available afterwards as `annotations[change.id]`.',
          $ref: '#/$defs/cel',
        },
        variables: {
          $ref: '#/$defs/variables',
        },
      },
    },
    context: {
      description:
        "Context rules, in order, each evaluated after `classify` per change whose status or identity changed, seeing what `classify` sees and `annotation`. Each adds to the change's context, the other items a person needs to read it; context only grows from the core's and never hides a change.",
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        anyOf: [{required: ['before']}, {required: ['after']}],
        properties: {
          name: {
            description: 'Unique among the context rules; the comparison names it in the context it added to.',
            $ref: '#/$defs/identifier',
          },
          description: {
            type: 'string',
          },
          where: {
            description: 'Skips the change unless true.',
            $ref: '#/$defs/cel',
          },
          before: {
            description:
              "A `list<string>` of before item IDs (entities or relationships): a removal's context, or what the change needs before. The change's own items are left out.",
            $ref: '#/$defs/cel',
          },
          after: {
            description: "A `list<string>` of after item IDs (entities or relationships). The change's own items are left out.",
            $ref: '#/$defs/cel',
          },
          variables: {
            $ref: '#/$defs/variables',
          },
        },
      },
    },
    steps: {
      description:
        "How the steps are made. Declarative: start from the baseline's steps (dropping changes the comparison no longer has), `add` new steps, `rank` them, then `summary`. Or `value`, one CEL expression for the whole list (the escape hatch).",
      oneOf: [
        {
          $ref: '#/$defs/cel',
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: {
            value: {
              description: 'The steps, as a list of `{changes, kind?, summary?}`, with `changes`, `annotations`, `pairs` and `changeOf`.',
              $ref: '#/$defs/cel',
            },
            variables: {
              $ref: '#/$defs/variables',
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            add: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['changes'],
                properties: {
                  changes: {
                    description:
                      'Per change (`change`, `origin`, `annotation`): whether it belongs to the new step. Selected changes leave the steps they were in; steps left empty go.',
                    $ref: '#/$defs/cel',
                  },
                  kind: {
                    enum: ['remove', 'restructure', 'add'],
                  },
                  sort: {
                    description:
                      'Per change: a sort key (null, bool, number, string or list of them; strings in UTF-16 order). Default: entities, then relationships, each by ID.',
                    $ref: '#/$defs/cel',
                  },
                  summary: {
                    description: "With `members`, the step's changes: a string, or null for none.",
                    $ref: '#/$defs/cel',
                  },
                  place: {
                    description:
                      'Where the step goes: `start`, `end` (default), `before:<kind>` (before the first step of that kind, else last) or `after:<kind>` (after the last, else first).',
                    type: 'string',
                    pattern: '^(start|end|(before|after):(remove|restructure|add))$',
                  },
                },
              },
            },
            rank: {
              description:
                'Per change (`change`, `origin`, `annotation`): a number, a list of numbers (the least counts) or null. Steps are stably sorted by their best-ranked change; steps without a rank keep their order after the ranked ones.',
              $ref: '#/$defs/cel',
            },
            descending: {
              description: 'Higher ranks first.',
              type: 'boolean',
            },
            summary: {
              description:
                "Per step, with `step`, `members` and `lead` (the first change with the best rank, or null): a string, or null to keep the step's summary.",
              $ref: '#/$defs/cel',
            },
            variables: {
              $ref: '#/$defs/variables',
            },
          },
        },
      ],
    },
    metadata: {
      description: "Comparison metadata keys, merged over the baseline's; a null value is omitted.",
      type: 'object',
      additionalProperties: false,
      required: ['values'],
      properties: {
        values: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/cel',
          },
        },
        variables: {
          $ref: '#/$defs/variables',
        },
      },
    },
    variables: {
      $ref: '#/$defs/variables',
    },
  },
  $defs: {
    identifier: {
      type: 'string',
      pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
    },
    cel: {
      description: 'A CEL expression.',
      type: 'string',
      minLength: 1,
    },
    variables: {
      description:
        'Named values, evaluated once and in order, each able to use the earlier ones; expressions read them as `variables.<name>`.',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'expression'],
        properties: {
          name: {
            $ref: '#/$defs/identifier',
          },
          description: {
            type: 'string',
          },
          expression: {
            $ref: '#/$defs/cel',
          },
          values: {
            $ref: '#/$defs/values',
          },
        },
      },
    },
    values: {
      description:
        "The values a variable or parameter can take. A `match` on it warns about keys outside them and values it doesn't handle.",
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: {
        oneOf: [{type: 'string'}, {type: 'integer'}],
      },
    },
    type: {
      description:
        "A declared type: `string`, `int`, `double`, `bool`, `dyn`, `list<T>`, `map<K, V>`, `optional<T>`, or one of the protocol's object types (`Extraction`, `Entity`, `Relationship`, `Item`, `Change`, `Step`, `Comparison`, `Side`, `Lookup`, `Finding`, `Classification`, `Pairs`).",
      type: 'string',
      minLength: 1,
    },
  },
} as const)
