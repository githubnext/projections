// What every command shares: exit codes, turning errors into incur errors, progress on stderr, the `next` field.
import {Errors, z} from 'incur'
import {PrerequisiteError} from './commands/install.ts'
import {UsageError} from './commands/work/change-set.ts'

/** Exit codes: 0 success, 1 the command ran and found failures, 2 it couldn't run as asked (usage), 3 a prerequisite is missing. */
export const exitCodes = {ok: 0, failures: 1, usage: 2, prerequisite: 3} as const

/** Sets exit code 1 when a report found failures; the report itself is still printed. */
export function settle<T extends {status: string}>(report: T): T {
  if (report.status === 'fail') process.exitCode = exitCodes.failures
  return report
}

export async function guard<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof UsageError)
      throw new Errors.IncurError({
        code: 'USAGE',
        message: error.message,
        ...(error.hint ? {hint: error.hint} : {}),
        exitCode: exitCodes.usage,
      })
    if (error instanceof PrerequisiteError)
      throw new Errors.IncurError({
        code: 'PREREQUISITE',
        message: error.message,
        ...(error.hint ? {hint: error.hint} : {}),
        exitCode: exitCodes.prerequisite,
      })
    throw error
  }
}

export const progress = (agent: boolean) => (agent ? undefined : (line: string) => process.stderr.write(`${line}\n`))

export const next = z.array(z.string()).describe('Commands to run next')
