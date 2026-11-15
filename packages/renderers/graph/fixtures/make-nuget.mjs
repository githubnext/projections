// Writes the NuGet-style dependency graph fixture (nuget-before.json and nuget-after.json): two projects whose package IDs, like the NuGet extractor's,
// are independent of the resolved version, which is package data.
import {writeFileSync} from 'node:fs'

const key = parts => parts.map(part => encodeURIComponent(part)).join(':')
function state(packages) {
  const entities = [], relationships = []
  const rel = (kind, from, to) => relationships.push({id: key([kind, from, to]), kind, from, to})
  for (const project of ['Api', 'Worker']) {
    const projectId = key(['nuget-project', project]), framework = key(['nuget-target', project, 'net9.0'])
    entities.push({id: projectId, kind: 'project', label: project, confidence: 'authoritative'},
      {id: framework, kind: 'target-framework', label: 'net9.0', data: {framework: '.NETCoreApp,Version=v9.0'}, confidence: 'authoritative'})
    rel('targets', projectId, framework)
    const ids = new Map()
    for (const [owner, name, version, direct, dependsOn] of packages) {
      if (owner !== project) continue
      const id = key(['nuget-library', project, 'net9.0', name.toLowerCase()])
      ids.set(name, id)
      entities.push({id, kind: 'package', label: name, data: {version, target: 'net9.0', type: 'package'}, confidence: 'authoritative',
        evidence: [{kind: 'source', source: `src/${project}/packages.lock.json`}]})
      rel('resolved', framework, id)
      if (direct) rel('direct-dependency', framework, id)
    }
    for (const [owner, name, , , dependsOn] of packages) {
      if (owner === project && dependsOn && ids.has(dependsOn)) rel('depends-on', ids.get(name), ids.get(dependsOn))
    }
  }
  return {protocolVersion: 0, schema: 'graph/v0', entities, relationships,
    metadata: {limitations: ['Synthetic fixture modelled on the NuGet extractor; no repository was examined.']}}
}
const before = state([
  ['Api', 'FluentValidation', '11.9.2', true],
  ['Api', 'Serilog', '3.1.1', true],
  ['Api', 'Serilog.Sinks.Console', '4.1.0', false, 'Serilog'],
  ['Api', 'Newtonsoft.Json', '13.0.1', true],
  ['Api', 'Polly', '8.2.0', true],
  ['Api', 'Shared.Contracts', '8.0.0', true],
  ['Worker', 'Shared.Contracts', '8.0.2', true],
  ['Worker', 'Azure.Messaging.ServiceBus', '7.17.0', true],
  ['Worker', 'Azure.Core', '1.36.0', false, 'Azure.Messaging.ServiceBus'],
])
const after = state([
  ['Api', 'FluentValidation', '12.0.0', true],
  ['Api', 'Serilog', '3.1.1', true],
  ['Api', 'Serilog.Sinks.Console', '5.0.0', false, 'Serilog'],
  ['Api', 'System.Text.Json', '9.0.0', true],
  ['Api', 'Polly', '8.1.0', true],
  ['Api', 'Shared.Contracts', '9.0.0', true],
  ['Worker', 'Shared.Contracts', '9.0.0', true],
  ['Worker', 'Azure.Messaging.ServiceBus', '7.18.1', true],
  ['Worker', 'Azure.Core', '1.36.0', false, 'Azure.Messaging.ServiceBus'],
  ['Worker', 'OpenTelemetry', '1.9.0', true],
])
const write = (name, value) => writeFileSync(new URL(`./${name}`, import.meta.url), JSON.stringify(value, null, 2) + '\n')
write('nuget-before.json', before)
write('nuget-after.json', after)
