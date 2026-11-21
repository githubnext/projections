// Schemas for the repository's own tooling files. Each is internal and unversioned: nothing outside this repository
// reads these files.
import Type from 'typebox'
import {Closed, Dictionary} from '../typebox/support.js'

const Text = Type.String({minLength: 1, pattern: '\\S'})
const RepositoryPath = Type.String({minLength: 1, pattern: '^[^/\\\\][^\\\\]*$', description: 'A repository-relative path.'})

/** `.portability.yaml`: the operating-system assumptions in shipped code that are intended (tools/scripts/check-portability.mjs). */
export const PortabilitySchema = Closed({
  allow: Type.Array(
    Closed({
      path: RepositoryPath,
      rule: Type.String({pattern: '^[a-z][a-z0-9-]*$', description: "A rule's name in tools/scripts/check-portability.mjs."}),
      reason: Type.String({minLength: 1, pattern: '\\S', description: 'Why the code is right on Linux, macOS and Windows.'}),
    }),
  ),
})

/** `packages/engine/verified/verus.toml`: the Verus release that proves the verified crate (scripts/verify.mjs). */
export const VerusSchema = Closed({
  release: Type.String({pattern: '^[0-9][0-9A-Za-z.]*$', description: "Verus's release name, such as `0.2026.11.02.8bf68ee`."}),
  toolchain: Type.String({pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$', description: 'The Rust toolchain the release needs.'}),
  macros: Type.String({minLength: 1, description: 'The `verus_builtin_macros` version the release was built with.'}),
})

/** `notices/notices.json`: the upstream license texts in notices/ and the locked crate versions each covers (tools/scripts/notices.mjs). */
export const NoticesSchema = Closed({
  $comment: Type.Optional(Type.String()),
  notices: Type.Array(
    Closed({
      directory: Type.String({pattern: '^[A-Za-z0-9._-]+$', description: 'The directory in notices/ holding the texts.'}),
      crates: Dictionary(Type.Array(Type.String({minLength: 1}), {minItems: 1, uniqueItems: true}), {
        description: 'Each crate the texts cover, with its exact locked versions.',
      }),
      repository: Type.String({pattern: '^https://', description: 'The upstream repository the texts come from.'}),
      tag: Type.String({minLength: 1, description: 'The upstream tag or commit they were taken at.'}),
      files: Dictionary(Type.String({minLength: 1}), {
        minProperties: 1,
        description: 'Each license file in the directory, by the upstream path it was copied from.',
      }),
      note: Type.Optional(Text),
    }),
  ),
})

/** `tools/scripts/check-machines/baseline.json`: the lifecycle findings each file may still have, which only shrink. */
export const MachinesBaselineSchema = Dictionary(Type.Integer({minimum: 1}), {
  propertyNames: {pattern: '^[^/\\\\][^\\\\]*$'},
  description: 'Each file, by repository path, and how many lifecycle-rule findings it may have.',
})

const Milliseconds = Type.Number({minimum: 0})
const Operation = Closed({
  nativeMedianMs: Milliseconds,
  wasmMedianMs: Milliseconds,
  responseBytes: Type.Integer({minimum: 0}),
  agreement: Type.Boolean(),
})

/** `docs/design/engine-measurements.json`: the Engine's measured size, speed and native/Wasm agreement (docs/design/engine-evaluation.md). */
export const EngineMeasurementsSchema = Closed({
  date: Type.String({pattern: '^\\d{4}-\\d{2}-\\d{2}$'}),
  scope: Text,
  environment: Dictionary(Type.String()),
  artifacts: Dictionary(Type.Number({minimum: 0})),
  samples: Type.Array(
    Closed({
      nodes: Type.Integer({minimum: 0}),
      edges: Type.Integer({minimum: 0}),
      stateBytes: Type.Integer({minimum: 0}),
      repetitions: Type.Integer({minimum: 1}),
      operations: Dictionary(Operation),
    }),
  ),
  conformance: Dictionary(Type.Union([Type.Integer({minimum: 0}), Type.Boolean(), Type.Array(Type.String())])),
  qualifications: Type.Array(Text),
})

const Sha = Type.String({pattern: '^[0-9a-f]{40}$'})

/** `packages/host/core/src/ui/components/upstream/manifest.json`: the shadcn/ui release the vendored components come from. */
export const UpstreamComponentsSchema = Closed({
  style: Text,
  version: Type.String({pattern: '^\\d+\\.\\d+\\.\\d+(\\+[0-9a-f]{7,40})?$'}),
  tag: Type.String({pattern: '^shadcn@\\d+\\.\\d+\\.\\d+$'}),
  commit: Sha,
  registryCommit: Sha,
})
