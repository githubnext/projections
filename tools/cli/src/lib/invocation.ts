// How this CLI was invoked: `npm run tools --` in the checkout (the default), or the optional `projections-tools`
// command that `tools link` puts on PATH. The name is used for --help, --llms, skills, the MCP server and `next` hints.
import {isAbsolute} from 'node:path'

/** The absolute path of the `projections-tools` command, which its launcher (src/launch.ts) sets. */
export const BIN_VARIABLE = 'PROJECTIONS_TOOLS_BIN'

const bin = process.env[BIN_VARIABLE]
// Read once and removed, so commands this CLI runs (npm scripts that run `node tools/cli/src/bin.ts`) are plain `tools`.
delete process.env[BIN_VARIABLE]

/** The `projections-tools` command that ran this CLI, when it did. */
export const linkedBin = bin && isAbsolute(bin) ? bin : undefined
export const cliName = linkedBin ? 'projections-tools' : 'tools'
/** How `tools` is invoked, for `next` hints. */
export const TOOLS = linkedBin ? 'projections-tools' : 'npm run tools --'
