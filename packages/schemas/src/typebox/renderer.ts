import Type from 'typebox'
import {comparisonModes, domainSchemas, vocabularyNames} from '../constants.js'
import {Closed, NonBlank} from './support.js'

/**
 * The JSON Schema of `renderer.json`, the manifest a renderer bundle ships beside its `index.html`, as the renderer
 * SDK's `parseRendererManifest` reads it.
 */
export const RendererManifestSchema = Closed(
  {
    format: Type.Literal('projections.renderer'),
    version: Type.Literal(0),
    name: Type.String({pattern: '^[a-z0-9][a-z0-9-]{0,63}$', description: 'The bundle directory name, such as `basic`.'}),
    title: NonBlank({maxLength: 200, description: "The renderer's name in hosts' messages and menus."}),
    handles: Type.Array(Type.String({pattern: '^[a-z0-9][a-z0-9/.-]{0,63}$'}), {
      maxItems: 100,
      description: 'The definition renderer names the bundle presents, such as `["graph", "dag"]`.',
    }),
    comparisonModes: Type.Optional(
      Type.Array(Type.Enum([...comparisonModes]), {
        minItems: 1,
        uniqueItems: true,
        description: 'The comparison modes the bundle supports; absent means side by side, animated and swipe.',
      }),
    ),
    accepts: Type.Optional(
      Type.Array(Closed({schema: Type.Enum([...domainSchemas]), vocabulary: Type.Optional(Type.Enum([...vocabularyNames]))}), {
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
        description: 'The extractions the bundle presents, by domain schema and optional vocabulary; absent means any.',
      }),
    ),
  },
  {
    description:
      '`renderer.json`, the manifest a renderer bundle ships beside its `index.html`: its name, the definition renderers it presents, and optionally the comparison modes and extractions it supports.',
  },
)
