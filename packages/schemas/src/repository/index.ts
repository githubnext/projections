import type {TSchema} from 'typebox'
import * as fixtures from './fixtures.js'
import * as tooling from './tooling.js'

/** An internal schema for one of the repository's own files: written to `internal/<name>.json`, never published. */
export interface RepositorySchema {
  name: string
  title: string
  /** The files it describes, which .dollarlint.toml associates with it. */
  files: string
  schema: TSchema
}

export const repositorySchemas: RepositorySchema[] = [
  {name: 'portability', title: 'Portability exceptions', files: '.portability.yaml', schema: tooling.PortabilitySchema},
  {name: 'verus', title: 'Verus pins', files: 'packages/engine/verified/verus.toml', schema: tooling.VerusSchema},
  {name: 'notices', title: 'Third-party notices', files: 'notices/notices.json', schema: tooling.NoticesSchema},
  {
    name: 'machines-baseline',
    title: 'Lifecycle rule baseline',
    files: 'tools/scripts/check-machines/baseline.json',
    schema: tooling.MachinesBaselineSchema,
  },
  {
    name: 'engine-measurements',
    title: 'Engine measurements',
    files: 'docs/design/engine-measurements.json',
    schema: tooling.EngineMeasurementsSchema,
  },
  {
    name: 'upstream-components',
    title: 'Vendored shadcn/ui release',
    files: 'packages/host/core/src/ui/components/upstream/manifest.json',
    schema: tooling.UpstreamComponentsSchema,
  },
  {
    name: 'vscode-theme',
    title: 'Captured VS Code theme',
    files: 'packages/host/vscode-ui/fixtures/themes/*.json',
    schema: fixtures.VscodeThemeSchema,
  },
  {
    name: 'example-cases',
    title: 'Sample extractor cases',
    files: 'examples/extractors/*/test/cases.json',
    schema: fixtures.ExampleCasesSchema,
  },
  {
    name: 'comparator-golden',
    title: "An original comparator's recorded verdicts",
    files: 'packages/comparators/rules/tests/golden/*.json',
    schema: fixtures.ComparatorGoldenSchema,
  },
  {
    name: 'conformance',
    title: 'Engine conformance corpus',
    files: 'packages/schemas/fixtures/conformance.json',
    schema: fixtures.ConformanceSchema,
  },
  {
    name: 'extractor-helpers',
    title: 'Extractor helper cases',
    files: 'packages/schemas/fixtures/extractor-helpers.json',
    schema: fixtures.ExtractorHelpersSchema,
  },
]

/** `schema` as an internal JSON Schema document. */
export function repositorySchemaDocument({title, files, schema}: RepositorySchema): {[key: string]: unknown} {
  const {description, ...json} = JSON.parse(JSON.stringify(schema)) as {description?: string; [key: string]: unknown}
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${title} (internal)`,
    description: `${description ? `${description} ` : ''}Generated from packages/schemas/src/repository; internal and unversioned, never published. Validates ${files} (see .dollarlint.toml).`,
    ...json,
  }
}
