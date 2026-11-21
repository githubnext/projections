// The samples' basics: the extractor request and process protocol, IDs and paths.
import path from 'node:path'
import {readRequest, result} from '@githubnext/projections/extractor'

export {readRequest}

/** Evidence illustrates an entity; extractions keep a representative sample. */
export const MAX_EVIDENCE = 25
export const sourceExtension = /\.(?:[cm]?[jt]sx?)$/
export const slash = value => value.split(path.sep).join('/')
export const compareIds = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
/** An entity or relationship ID from its parts. */
export const id = (...parts) => parts.map(encodeURIComponent).join(':')

/** Runs `extract(request)` and writes the extraction it returns with `result()`, or the error, as the protocol requires. */
export async function main(extract) {
  try {
    result(await extract(readRequest()))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export const inputs = request => request.inputs
