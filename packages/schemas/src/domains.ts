// The typed `data` rules of the domain schemas: one declarative source for the TypeBox schemas (and so the
// published JSON Schemas), the TypeScript types renderers receive, and the rules fixture the engine's own
// rule table must equal. No TypeBox import here, so the types derive from it without loading TypeBox.
//
// Rules type only the fields built-in renderers and comparators read; every other `data` field stays open
// JSON. The engine enforces each rule with a diagnostic at the field's JSON path.

import {apiContract, apiDeclarationKinds} from './api-contract.js'
import type {DomainSchema, Json, Vocabulary} from './constants.js'

/** The value types a rule can require, and what the engine checks for each. */
export const fieldTypes = {
  text: 'a nonempty string (not only whitespace)',
  string: 'a string',
  number: 'a finite number',
  nonnegative: 'a finite number, zero or more',
  boolean: 'a boolean',
  'nullable-string': 'a string, or null when unknown',
  strings: 'an array of strings',
  object: 'an object',
  enum: 'one of the listed strings',
  array: 'an array whose every item has the item type',
  record: 'an object with typed fields, and no others',
} as const
/** A value type a data rule can require, such as `text` or `nonnegative`; `fieldTypes` says what each accepts. */
export type FieldType = keyof typeof fieldTypes
/** The types without parts: every type but `enum`, `array` and `record`. */
export type PrimitiveType = Exclude<FieldType, 'enum' | 'array' | 'record'>

/** The TypeScript value each primitive field type guarantees, which `ValueOf` and `DataOf` build typed `data` from. */
export interface FieldValues {
  text: string
  string: string
  number: number
  nonnegative: number
  boolean: boolean
  'nullable-string': string | null
  strings: string[]
  object: {[key: string]: Json}
}

/**
 * A value's type: a primitive type; one of a list of strings; an array of a type; or a record, an object
 * whose fields have types, and which has no other fields. A record's `name` makes it a definition of its
 * schema's document, which every use refers to.
 */
export type Shape =
  | {type: PrimitiveType}
  | {type: 'enum'; values: readonly string[]}
  | {type: 'array'; items: Shape}
  | {type: 'record'; name: string; about: string; fields: {readonly [name: string]: FieldRule}}

/** A field's type, whether every item must carry it, and what it means. Nullable fields are optional. */
export type FieldRule =
  | (Exclude<Shape, {type: 'nullable-string'}> & {required?: true; description: string})
  | {type: 'nullable-string'; required?: never; description: string}

/**
 * One rule typing `data` fields: in extractions of `schema` (and, with `vocabulary`, only those that declare it), the
 * items of `collection` with one of `kinds` must carry `fields` as typed. Fields it doesn't name stay open JSON.
 */
export interface DataRule {
  schema: DomainSchema
  /** The vocabulary the rule belongs to: it applies only to extractions that declare it. */
  vocabulary?: Vocabulary
  collection: 'entities' | 'relationships'
  /** The kinds the rule applies to; every kind when absent. A kind appears in at most one rule per collection and vocabulary. */
  kinds?: readonly string[]
  fields: {readonly [name: string]: FieldRule}
}

/** What each domain schema is for, and what it adds to the extraction envelope. */
export const domainDescriptions = {
  'graph/v0': 'Entities and directed relationships between them; the general choice. Adds no rules to the envelope.',
  'dag/v0': 'Like `graph/v0`, with no cycles: steps, stages, job or build order. The engine rejects cycles.',
  'treemap/v0':
    'A containment forest (at most one parent each, no cycles) whose leaves carry a nonnegative `data.value`. The engine checks the forest and that leaves are weighted.',
  'metrics/v0': 'Measurements: every entity carries a numeric `data.value`, and optionally a `data.unit`.',
  'api/v0':
    'Public API declarations: declaration entities carry `data.signature`, and optionally `data.contract`, their compatibility facts in terms every ecosystem shares.',
  'database/v0': 'Tables, columns, keys and constraints, and the relations between them; columns carry `data.type`.',
  'architecture/v0': 'Components and their connections, as `graph/v0`, for architecture and infrastructure.',
} as const satisfies {[schema in DomainSchema]: string}

