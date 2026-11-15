import {readFileSync} from 'node:fs'
import path from 'node:path'

const request = JSON.parse(readFileSync(0, 'utf8'))
if (request.protocolVersion !== 0 || request.capabilities?.trusted !== true)
  throw new Error('Review both revisions and explicitly authorize execution')
const {services} = JSON.parse(readFileSync(path.join(request.repository.root, 'services.json'), 'utf8'))
if (!Array.isArray(services)) throw new Error('services must be an array')
const evidence = [{kind: 'declared-service-catalog', source: 'services.json'}]
const entities = services.map(service => {
  if (typeof service.name !== 'string' || typeof service.language !== 'string') throw new Error('Each service needs a name and language')
  return {
    id: `service:${service.name}`,
    kind: 'service',
    label: service.name,
    data: {language: service.language},
    confidence: 'authoritative',
    evidence,
  }
})
const relationships = services.flatMap(service => {
  if (!Array.isArray(service.dependencies) || service.dependencies.some(dependency => typeof dependency !== 'string'))
    throw new Error('dependencies must be string arrays')
  return service.dependencies.map(dependency => ({
    id: `dependency:${JSON.stringify([service.name, dependency])}`,
    kind: 'depends-on',
    from: `service:${service.name}`,
    to: `service:${dependency}`,
    confidence: 'authoritative',
    evidence,
  }))
})
process.stdout.write(
  JSON.stringify({
    protocolVersion: 0,
    schema: 'architecture/v0',
    entities,
    relationships,
    metadata: {authority: 'Declared service catalog, not runtime topology discovery.'},
  }),
)
