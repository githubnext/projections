#!/usr/bin/env node
import cli, {exitCodes} from './cli.ts'

const argv = process.argv.slice(2)
// incur 0.7.1 still runs its self-update for `--update` with `update: false` (a global package install). This CLI is
// part of the repository, so it updates with the repository instead.
if (argv.includes('--update')) {
  process.stderr.write('tools is part of this repository: update it with git (git pull) and npm ci.\n')
  process.exit(exitCodes.usage)
}
// incur exits 1 for its own errors (an unknown command, invalid input); this CLI reserves 1 for "ran and found
// failures", so those become 2 (usage). Commands' own errors carry their exit codes.
await cli.serve(argv, {exit: code => process.exit(code === 1 ? exitCodes.usage : code)})
