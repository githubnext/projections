// Checks `@githubnext/projections` as it would be published: `npm pack`s it (or takes the tarball --tarball names, such
// as the one a release attaches), then
//
// 1. the tarball holds only the built entries, their declarations and styles, the vendored data with its license,
//    and the manifest, license and readme: no sources, tests, source maps or build configuration, and no file
//    names an internal `@githubnext/projections-*` workspace or a path on the machine that built it;
// 2. (unless --contents) installed into a scratch project with its peers, every export resolves at runtime in Node
//    (the CSS too), and every entry's types resolve and check under `moduleResolution` `bundler` and `node16`;
//    and installed with Vite alone, a renderer without React type-checks and builds on the framework-free kit with no
//    React in its bundle (framework-free.mjs);
// 3. (unless --contents or --no-scaffold) a renderer scaffolded by `projections init --renderer custom` installs the
//    tarball, builds, and passes its renderer checks (`npm test`), with the CLI from PROJECTIONS_CLI or this
//    checkout's build (packages/cli/dist/projections). With --tarball, the CLI is the release's, and a renderer it scaffolds
//    without PROJECTIONS_RENDERER_PACKAGES must depend on the tarball's release URL.
//
//   node scripts/check-pack.mjs [--contents] [--no-scaffold] [--keep] [--tarball FILE]
//
// Run `npm run build` first. Scratch projects live in the system temporary directory, outside this workspace, so
// nothing resolves from its node_modules.
import {execFileSync} from 'node:child_process'
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {checkFrameworkFree} from './framework-free.mjs'
import {packPublished} from './manifest.mjs'
import {pinToWorkspace} from './pin-to-workspace.mjs'

