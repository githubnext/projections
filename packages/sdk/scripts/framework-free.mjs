// The framework-free half of check-pack.mjs: a renderer without React installs the tarball with Vite alone (React and
// react-dom are optional peers, so npm installs neither), type-checks against the package's own declarations, and
// builds on the framework-free kit (`/kit`, `/kit/base.css`) and the renderer client (`/renderer`) with
// `rendererConfig` (`/vite`). Its bundle holds the kit's base styles and no React, and its notices attribute none.
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const main = name => `import '${name}/kit/base.css'
import {createModel, describeChange, isChanged, statusLabels} from '${name}/kit'
import {applyEnvironment, connectRenderer} from '${name}/renderer'
import type {InitPayload} from '${name}/renderer'

// The kit's styles are scoped to a \`.pk\` root, which a renderer without React makes itself.
const root = document.createElement('main')
root.className = 'pk'
document.body.append(root)

function draw(init: InitPayload): void {
  const model = createModel(init)
  const items = model.entities.map(row => {
    const item = document.createElement('li')
    item.dataset.entityId = row.id
    item.textContent = \`\${(row.after ?? row.before)!.label} (\${isChanged(row) ? describeChange(row) : statusLabels.unchanged})\`
    return item
  })
  const list = document.createElement('ul')
  list.append(...items)
  root.replaceChildren(list)
}

const client = connectRenderer(
  {
    init(payload) {
      applyEnvironment(payload)
      draw(payload)
      client.rendered(1)
    },
    environment: applyEnvironment,
  },
  {capabilities: {changeHighlighting: 'none'}},
)
`

/**
 * Checks the framework-free consumer in `scratch/framework-free`. `npm(args, cwd)` runs npm, `version(name)` is the
 * workspace's installed version of a package, and `fail(text)` records a problem.
 */
export function checkFrameworkFree({scratch, tarball, name, npm, version, fail}) {
  const consumer = join(scratch, 'framework-free')
  mkdirSync(join(consumer, 'src'), {recursive: true})
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({name: 'framework-free', private: true, type: 'module'}, null, 2))
  npm(
    ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball, `vite@${version('vite')}`, `typescript@${version('typescript')}`],
    consumer,
  )
  for (const peer of ['react', 'react-dom', '@types/react']) {
    if (existsSync(join(consumer, 'node_modules', peer))) fail(`Installing the tarball with Vite alone installed ${peer}`)
  }
  writeFileSync(join(consumer, 'src/main.ts'), main(name))
  writeFileSync(
    join(consumer, 'vite.config.js'),
    `import {defineConfig} from 'vite'
import {rendererConfig} from '${name}/vite'

export default defineConfig(rendererConfig({entry: 'src/main.ts', name: 'plain', title: 'Plain', handles: []}))
`,
  )
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: [],
        strict: true,
        noEmit: true,
        // The kit's and SDK's declarations are checked too: one that names React wouldn't resolve.
        skipLibCheck: false,
      },
      files: ['src/main.ts'],
    }),
  )
  try {
    execFileSync(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', consumer], {encoding: 'utf8'})
    console.log('  types: ok, without React')
  } catch (error) {
    // Only the package's declarations (one naming React wouldn't resolve) and the renderer's own are this check's
    // business; a third-party dependency's declarations are not.
    const output = String(error.stdout || error.message)
    const ours = output.split('\n').filter(line => line.includes(`node_modules/${name}/`) || line.startsWith('src/'))
    if (ours.length) fail(`A renderer without React doesn't type-check:\n${output}`)
    else console.log('  types: ok, without React (third-party declarations reported errors outside this package)')
  }
  try {
    execFileSync(process.execPath, [join(consumer, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    fail(`A renderer without React doesn't build:\n${error.stderr || error.stdout || error.message}`)
    return
  }
  const page = readFileSync(join(consumer, 'dist/index.html'), 'utf8')
  const notices = readFileSync(join(consumer, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8')
  for (const framework of ['react', 'react-dom', 'scheduler']) {
    if (notices.includes(`===== ${framework} `)) fail(`A renderer without React attributes ${framework} in its notices`)
  }
  if (/react\.(production|development)|__SECRET_INTERNALS|ReactCurrentDispatcher|react-dom/.test(page)) {
    fail('A renderer without React bundles React')
  }
  if (!/\.pk\s*\{[^}]*--surface:/.test(page)) fail("A renderer without React doesn't bundle the kit's base styles")
  console.log(`  built dist/index.html (${(page.length / 1024).toFixed(1)} kB) with the kit's base styles and no React`)
}