/** What each vocabulary is for, the domain schemas it applies to, and the design document that defines it. */
export const vocabularies = {
  'dependency-injection/v0': {
    schemas: ['architecture/v0'],
    document: 'docs/models/dependency-injection-model.md',
    description:
      'Dependency-injection containers: services, the registrations that bind them with a lifetime, the implementations they produce, and the services implementations depend on.',
  },
  'infrastructure/v0': {
    schemas: ['architecture/v0'],
    document: 'docs/models/infrastructure-model.md',
    description: 'Infrastructure as code and deployment plans: resources, data sources, modules and resource groups, with planned actions.',
  },
  'runtime-policy/v0': {
    schemas: ['architecture/v0'],
    document: 'docs/models/runtime-policy-model.md',
    description:
      'Kernel runtime policies, such as Tetragon: policies, probes, the hooks they attach to, selectors and the workloads they cover.',
  },
} as const satisfies {[vocabulary in Vocabulary]: {schemas: readonly DomainSchema[]; document: string; description: string}}

/**
 * Every typed `data` rule of the domain schemas and vocabularies, the single source of the published JSON Schemas'
 * `data` types, of `DataOf` and of `fixtures/data-rules.json`, which the engine's own rule table must equal. They
 * type only the fields built-in renderers and comparators read; the engine reports a violation as a diagnostic at the
 * field's JSON path.
 */
