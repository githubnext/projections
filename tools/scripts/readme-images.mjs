#!/usr/bin/env node
// Draws the images in docs/images/readme/ (the README's and docs/gallery.md's) with the CLI and the real renderers:
// what `projections show` or `projections compare --png` draws, one image per built-in renderer, for public
// repositories at pinned commits and for the small projects in docs/images/sources/ named below, in the light and dark themes. Run it
// after a change to a renderer these images use:
//
//   node tools/scripts/readme-images.mjs [--only NAME,...] [--cache DIR]
//
// It needs `npm run build` and Cargo (or PROJECTIONS_BIN, a built CLI), Git and the network for the first clones (kept
// in --cache, default ~/.cache/projections-readme-images), Chrome, Chromium or Edge, ffmpeg (for animations) and the .NET 8
// SDK (the hero's extractor builds its example). Images marked `trust` use extractors that run tools or repository
// code, so they extract with --trust. The images are committed; like the comparator examples, they aren't checked in
// CI, because drawing them needs a browser.
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {homedir, tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = join(root, 'docs/images/readme')

const repositories = {
  'fish-shell': 'https://github.com/fish-shell/fish-shell.git',
}

/**
 * Each image: where it comes from (a public `repository`, or an `example` in this repository whose `before` and
 * `after` folders become two commits of `app/`), the projection definition, what to draw (one `revision`, or a
 * `before` and `after`) and how. An example's `comparator` is a comparator file in this repository, `tools` are
 * directories copied beside the app (a sample extractor), and `typescript` installs this repository's TypeScript
 * in the scratch checkout for extractors that use the project's own. `image` holds the `--png` options in CSS
 * pixels, sized so the card hugs the drawing; `side` draws one revision of the comparison alone; `animated` also draws the
 * animated comparison as an animated PNG that loops back and forth as the viewer plays it.
 */
const images = [
  {
    // The hero: one OrderService split into three focused services, in a small ASP.NET Core-style app.
    name: 'di-split',
    example: 'docs/images/sources/order-service-split',
    definition: {
      extractor: 'dotnet-di',
      renderer: 'dependency-injection',
      inputs: {project: 'app/Shop.csproj', factoryType: 'Shop.Composition', factoryMethod: 'Services'},
      execution: {timeoutMs: 240000},
    },
    trust: true,
    image: {width: 980, height: 560, scale: 2},
    animated: true,
  },
  {
    name: 'database',
    example: 'docs/images/sources/billing-to-organizations',
    definition: {extractor: 'prisma-schema', renderer: 'database', inputs: {schema: 'app/schema.prisma'}},
    image: {width: 660, height: 640, scale: 2},
  },
  {
    // The same schema at the after revision alone: the system as it is.
    name: 'database-after',
    side: 'after',
    example: 'docs/images/sources/billing-to-organizations',
    definition: {extractor: 'prisma-schema', renderer: 'database', inputs: {schema: 'app/schema.prisma'}},
    image: {width: 660, height: 560, scale: 2},
  },
  {
    name: 'architecture',
    example: 'docs/images/sources/order-event-flow',
    tools: {
      'tools/message-handlers/extract.mjs': 'examples/extractors/message-handlers/extract.mjs',
      'tools/typescript-common': 'examples/extractors/typescript-common',
    },
    typescript: true,
    definition: {
      extractor: {command: ['node', 'tools/message-handlers/extract.mjs'], sources: ['tools']},
      renderer: 'architecture',
      inputs: {
        tsconfig: 'app/tsconfig.json',
        handlerApis: [{module: '@shop/bus', symbol: 'subscribe'}],
        publishApis: [{module: '@shop/bus', symbol: 'publish'}],
      },
    },
    trust: true,
    image: {width: 1100, height: 320, scale: 2, focus: 'all'},
  },
  {
    // The event flow at the after revision alone.
    name: 'architecture-after',
    side: 'after',
    example: 'docs/images/sources/order-event-flow',
    tools: {
      'tools/message-handlers/extract.mjs': 'examples/extractors/message-handlers/extract.mjs',
      'tools/typescript-common': 'examples/extractors/typescript-common',
    },
    typescript: true,
    definition: {
      extractor: {command: ['node', 'tools/message-handlers/extract.mjs'], sources: ['tools']},
      renderer: 'architecture',
      inputs: {
        tsconfig: 'app/tsconfig.json',
        handlerApis: [{module: '@shop/bus', symbol: 'subscribe'}],
        publishApis: [{module: '@shop/bus', symbol: 'publish'}],
      },
    },
    trust: true,
    image: {width: 900, height: 320, scale: 2, focus: 'all'},
  },
  {
    name: 'infrastructure',
    example: 'docs/images/sources/encrypt-database',
    definition: {extractor: 'terraform-infrastructure', renderer: 'infrastructure', inputs: {planJsonPath: 'app/plan.json'}},
    image: {width: 960, height: 980, scale: 2, focus: 'all', fit: true},
  },
  {
    name: 'dependencies',
    example: 'docs/images/sources/react-19-upgrade',
    definition: {extractor: 'workspace-dependencies', renderer: 'dependencies', inputs: {root: 'app'}},
    image: {width: 1000, height: 460, scale: 2, focus: 'all'},
  },
  {
    name: 'dag',
    example: 'docs/images/sources/deploy-pipeline-split',
    definition: {extractor: 'github-actions-jobs', renderer: 'dag', inputs: {workflowPath: 'app/ci.yml'}},
    image: {width: 560, height: 440, scale: 2},
  },
  {
    name: 'api',
    example: 'docs/images/sources/client-breaking-changes',
    typescript: true,
    comparator: 'packages/comparators/api-compatibility/api-compatibility.comparator.yaml',
    definition: {
      extractor: 'typescript-public-api',
      renderer: 'api',
      inputs: {tsconfig: 'app/tsconfig.json', entrypoints: ['app/src/index.ts']},
      presentation: {rendererOptions: {breakingOnly: true}},
    },
    trust: true,
    image: {width: 760, height: 432, scale: 2},
  },
  {
    name: 'text-diff',
    example: 'docs/images/sources/cli-help-release',
    definition: {
      extractor: 'command-output',
      renderer: 'text-diff',
      inputs: {commands: [{id: 'help', label: 'ship --help', command: ['node', 'app/cli.mjs']}]},
    },
    trust: true,
    image: {width: 640, height: 420, scale: 2},
  },
  {
    // fish shell's port from C++ to Rust, 3.7.0 to 4.0.0, in lines of code.
    name: 'code-statistics',
    repository: 'fish-shell',
    before: '0e4d088b116f8455ed604be117ea78831b2cdfc5',
    after: 'eb336889b7bcb88eb0e1f3dd678ae52275280186',
    definition: {
      extractor: 'code-statistics',
      renderer: 'code-statistics',
      inputs: {include: ['src/**', 'tests/**', 'cmake/**', 'CMakeLists.txt', 'Cargo.toml', 'build.rs']},
    },
    image: {width: 700, height: 390, scale: 2},
  },
  {
    // Every file in fish shell 4.0.0, at one revision.
    name: 'file-packing',
    repository: 'fish-shell',
    revision: 'eb336889b7bcb88eb0e1f3dd678ae52275280186',
    definition: {extractor: 'repository-map', renderer: 'file-packing'},
    image: {width: 560, height: 420, scale: 2},
  },
  {
    // A credentials policy that kills curl and wget reading the service account token, and widens to checkout.
    name: 'runtime-policy',
    example: 'docs/images/sources/credentials-policy',
    comparator: 'packages/comparators/runtime-policy/runtime-policy.comparator.yaml',
    definition: {extractor: 'tetragon-policies', renderer: 'runtime-policy', inputs: {paths: ['app/*.yaml']}},
    trust: true,
    image: {width: 820, height: 812, scale: 2},
  },
]

const {values: options} = parseArgs({options: {only: {type: 'string'}, cache: {type: 'string'}}})
const only = options.only?.split(',')
const cache = options.cache ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'projections-readme-images')

