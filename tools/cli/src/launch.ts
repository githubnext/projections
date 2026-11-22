// The entry point of the optional `projections-tools` command (`tools link`). The launcher script on PATH runs this
// file from the linked checkout; it runs the tools of the checkout the command was run in (so each worktree uses its
// own), or else the linked checkout's, with that checkout's pinned Node when one is installed.
import {spawn} from 'node:child_process'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {canonical} from './lib/install.ts'
import {findCheckout, findNode} from './lib/link.ts'

const linked = canonical(resolve(import.meta.dirname, '../../..'))
const invokedFrom = process.cwd()
const found = findCheckout(invokedFrom)
const root = found ?? linked
const bin = join(root, 'tools/cli/src/bin.ts')
const say = (line: string) => process.stderr.write(`projections-tools: ${line}\n`)

if (!found) say(`${invokedFrom} is not in a Projections checkout; using the linked checkout ${linked}`)
const node = findNode(root)
if (!node.matched) say(`Node ${node.pinned} (${root}/.node-version) is not installed; running with Node ${node.version}`)

// As `npm run tools` does: the command runs in the workspace root, and INIT_CWD is where it was invoked.
process.env.INIT_CWD = invokedFrom
if (node.path === process.execPath) {
  process.chdir(root)
  // The launcher sets PROJECTIONS_TOOLS_BIN (read by lib/invocation.ts, so not imported here: importing it removes it).
  process.argv[1] = process.env.PROJECTIONS_TOOLS_BIN ?? bin
  await import(pathToFileURL(bin).href)
} else {
  const child = spawn(node.path, [bin, ...process.argv.slice(2)], {cwd: root, stdio: 'inherit'})
  // A terminal's Ctrl-C reaches the child too (one process group); other signals are passed on.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  for (const signal of signals) {
    process.on(signal, () => {
      if (signal !== 'SIGINT') child.kill(signal)
    })
  }
  child.on('error', error => {
    say(`could not run ${node.path}: ${error.message}`)
    process.exit(3)
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      for (const name of signals) process.removeAllListeners(name)
      process.kill(process.pid, signal)
    } else process.exit(code ?? 1)
  })
}
