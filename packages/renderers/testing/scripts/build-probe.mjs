// Bundles the check probe into one self-contained classic script, dist/probe.js,
// which the Inspector injects into renderer documents in fixtures mode.
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {build} from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
await build({
  root,
  logLevel: 'warn',
  configFile: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: true,
    lib: {entry: 'src/probe.ts', formats: ['iife'], name: 'projectionsProbe', fileName: () => 'probe.js'},
  },
})
const probe = await readFile(new URL('../dist/probe.js', import.meta.url), 'utf8')
if (/<\/script/iu.test(probe)) throw new Error('The probe must not contain </script')
