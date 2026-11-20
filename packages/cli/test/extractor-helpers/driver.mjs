// Runs one case of packages/schemas/fixtures/extractor-helpers.json (its JSON is the argument) through
// `@githubnext/projections/extractor`, as an extractor imports it: the accessors' values or the extraction on stdout, or
// `error: <message>` on stderr. extractor-helpers.test.mjs runs it with the runner's preload.
import {request, result} from '@githubnext/projections/extractor'

const testCase = JSON.parse(process.argv[2])
try {
  if (testCase.accessors)
    process.stdout.write(JSON.stringify(Object.fromEntries(testCase.accessors.map(name => [name, request[name] ?? null]))))
  else result(testCase.result)
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`)
  process.exitCode = 1
}
