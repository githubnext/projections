// The renderer SDK, kit and frame message references, from their TypeScript APIs.
import {apiPage, typescriptOnce} from './api.mjs'
import {code, outDir, to} from './shared.mjs'

export async function rendererSdk() {
  const {sdk, kit, docs} = await typescriptOnce()
  const publicName = '@githubnext/projections'
  const isExport = entity => entity.kind !== 'member'
  const skip = entity => !isExport(entity)
  // The package root re-exports several modules; each export is listed once, under the module that defines it.
  const roots = sdk.entities.filter(entity => isExport(entity) && entity.data?.subpath !== '.')
  const named = new Set(roots.map(entity => entity.label))
  // Authors import the SDK from `@githubnext/projections`: `/vite` and `/renderer/react` are entries of their own,
  // `/renderer` everything else.
  // Sections follow the SDK's modules, each named with the entry that exports it.
  const moduleName = subpath => {
    if (subpath === './vite') return `Vite build (${code(`${publicName}/vite`)})`
    if (subpath === './react') return `React (${code(`${publicName}/renderer/react`)})`
    const module = subpath === '.' ? 'Renderer' : subpath.slice(2).replace(/^./, letter => letter.toUpperCase())
    return `${module} (${code(`${publicName}/renderer`)})`
  }
  const subpath = entity => {
    if (entity.data?.subpath === '.' && named.has(entity.label)) return undefined
    return moduleName(entity.data?.subpath ?? '.')
  }
  return {
    [`${outDir}/renderer-sdk.md`]: apiPage({
      title: 'Renderer SDK API',
      intro: `The public API of the renderer SDK: \`${publicName}/renderer\` (the frame protocol client, presentation
helpers, interactions, rings and languages), \`${publicName}/renderer/react\` (the React hooks) and
\`${publicName}/vite\` (the build), by the SDK module that defines each export. Read with the \`typescript-public-api\` extractor, the same one that shows your own packages'
APIs; descriptions are the sources' documentation comments. Start with [the renderer SDK guide](${to('packages/renderers/sdk/README.md')}).`,
      sources: ['packages/renderers/sdk/src', 'via typescript-public-api'],
      extraction: sdk,
      docs,
      language: 'ts',
      group: subpath,
      skip,
    }),
    [`${outDir}/renderer-kit.md`]: apiPage({
      title: 'Renderer kit API',
      intro: `The public API of the renderer kit the built-in renderers use, by entry: \`@githubnext/projections/kit\`,
framework-free (the comparison model, step timeline, staged motion, graph layout, diff mode, status and colors), and
\`@githubnext/projections/kit/react\` (the shell, graph canvas, components and hooks). Read with the
\`typescript-public-api\` extractor; descriptions are the sources' documentation comments. Start with
[the kit's guide](${to('docs/guides/renderer-kit.md')}).`,
      sources: ['packages/renderers/kit/src', 'via typescript-public-api'],
      extraction: kit,
      docs,
      language: 'ts',
      group: entity => {
        if (!isExport(entity)) return undefined
        return entity.data?.subpath === './react'
          ? `React (${code(`${publicName}/kit/react`)})`
          : `Framework-free (${code(`${publicName}/kit`)})`
      },
      skip,
    }),
    [`${outDir}/renderer-messages.md`]: apiPage({
      title: 'Renderer messages',
      intro: `The messages between a host and a renderer's sandboxed frame, as the renderer SDK's
protocol module (exported by \`@githubnext/projections/renderer\`) defines and validates them. The
[renderer frame protocol](${to('docs/contracts/renderer-frames.md')}) explains the exchange; most renderers use the
SDK's client instead of these messages directly.`,
      sources: ['packages/renderers/sdk/src/protocol.ts', 'via typescript-public-api'],
      extraction: sdk,
      docs,
      language: 'ts',
      group: entity => (entity.data?.subpath === './protocol' ? moduleName('./protocol') : undefined),
      skip,
    }),
  }
}
