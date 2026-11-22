import {execFile, spawn} from 'node:child_process'
import {chmod, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createInterface} from 'node:readline'

/** Runs an argv without a shell; rejects with stderr on a nonzero exit, timeout or oversized output. */
export function runBounded(command, args, {label, cwd, env, timeoutMs = 60_000, input, maxStdoutBytes = 8 * 1024 * 1024}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {cwd, env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: maxStdoutBytes, encoding: 'utf8'},
      (error, stdout, stderr) => {
        if (!error) {
          resolve({stdout, stderr})
          return
        }
        const failure = new Error(`${label} exited with ${error.signal ?? error.code}${stderr ? `\n${stderr.slice(0, 4096)}` : ''}`, {
          cause: error,
        })
        failure.output = {stdout, stderr}
        reject(failure)
      },
    )
    child.stdin.end(input)
  })
}

/** Only explicitly selected names are copied; no HOME, tokens, loader hooks or shell startup environment. */
export function executionEnvironment(source, names = []) {
  const environment = {LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC'}
  for (const name of ['PATH', 'SystemRoot', ...names]) if (source[name] !== undefined) environment[name] = source[name]
  return environment
}

/**
 * Starts `projections serve --stdio` (with `args`) and initializes it: `request(method, path, body?)` sends one
 * JSON-RPC `request` and resolves `{status, contentType, body}`; `close()` closes standard input and resolves the
 * exit `{code, signal}`.
 */
export async function startBackend(executable, args, {cwd, env}) {
  const child = spawn(executable, ['serve', '--stdio', ...args], {cwd, env, stdio: ['pipe', 'pipe', 'pipe']})
  let diagnostics = ''
  child.stderr.on('data', bytes => {
    diagnostics += String(bytes)
  })
  child.stdin.on('error', () => {})
  const exited = new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({code, signal}))
    child.once('error', reject)
  })
  const pending = new Map()
  const lines = createInterface({input: child.stdout})
  lines.on('line', line => {
    const message = JSON.parse(line)
    if (message.id === undefined) return
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  let nextId = 1
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`No reply to ${method}: ${diagnostics}`)), 60_000)
      pending.set(id, message => {
        clearTimeout(timer)
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`))
        else resolve(message.result)
      })
      child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, ...(params === undefined ? {} : {params})})}\n`)
    })
  const close = async () => {
    child.stdin.end()
    let timer
    try {
      return await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error(`Backend shutdown deadline: ${diagnostics}`))
          }, 10_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
      lines.close()
    }
  }
  try {
    const info = await Promise.race([
      call('initialize'),
      exited.then(() => {
        throw new Error(`The backend exited: ${diagnostics}`)
      }),
    ])
    return {
      info,
      request: (method, requestPath, body) => call('request', {method, path: requestPath, ...(body === undefined ? {} : {body})}),
      close,
      diagnostics: () => diagnostics,
    }
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  }
}

/** Polls a job through `backend` until it finishes. */
export async function finishedJob(backend, started, {attempts = 3000, intervalMs = 20} = {}) {
  let job = started
  for (let count = 0; count < attempts && job.status === 'running'; count++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))
    job = (await backend.request('GET', `/api/jobs/${job.id}`)).body
  }
  return job
}

/**
 * Writes `gh` and `git` stand-ins for an offline `projections pr`: `gh api` returns the
 * given metadata and `git fetch` copies the exact commits from a local repository.
 */
export async function pullRequestTools(directory, {gitPath, repository, metadata, base, head, receipt}) {
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
  await writeFile(path.join(directory, 'gh'), `#!/bin/sh\n[ "$1" = api ] || exit 2\nprintf '%s' ${quote(JSON.stringify(metadata))}\n`)
  await writeFile(
    path.join(directory, 'git'),
    `#!/bin/sh
for argument in "$@"; do
if [ "$argument" = fetch ]; then
${receipt ? `printf '%s\\0' "$@" > ${quote(receipt)}\n` : ''}exec ${quote(gitPath)} --git-dir "$PWD" -c protocol.file.allow=always fetch --quiet --no-auto-maintenance ${quote(repository)} ${quote(`${base}:refs/projections/base`)} ${quote(`${head}:refs/projections/head`)}
fi
done
exec ${quote(gitPath)} "$@"
`,
  )
  for (const name of ['gh', 'git']) await chmod(path.join(directory, name), 0o755)
}