function run(command, args, settings = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...settings})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}:\n${result.stderr.trim()}`)
  return result.stdout
}

let binary = process.env.PROJECTIONS_BIN
if (!binary) {
  run('cargo', ['build', '--quiet', '--locked', '--release', '-p', 'projections-cli'], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']})
  binary = join(root, 'target', 'release', process.platform === 'win32' ? 'projections.exe' : 'projections')
}

/** A full clone (extractors read Git objects, which a partial clone would fetch on demand) holding the commit. */
async function clone(name, commits) {
  const directory = join(cache, name)
  if (!existsSync(directory)) {
    await mkdir(cache, {recursive: true})
    run('git', ['clone', '--quiet', repositories[name], directory])
  }
  for (const commit of commits) {
    const sha = commit.replace(/\^$/, '')
    if (spawnSync('git', ['-C', directory, 'cat-file', '-e', `${sha}^{commit}`]).status !== 0)
      run('git', ['-C', directory, 'fetch', '--quiet', 'origin', sha])
  }
  return directory
}

/** A scratch repository whose two commits are the example's `before` and `after` folders, as `app/`. */
async function commitExample(item, directory) {
  const git = (...args) =>
    run('git', ['-c', 'user.name=Projections', '-c', 'user.email=projections@example.com', ...args], {cwd: directory})
  await mkdir(join(directory, 'app'), {recursive: true})
  git('init', '--quiet')
  // Restores go through the same package feed as this repository's; installed packages stay out of the history.
  await cp(join(root, 'nuget.config'), join(directory, 'nuget.config'))
  await writeFile(join(directory, '.gitignore'), 'node_modules\n')
  for (const side of ['before', 'after']) {
    await rm(join(directory, 'app'), {recursive: true, force: true})
    await cp(join(root, item.example, side), join(directory, 'app'), {recursive: true})
    git('add', '--all')
    git('commit', '--quiet', '--message', side)
  }
  // Untracked, so both revisions use them: extractors resolve the project's own TypeScript from the checkout.
  if (item.typescript) await cp(join(root, 'node_modules/typescript'), join(directory, 'node_modules/typescript'), {recursive: true})
  for (const [to, from] of Object.entries(item.tools ?? {})) await cp(join(root, from), join(directory, to), {recursive: true})
  if (item.comparator) await cp(join(root, item.comparator), join(directory, `${item.name}.comparator.yaml`))
  return directory
}

/** The `show` options that draw a saved document in one theme at the image's size. */
function imageOptions(document, theme, image) {
  const args = ['show', '--from', document, '--theme', theme]
  args.push('--width', `${image.width}`, '--height', `${image.height}`, '--scale', `${image.scale}`)
  if (image.focus) args.push('--focus', image.focus)
  if (image.fit) args.push('--fit')
  return args
}

/** Writes the PNG at `file` from a saved document, in one theme. */
function draw(document, file, theme, image, extra = []) {
  run(binary, [...imageOptions(document, theme, image), '--png', file, ...extra])
}

/** An animation's frame rate: 12.5 frames a second, whole centiseconds a frame like the holds. */
const fps = 12.5

function ffmpeg(...args) {
  run('ffmpeg', ['-loglevel', 'error', '-y', ...args])
}

/**
 * An animated PNG of the comparison as the viewer plays it at 1× speed, looping back and forth: `--frames` records it
 * from the host's own playback timeline (the renderer's steps in each direction, its pace and the holds), each hold one
 * frame with its duration. APNG rather than GIF: it keeps full colour and alpha, so the card's rounded corners stay
 * transparent on every GitHub theme (GIF can only matte them onto one theme's background).
 */
async function animate(document, file, theme, item, scratch) {
  const frames = join(scratch, `${item.name}-${theme}-frames`)
  run(binary, [...imageOptions(document, theme, item.image), '--frames', frames, '--fps', `${fps}`])
  const recorded = JSON.parse(await readFile(join(frames, 'frames.json'), 'utf8')).frames
  const list = recorded.flatMap(frame => [`file '${join(frames, frame.file)}'`, `duration ${frame.durationMs / 1000}`])
  // The concat demuxer ignores the last entry's duration unless the file is listed again.
  list.push(`file '${join(frames, recorded.at(-1).file)}'`)
  await writeFile(join(frames, 'list.txt'), `${list.join('\n')}\n`)
  const width = Math.round(item.image.width * item.image.scale)
  ffmpeg(
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    join(frames, 'list.txt'),
    '-vf',
    `scale=${width}:-1:flags=lanczos,format=rgba`,
    // Each frame keeps its own duration, so the holds stay single frames.
    '-fps_mode',
    'vfr',
    '-plays',
    '0',
    '-f',
    'apng',
    file,
  )
}

const scratch = await mkdtemp(join(tmpdir(), 'projections-readme-images-'))
try {
  await mkdir(out, {recursive: true})
  for (const item of images) {
    if (only && !only.includes(item.name)) continue
    const directory = item.example
      ? await commitExample(item, join(scratch, item.name))
      : await clone(item.repository, item.revision ? [item.revision] : [item.before, item.after])
    const before = item.example ? 'HEAD~1' : item.before
    const after = item.example ? 'HEAD' : item.after
    // The definition lives in the clone's working tree, untracked, and applies to every revision drawn.
    await mkdir(join(directory, '.projections'), {recursive: true})
    const definition = {id: item.name, title: item.name, ...item.definition}
    if (item.comparator) definition.comparator = `${item.name}.comparator.yaml`
    await writeFile(join(directory, '.projections', `${item.name}.json`), `${JSON.stringify(definition, null, 2)}\n`)
    const document = join(scratch, `${item.name}.json`)
    const common = [
      '-C',
      directory,
      '-p',
      item.name,
      '--definition-revision',
      'working-tree',
      '--output',
      document,
      ...(item.trust ? ['--trust'] : []),
    ]
    if (item.revision) run(binary, ['show', item.revision, ...common])
    else run(binary, ['compare', `${before}..${after}`, ...common])
    for (const theme of ['light', 'dark']) {
      const file = join(out, `${item.name}-${theme}.png`)
      await rm(file, {force: true})
      draw(document, file, theme, item.image, item.side ? ['--side', item.side] : [])
      console.log(`Wrote docs/images/readme/${item.name}-${theme}.png`)
      if (item.animated) {
        // `.png`, which GitHub serves as an image and browsers play as APNG.
        const animation = join(out, `${item.name}-animated-${theme}.png`)
        await animate(document, animation, theme, item, scratch)
        console.log(`Wrote docs/images/readme/${item.name}-animated-${theme}.png`)
      }
    }
  }
} finally {
  await rm(scratch, {recursive: true, force: true})
}
