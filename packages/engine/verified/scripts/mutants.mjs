// The mutation check, as PDD Kit runs it: each mutant plants one bug aimed at
// one `ensures` clause in a scratch copy of the crate, and Verus must reject
// it on that clause. A mutant Verus accepts means its clause constrains
// nothing. The mutants are in ../mutants/<module>.mjs, one file per module of
// src/; verify.mjs runs this after the proofs.
//
// Each mutant replaces `from` with `to` in its module (every occurrence, so a
// specification and its code can change together), then each `also` pair,
// and must fail the clause containing `clause`, or the proof step that
// establishes it, `step`, where the proof breaks first.

import {spawn} from 'node:child_process'
import {cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {availableParallelism, tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const noop = () => undefined

const crate = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = join(crate, 'src')

/** Every mutant, with the module (a file of src/) it mutates. */
export async function mutants() {
  const directory = join(crate, 'mutants')
  const all = []
  for (const file of readdirSync(directory)
    .filter(name => name.endsWith('.mjs'))
    .sort()) {
    const module = file.replace(/\.mjs$/u, '.rs')
    if (!existsSync(join(sources, module))) throw new Error(`mutants/${file} has no src/${module}`)
    const {default: list} = await import(pathToFileURL(join(directory, file)).href)
    all.push(...list.map(mutant => ({...mutant, file: module})))
  }
  return all
}

// Only the mutated module is verified: its clauses are the ones a mutant must fail, and the rest of the crate is
// unchanged, so verifying it again would only cost time.
function verus(executable, directory, module) {
  return new Promise(resolve => {
    const args = ['--crate-type=lib', '--rlimit', '100', '--multiple-errors', '100', '--verify-module', module, join(directory, 'lib.rs')]
    const child = spawn(executable, args)
    let output = ''
    child.stdout.on('data', chunk => (output += chunk))
    child.stderr.on('data', chunk => (output += chunk))
    child.on('close', status => resolve({ok: status === 0, output}))
  })
}

/** Plants one mutant in a scratch copy and runs Verus over it. */
async function plant(executable, mutant) {
  const scratch = mkdtempSync(join(tmpdir(), 'verified-mutant-'))
  try {
    cpSync(sources, scratch, {recursive: true})
    const path = join(scratch, mutant.file)
    let text = readFileSync(path, 'utf8')
    for (const [from, to] of [[mutant.from, mutant.to], ...(mutant.also ?? [])]) {
      if (!text.includes(from)) return {name: mutant.name, caught: false, detail: `${JSON.stringify(from)} is not in src/${mutant.file}`}
      text = text.replaceAll(from, to)
    }
    writeFileSync(path, text)
    const {ok, output} = await verus(executable, scratch, mutant.file.replace(/\.rs$/u, ''))
    const caught = !ok && [mutant.clause, mutant.step].some(expected => expected && output.includes(expected))
    const detail = caught ? undefined : ok ? 'Verus accepted it' : `Verus rejected it, but not on: ${mutant.clause}\n${output}`
    return {name: mutant.name, caught, detail}
  } finally {
    rmSync(scratch, {recursive: true, force: true})
  }
}

/** Runs every mutant, a few at a time ($VERUS_JOBS, default up to 4). */
export async function mutationCheck(executable, log = noop) {
  const started = Date.now()
  const list = await mutants()
  const jobs = Math.max(1, Number(process.env.VERUS_JOBS) || Math.min(4, availableParallelism()))
  const results = Array.from({length: list.length})
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const index = next++
      results[index] = await plant(executable, list[index])
      const {caught, detail} = results[index]
      log(`${caught ? 'caught' : 'MISSED'}  ${list[index].file}: ${list[index].name}${caught ? '' : `\n  ${detail.slice(0, 4000)}`}`)
    }
  }
  await Promise.all(Array.from({length: jobs}, worker))
  const caught = results.filter(result => result.caught).length
  log(`${caught} of ${results.length} mutants caught on their clause`)
  return {caught, total: results.length, seconds: (Date.now() - started) / 1000, results}
}