export const dataRules = [
  {
    schema: 'treemap/v0',
    collection: 'entities',
    fields: {
      value: {
        type: 'nonnegative',
        description: "The entity's weight. Required on leaves (entities that contain nothing); optional on containers.",
      },
    },
  },
  {
    schema: 'metrics/v0',
    collection: 'entities',
    fields: {
      value: {type: 'number', required: true, description: 'The measurement.'},
      unit: {type: 'string', description: "The measurement's unit, an exact label such as `lines` or `ms`."},
    },
  },
  {
    schema: 'api/v0',
    collection: 'entities',
    kinds: apiDeclarationKinds,
    fields: {
      signature: {type: 'string', required: true, description: 'The declaration as source shows it, such as `(a: string) => void`.'},
    },
  },
  {
    schema: 'api/v0',
    collection: 'entities',
    fields: {
      contract: {
        ...apiContract,
        description: 'The facts compatibility rules read about the declaration, in terms every ecosystem shares.',
      },
    },
  },
  {
    schema: 'database/v0',
    collection: 'entities',
    kinds: ['column'],
    fields: {
      type: {
        type: 'text',
        required: true,
        description: "The column's type as the framework or source declares it, such as Prisma's `String` or Django's `CharField`.",
      },
      databaseType: {
        type: 'nullable-string',
        description: "The column's native database type with its arguments, such as `varchar(200)`; null or absent when unknown.",
      },
      nullable: {type: 'boolean', description: 'Whether the column accepts null.'},
      primaryKey: {type: 'boolean', description: "Whether the column is (part of) its table's primary key."},
    },
  },
  {
    schema: 'database/v0',
    collection: 'entities',
    kinds: ['constraint'],
    fields: {
      type: {type: 'string', description: 'The kind of constraint, such as `primary-key`, `unique` or `foreign-key`.'},
      table: {type: 'string', description: "The constrained table's label, when no relationship connects them."},
      columns: {type: 'strings', description: 'The constrained columns, by label.'},
    },
  },
  {
    schema: 'database/v0',
    collection: 'entities',
    kinds: ['primary-key'],
    fields: {
      table: {type: 'string', description: "The keyed table's label, when no relationship connects them."},
      columns: {type: 'strings', description: 'The key columns, by label.'},
    },
  },
  {
    schema: 'database/v0',
    collection: 'relationships',
    kinds: ['foreign-key', 'relation'],
    fields: {
      columns: {type: 'strings', description: 'The dependent table’s columns, by label, when the relationship connects tables.'},
      principalColumns: {type: 'strings', description: 'The referenced columns, by label, in the order of `columns`.'},
    },
  },
  // dependency-injection/v0 (docs/models/dependency-injection-model.md)
  {
    schema: 'architecture/v0',
    vocabulary: 'dependency-injection/v0',
    collection: 'entities',
    kinds: ['service'],
    fields: {
      type: {type: 'string', description: 'The contract consumers ask for; the label otherwise.'},
      key: {type: 'string', description: "A keyed service's key."},
      name: {type: 'string', description: "The container's own name for the service."},
      module: {type: 'string', description: 'The module that provides it (NestJS).'},
    },
  },
  {
    schema: 'architecture/v0',
    vocabulary: 'dependency-injection/v0',
    collection: 'entities',
    kinds: ['registration'],
    fields: {
      lifetime: {type: 'string', description: '`singleton`, `scoped` or `transient`, read case-insensitively.'},
      scope: {type: 'string', description: "The container's own name for the lifetime, such as `prototype` or `request`."},
      declaredLifetime: {type: 'string', description: 'The lifetime the registration asked for, when the container changed it.'},
      ordinal: {type: 'number', description: 'Registration order; the container resolves the last registration of a service.'},
      implementation: {type: 'string', description: 'The implementation type the registration names.'},
      module: {type: 'string', description: 'The module that provides it (NestJS).'},
    },
  },
  {
    schema: 'architecture/v0',
    vocabulary: 'dependency-injection/v0',
    collection: 'entities',
    kinds: ['implementation'],
    fields: {type: {type: 'string', description: 'The implementation type.'}},
  },
  {
    schema: 'architecture/v0',
    vocabulary: 'dependency-injection/v0',
    collection: 'relationships',
    kinds: ['dependsOn'],
    fields: {
      parameter: {type: 'string', description: 'The parameter, property or field that receives the service.'},
      optional: {type: 'boolean', description: 'Whether the dependency may be missing.'},
      collection: {type: 'boolean', description: 'Whether every registration of the service is injected, as a collection.'},
    },
  },
  // infrastructure/v0 (docs/models/infrastructure-model.md)
  {
    schema: 'architecture/v0',
    vocabulary: 'infrastructure/v0',
    collection: 'entities',
    fields: {
      type: {type: 'string', description: "The ecosystem's resource type."},
      provider: {type: 'string', description: "Terraform's provider source address, or ARM's resource provider namespace."},
      action: {
        type: 'string',
        description:
          'The planned action: `create`, `update`, `replace`, `delete`, `read`, `import`, `forget` or `deploy`; absent when nothing happens.',
      },
      replaceOrder: {type: 'string', description: '`destroy-before-create` or `create-before-destroy`.'},
    },
  },
  // runtime-policy/v0 (docs/models/runtime-policy-model.md)
  {
    schema: 'architecture/v0',
    vocabulary: 'runtime-policy/v0',
    collection: 'entities',
    kinds: ['policy'],
    fields: {
      namespace: {
        type: 'nullable-string',
        description:
          'The namespace of a namespaced policy, empty when it comes from where the policy is applied; null for a cluster-wide policy.',
      },
      mode: {type: 'string', description: '`enforce` or `monitor`.'},
      scope: {type: 'string', description: 'The workloads it applies to, in plain language.'},
      nodes: {type: 'string', description: 'Where the agent loads it.'},
      effect: {type: 'string', description: 'The strongest effect of its selectors.'},
    },
  },
  {
    schema: 'architecture/v0',
    vocabulary: 'runtime-policy/v0',
    collection: 'entities',
    kinds: ['hook'],
    fields: {
      hookType: {type: 'string', description: '`kprobe`, `fentry`, `tracepoint`, `lsm`, `uprobe`, `usdt` or `loader`.'},
      stability: {type: 'string', description: 'How stable the hook is across kernels, such as `stable` or `kernel-internal`.'},
      category: {type: 'string', description: 'What the hook observes, such as `file` or `network`.'},
    },
  },
  {
    schema: 'architecture/v0',
    vocabulary: 'runtime-policy/v0',
    collection: 'entities',
    kinds: ['selector'],
    fields: {
      effect: {type: 'string', description: 'What happens when it matches, such as `enforce` or `observe`.'},
      enforcement: {type: 'string', description: '`active`, `elided` (in a `monitor` policy) or `none`.'},
      ordinal: {type: 'number', description: 'Its position in its probe.'},
    },
  },
  {
    schema: 'architecture/v0',
    vocabulary: 'runtime-policy/v0',
    collection: 'entities',
    kinds: ['subject'],
    fields: {subjectKind: {type: 'string', description: '`workloads` or `binary`.'}},
  },
  {
    schema: 'architecture/v0',
    vocabulary: 'runtime-policy/v0',
    collection: 'relationships',
    kinds: ['matches', 'excludes'],
    fields: {
      operator: {type: 'string', description: 'How the binary path matches, such as `In` or `Prefix`.'},
      parent: {type: 'boolean', description: 'Whether it filters on the parent binary.'},
    },
  },
] as const satisfies readonly DataRule[]

