import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {validator} from '@exodus/schemasafe'
import {schemaUrl} from '@githubnext/projections-schemas'

// Every published schema, since documents refer to one another (the extraction to its domain schemas).
const directory = new URL(import.meta.resolve('@githubnext/projections-schemas/schemas/extraction/v0.json'), import.meta.url)
const root = new URL('../../', directory)
const files = (await readdir(root, {recursive: true})).filter(file => /(?:^|[\\/])v\d+\.json$/.test(file))
const schemas = await Promise.all(files.map(async file => JSON.parse(await readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8'))))
const references = new Map(schemas.map(schema => [schema.$id, schema]))
const modules = [
  ['extraction-document', 'validateExtractionDocument'],
  ['comparison-document', 'validateComparisonDocument'],
].map(([name, exportName]) => {
  const schema = schemas.find(candidate => candidate.$id === schemaUrl(name))
  const validate = validator(schema, {schemas: references, includeErrors: true})
  return `export const ${exportName} = ${validate.toModule()};`
})
await mkdir(new URL('../dist/artifacts/', import.meta.url), {recursive: true})
await writeFile(new URL('../dist/artifacts/validators.js', import.meta.url), `${modules.join('\n')}\n`)
await writeFile(
  new URL('../dist/artifacts/LICENSE.schemasafe.txt', import.meta.url),
  await readFile(new URL('./LICENSE', import.meta.resolve('@exodus/schemasafe/package.json')), 'utf8'),
)
