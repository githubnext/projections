// The samples' basics: the extractor request and process protocol, IDs and paths.
import {readFileSync} from 'node:fs'
import path from 'node:path'

/** Evidence illustrates an entity; extractions keep a representative sample. */
export const MAX_EVIDENCE = 25
export const sourceExtension = /\.(?:[cm]?[jt]sx?)$/
export const slash = value => value.split(path.sep).join('/')
export const compareIds = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
/** An entity or relationship ID from its parts. */
export const id = (...parts) => parts.map(encodeURIComponent).join(':')

/** Reads the extractor request from stdin. */
export function readRequest() {
  const request = JSON.parse(readFileSync(0, 'utf8'))
  if (request.protocolVersion !== 0) throw new Error('Unsupported extractor request protocol')
  return request
}

/** Runs `extract(request)` and writes its extraction, or the error, as the protocol requires. */
export async function main(extract) {
  try {
    process.stdout.write(JSON.stringify(await extract(readRequest())))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export const inputs = request => request.projection.definition.inputs ?? {}