// Types --------------------------------------------------------------------------------------------------------

type Rules = (typeof dataRules)[number]
/** The values of a shape. */
export type ValueOf<S> = S extends {type: 'enum'; values: readonly (infer V)[]}
  ? V
  : S extends {type: 'array'; items: infer I}
    ? ValueOf<I>[]
    : S extends {type: 'record'; fields: infer F}
      ? Merge<Required<F> & Optional<F>>
      : S extends {type: infer T extends PrimitiveType}
        ? FieldValues[T]
        : never
type Optional<F> = {[K in keyof F as F[K] extends {required: true} ? never : K]?: ValueOf<F[K]>}
type Required<F> = {[K in keyof F as F[K] extends {required: true} ? K : never]: ValueOf<F[K]>}
type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never
type Merge<T> = {[K in keyof T]: T[K]}
/** No fields: the identity of field intersections. */
type NoFields = Record<never, never>

/** `data` with the typed fields of `fields`, and any other JSON. */
export type TypedData<F> = Merge<Required<F> & Optional<F>> & {[key: string]: Json}

// Rules for schema S and collection C that apply with the vocabularies V.
type RulesOf<S extends DomainSchema, C extends DataRule['collection'], V extends Vocabulary> =
  Extract<Rules, {schema: S; collection: C}> extends infer R ? (R extends {vocabulary: infer W} ? (W extends V ? R : never) : R) : never
type EveryKindFields<S extends DomainSchema, C extends DataRule['collection'], V extends Vocabulary> = UnionToIntersection<
  (Exclude<RulesOf<S, C, V>, {kinds: readonly string[]}> extends infer R ? (R extends {fields: infer F} ? F : never) : never) | NoFields
>
/** The kinds a domain schema, with vocabularies `V`, types in a collection. */
export type TypedKind<S extends DomainSchema, C extends DataRule['collection'], V extends Vocabulary = never> =
  Extract<RulesOf<S, C, V>, {kinds: readonly string[]}> extends {kinds: readonly (infer K extends string)[]} ? K : never
type KindFields<S extends DomainSchema, C extends DataRule['collection'], V extends Vocabulary, K extends string> =
  Extract<RulesOf<S, C, V>, {kinds: readonly string[]}> extends infer R
    ? R extends {kinds: readonly (infer L)[]; fields: infer F}
      ? K extends L
        ? F
        : never
      : never
    : never

/** The `data` of an item of kind `K` in schema `S` with vocabularies `V`, as the engine guarantees it. */
export type DataOf<
  S extends DomainSchema,
  C extends DataRule['collection'],
  K extends string = string,
  V extends Vocabulary = never,
> = TypedData<EveryKindFields<S, C, V> & (string extends K ? NoFields : UnionToIntersection<KindFields<S, C, V, K> | NoFields>)>