const options = new Set()
let given
const cliArgs = process.argv.slice(2)
while (cliArgs.length) {
  const option = cliArgs.shift()
  if (option === '--tarball') {
    if (!cliArgs.length) throw new Error('--tarball needs a file')
    given = resolve(cliArgs.shift())
  } else if (['--contents', '--no-scaffold', '--keep'].includes(option)) options.add(option)
  else throw new Error(`Unknown option ${option}`)
}
const root = fileURLToPath(new URL('../', import.meta.url))
const workspace = resolve(root, '../..')
// Windows' own tar (bsdtar): Git Bash's GNU tar, first on PATH there, reads a drive letter as a remote host.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const npmCli = process.env.npm_execpath
// Scratch installs use the registry this workspace uses, wherever they are.
const registry = /^registry=(.+)$/mu.exec(readFileSync(join(workspace, '.npmrc'), 'utf8'))?.[1]
// npm retries a request that fails on the network or with a 5xx, never a missing version; a few more times here.
const env = {
  ...process.env,
  ...(registry && !process.env.npm_config_registry ? {npm_config_registry: registry} : {}),
  npm_config_fetch_retries: process.env.npm_config_fetch_retries ?? '5',
}
const npm = (args, cwd, extra = {}) =>
  execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {
    cwd,
    env: {...env, ...extra},
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
const step = text => console.log(`\n▸ ${text}`)
const failures = []
const fail = text => failures.push(text)

const scratch = mkdtempSync(join(tmpdir(), 'projections-package-'))
try {
  let tarball, files
  if (given) {
    step(`The tarball ${given}`)
    tarball = join(scratch, basename(given))
    copyFileSync(given, tarball)
    const listed = execFileSync(tar, ['-tzf', tarball], {encoding: 'utf8'}).split(/\r?\n/u).filter(Boolean)
    files = listed
      .filter(file => !file.endsWith('/'))
      .map(file => file.replace(/^package\//u, ''))
      .toSorted()
    console.log(`${basename(tarball)}: ${files.length} files, ${(statSync(tarball).size / 1024).toFixed(1)} kB packed`)
  } else {
    step('npm pack')
    if (!existsSync(join(root, 'dist/renderer.js'))) throw new Error('Run npm run build in packages/sdk/ first')
    // Packed as published (see manifest.mjs), then the manifest and README are put back.
    const packed = packPublished(scratch, npm)
    tarball = join(scratch, packed.filename)
    files = packed.files.map(file => file.path).toSorted()
    console.log(
      `${packed.filename}: ${files.length} files, ${(packed.size / 1024).toFixed(1)} kB packed, ${(packed.unpackedSize / 1024).toFixed(1)} kB unpacked`,
    )
  }
  for (const file of files) console.log(`  ${file}`)

  step('Contents')
  const allowed = [
    /^package\.json$/u,
    /^LICENSE$/u,
    /^README\.md$/u,
    // Shared chunks are named after their modules, generated ones included.
    /^dist\/[a-z-]+(\.generated)?\.(js|d\.ts)$/u,
    /^dist\/engine\/(browser|node)\.js$/u,
    /^dist\/(renderer\/icons|kit\/base|kit\/react)\.css$/u,
    /^vendor\/linguist\/(languages\.js|languages\.d\.ts|LICENSE|vendor\.json)$/u,
  ]
  for (const file of files) if (!allowed.some(pattern => pattern.test(file))) fail(`The tarball has a file it shouldn't: ${file}`)
  for (const required of ['README.md', 'LICENSE', 'vendor/linguist/LICENSE', 'vendor/linguist/vendor.json']) {
    if (!files.includes(required)) fail(`The tarball has no ${required}`)
  }
  // Every file `exports` and `imports` name is in the tarball.
  const targets = [
    ...Object.values(manifest.exports).flatMap(target => (typeof target === 'string' ? [target] : Object.values(target))),
    ...Object.values(manifest.imports).flatMap(target => Object.values(target)),
  ]
  for (const target of targets) if (!files.includes(target.replace(/^\.\//u, ''))) fail(`${target} is exported but not in the tarball`)
  const unpacked = join(scratch, 'unpacked')
  mkdirSync(unpacked)
  execFileSync(tar, ['-xzf', tarball, '-C', unpacked])
  const internal = /@githubnext\/projections-[a-z]/u
  const machine = [workspace, resolve(workspace, '..'), process.env.HOME].filter(path => path && path.length > 1)
  for (const file of files) {
    const text = readFileSync(join(unpacked, 'package', file), 'utf8')
    const name = internal.exec(text)
    if (name) {
      fail(`${file} names an internal workspace: ${text.slice(Math.max(0, name.index - 60), name.index + 60).replaceAll(/\s+/gu, ' ')}`)
    }
    for (const path of machine) if (text.includes(path)) fail(`${file} includes a path on this machine (${path})`)
    if (/sourceMappingURL=/u.test(text)) fail(`${file} references a source map`)
  }
  // Installing the package runs nothing.
  const scripts = JSON.parse(readFileSync(join(unpacked, 'package/package.json'), 'utf8')).scripts ?? {}
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) if (scripts[hook]) fail(`package.json has a ${hook} script`)
  const packedManifest = JSON.parse(readFileSync(join(unpacked, 'package/package.json'), 'utf8'))
  if (packedManifest.devDependencies) fail('The published package.json has devDependencies')
  // A release attaches the tarball under npm pack's name, at the checkout's version.
  const filename = `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`
  if (packedManifest.version !== manifest.version) {
    fail(`The tarball is ${packedManifest.version}, the checkout's package ${manifest.version}`)
  }
  if (given && basename(tarball) !== filename) fail(`The tarball is named ${basename(tarball)}, not ${filename}`)

  if (!options.has('--contents')) {
    step('Install the tarball with its peers')
    const consumer = join(scratch, 'consumer')
    mkdirSync(consumer)
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({name: 'consumer', private: true, type: 'module'}, null, 2))
    const version = name => JSON.parse(readFileSync(join(workspace, 'node_modules', name, 'package.json'), 'utf8')).version
    npm(
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--ignore-scripts',
        tarball,
        ...['react', 'react-dom', 'vite', '@playwright/test', '@types/react', '@types/react-dom', '@types/node', 'typescript'].map(
          name => `${name}@${version(name)}`,
        ),
      ],
      consumer,
    )

    step('Every export resolves and loads in Node')
    const entries = Object.keys(manifest.exports).map(key => `${manifest.name}${key.slice(1)}`)
    writeFileSync(
      join(consumer, 'load.mjs'),
      `for (const entry of ${JSON.stringify(entries)}) {
  const url = import.meta.resolve(entry)
  if (!entry.endsWith('.css') && !entry.endsWith('.json')) {
    const module = await import(entry)
    if (!Object.keys(module).length) throw new Error(entry + ' exports nothing')
  }
  console.log('  ' + entry + ' → ' + url.slice(url.indexOf('node_modules/')))
}
`,
    )
    try {
      process.stdout.write(execFileSync(process.execPath, ['load.mjs'], {cwd: consumer, encoding: 'utf8'}))
    } catch (error) {
      fail(`An export doesn't load in Node: ${error.stderr || error.message}`)
    }

    step('Types resolve under moduleResolution bundler and node16')
    const typed = Object.entries(manifest.exports).filter(([, target]) => typeof target === 'object' && target.types)
    const imports = typed.map(([key], index) => `import * as entry${index} from '${manifest.name}${key.slice(1)}'`)
    const uses = typed.map((_, index) => `entry${index}`)
    const source = `${imports.join('\n')}
import type {Extraction} from '${manifest.name}/schemas'
import type {RendererProps} from '${manifest.name}/kit/react'
import type {RendererBuildOptions} from '${manifest.name}/vite'
export const entries = [${uses.join(', ')}]
export const extraction: Extraction | undefined = undefined
export type Props = RendererProps
export const build: RendererBuildOptions = {entry: 'src/main.ts', name: 'x', title: 'X'}
`
    for (const [name, compilerOptions] of [
      ['bundler', {module: 'ESNext', moduleResolution: 'bundler'}],
      ['node16', {module: 'Node16', moduleResolution: 'Node16'}],
    ]) {
      const directory = join(consumer, name)
      mkdirSync(directory)
      writeFileSync(join(directory, 'index.ts'), source)
      writeFileSync(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            ...compilerOptions,
            target: 'ES2022',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            types: ['node'],
            strict: true,
            noEmit: true,
            // The package's own declarations are checked, not only resolved.
            skipLibCheck: false,
            jsx: 'react-jsx',
          },
          files: ['index.ts'],
        }),
      )
      try {
        execFileSync(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', directory], {encoding: 'utf8'})
        console.log(`  ${name}: ok`)
      } catch (error) {
        const output = String(error.stdout || error.message)
        // Only the package's declarations are this check's business; a peer's own declarations are not.
        const ours = output
          .split('\n')
          .filter(line => line.includes(`node_modules/${manifest.name}/`) || line.startsWith(`${name}/`) || line.startsWith('index.ts'))
        if (ours.length) fail(`Types don't check under ${name}:\n${output}`)
        else console.log(`  ${name}: ok (peers' declarations reported errors outside this package)`)
      }
    }

    step('A renderer without React installs the tarball with Vite alone and builds on the framework-free kit')
    checkFrameworkFree({scratch, tarball, name: manifest.name, npm, version, fail})

    if (!options.has('--no-scaffold')) {
      step('A scaffolded custom renderer installs the tarball, builds and passes its checks')
      const cli = process.env.PROJECTIONS_CLI ?? join(workspace, 'packages/cli/dist/projections')
      if (!existsSync(cli)) throw new Error(`No CLI at ${cli}: build it (npm run build --workspace packages/cli) or set PROJECTIONS_CLI`)
      if (given) {
        // The release's CLI, installed outside any checkout, scaffolds a renderer on its own release's tarball.
        const released = join(scratch, 'released')
        mkdirSync(released)
        execFileSync('git', ['init', '-q'], {cwd: released})
        const {PROJECTIONS_RENDERER_PACKAGES: _, ...unset} = env
        execFileSync(cli, ['init', 'service-map', '--language', 'node', '--renderer', 'custom'], {
          cwd: released,
          env: unset,
          stdio: ['ignore', 'pipe', 'inherit'],
        })
        const dependency = JSON.parse(readFileSync(join(released, '.github/projections/service-map/renderer/package.json'), 'utf8'))
          .dependencies[manifest.name]
        const url = `https://github.com/githubnext/projections/releases/download/v${manifest.version}/${filename}`
        if (dependency !== url) fail(`The release's CLI scaffolds a renderer on ${dependency}, not ${url}`)
        else console.log(`  the release's CLI depends on ${url}`)
      }
      const repository = join(scratch, 'repository')
      mkdirSync(repository)
      execFileSync('git', ['init', '-q'], {cwd: repository})
      execFileSync(cli, ['init', 'service-map', '--language', 'node', '--renderer', 'custom'], {
        cwd: repository,
        env: {...env, PROJECTIONS_RENDERER_PACKAGES: scratch},
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      const renderer = join(repository, '.github/projections/service-map/renderer')
      const scaffolded = JSON.parse(readFileSync(join(renderer, 'package.json'), 'utf8'))
      const dependencies = Object.keys({...scaffolded.dependencies, ...scaffolded.devDependencies})
      for (const name of dependencies) if (internal.test(name)) fail(`The scaffold depends on an internal workspace: ${name}`)
      if (!dependencies.includes(manifest.name)) fail(`The scaffold doesn't depend on ${manifest.name}`)
      const sources = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {cwd: repository, encoding: 'utf8'})
      for (const file of sources.split('\n').filter(Boolean)) {
        if (internal.test(readFileSync(join(repository, file), 'utf8'))) fail(`The scaffold's ${file} names an internal workspace`)
      }
      pinToWorkspace(join(renderer, 'package.json'), workspace)
      npm(['install', '--no-audit', '--no-fund'], renderer)
      // The browser the scaffold's Playwright drives; a no-op once installed.
      execFileSync(process.execPath, [join(renderer, 'node_modules/@playwright/test/cli.js'), 'install', 'chromium'], {
        cwd: renderer,
        stdio: 'inherit',
        env,
      })
      try {
        const test = ['test', '--', '--workers', '2', '--reporter', 'line']
        execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...test] : test, {
          cwd: renderer,
          env: {...env, PROJECTIONS_CLI: resolve(cli), CI: '1'},
          stdio: 'inherit',
        })
        const bundle = join(renderer, 'dist/index.html')
        if (!existsSync(bundle) || !statSync(bundle).size) fail('The scaffold built no dist/index.html')
        const notices = readFileSync(join(renderer, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8')
        console.log(`  built dist/: ${readdirSync(join(renderer, 'dist')).join(', ')}`)
        for (const name of ['react', 'react-dom']) {
          if (!notices.includes(`===== ${name} `)) fail(`The scaffold's notices don't attribute ${name}`)
        }
      } catch (error) {
        fail(`The scaffolded renderer failed to build or pass its checks (${error.message.split('\n')[0]})`)
      }
      console.log(`  scaffold: ${relative(scratch, renderer)}`)
    }
  }
} finally {
  if (options.has('--keep')) console.log(`\nKept ${scratch}`)
  else rmSync(scratch, {recursive: true, force: true})
}
if (failures.length) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`\n${manifest.name}@${manifest.version} is ready to publish.`)
