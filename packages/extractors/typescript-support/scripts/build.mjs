// Bundles the Node extractor helper into one self-contained file. At run time it
// needs only Node.js built-ins plus the examined repository's own `typescript`
// installation; it never resolves packages next to itself.
import {build} from 'esbuild'
import {rm} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const compiler = path.join(root, 'src/compiler.ts')
const outfile = path.join(root, 'dist/extractor.mjs')
await rm(path.join(root, 'dist'), {recursive: true, force: true})
const result = await build({
  entryPoints: [path.join(root, 'src/worker.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // The helper runs on the examined project's Node.js, not on Projections' own.
  target: 'node20',
  metafile: true,
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: "// Projections Node extractor helper. Copyright GitHub, Inc. MIT License.\n// Requires Node.js 20+ and the examined repository's own `typescript` (5.x/6.x) package.",
  },
  plugins: [
    {
      name: 'repository-typescript',
      setup(context) {
        // Every compiler call goes through the repository's installation, loaded at run time.
        context.onResolve({filter: /^typescript$/}, () => ({path: compiler}))
      },
    },
  ],
})
const inputs = Object.keys(result.metafile.inputs)
// Metafile paths are relative to the working directory esbuild ran in.
const foreign = inputs.filter(input => !path.resolve(input).startsWith(path.join(root, 'src') + path.sep))
if (foreign.length) throw new Error(`The extractor helper must bundle only its own sources, not ${foreign.join(', ')}`)
const output = result.metafile.outputs[path.relative(process.cwd(), outfile)] ?? Object.values(result.metafile.outputs)[0]
const external = output.imports.filter(item => item.external && !item.path.startsWith('node:'))
if (external.length)
  throw new Error(`The extractor helper may import only Node.js built-ins, not ${external.map(item => item.path).join(', ')}`)
