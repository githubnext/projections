// `tools verify`: Verus proves the Engine's verified crate (packages/engine/VERIFICATION.md), then the mutation check plants
// one bug per specification clause. packages/engine/verified/scripts/verify.mjs does the work, so CI runs exactly what this runs
// without installing the workspace.
import {spawn} from 'node:child_process'
import {join} from 'node:path'
import {PrerequisiteError} from './install.ts'

export type VerifyReport = {
  status: 'pass' | 'fail'
  verified: number
  seconds: number
  mutants: {caught: number; total: number; seconds: number} | undefined
  problems: {message: string}[]
  next: string[]
}

type ScriptReport = {
  status: 'pass' | 'fail' | 'prerequisite'
  proof?: {verified: number; seconds: number; output: string}
  mutation?: {caught: number; total: number; seconds: number}
  problems?: string[]
  hint?: string
}

export const VERIFY_SCRIPT = 'packages/engine/verified/scripts/verify.mjs'

export async function verifyReport(
  root: string,
  options: {install: boolean; mutants: boolean},
  progress?: (line: string) => void,
): Promise<VerifyReport> {
  const argv = [
    join(root, VERIFY_SCRIPT),
    '--json',
    ...(options.install ? ['--install'] : []),
    ...(options.mutants ? [] : ['--no-mutants']),
  ]
  const child = spawn(process.execPath, argv, {cwd: root, stdio: ['ignore', 'pipe', 'pipe']})
  let stdout = ''
  child.stdout.on('data', chunk => (stdout += chunk))
  child.stderr.on('data', chunk => {
    for (const line of String(chunk).split('\n').filter(Boolean)) progress?.(line)
  })
  await new Promise(resolve => child.on('close', resolve))
  const report = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as ScriptReport
  if (report.status === 'prerequisite') throw new PrerequisiteError(report.problems?.[0] ?? 'Verus is unavailable', report.hint)
  const problems = (report.problems ?? []).map(message => ({message}))
  if (report.proof?.output) problems.push({message: report.proof.output})
  return {
    status: report.status === 'pass' ? 'pass' : 'fail',
    verified: report.proof?.verified ?? 0,
    seconds: report.proof?.seconds ?? 0,
    mutants: report.mutation && {caught: report.mutation.caught, total: report.mutation.total, seconds: report.mutation.seconds},
    problems,
    next:
      report.status === 'pass' ? [] : ['Read packages/engine/VERIFICATION.md: fix the code or the proof, never weaken a clause to pass'],
  }
}
