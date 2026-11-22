import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

/** `execFile` resolving to its `{stdout, stderr}`: Node's own promise form of it (`util.promisify.custom`). */
// eslint-disable-next-line @typescript-eslint/strict-void-return -- promisify uses execFile's callback; it never reads the ChildProcess execFile returns
export const execFileOutput = promisify(execFile)
