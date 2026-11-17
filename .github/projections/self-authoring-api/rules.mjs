// The comparator rules language as api/v0 declarations, from packages/comparators/rules/language.json: the language
// description the rules crate generates and its tests keep current. Its standard library's functions, its macros, the
// protocol's object types expressions read (each with its fields in its signature) and the evaluation budget, nested under one row for the
// language. Each function's cost note is prose and is left out.

export function rulesDeclarations({language, text, source}) {
  const entities = []
  const relationships = []
  const lineOf = needle => {
    const index = text.indexOf(needle)
    return index < 0 ? undefined : text.slice(0, index).split('\n').length
  }
  const declare = (parent, entity, needle) => {
    const line = needle && lineOf(needle)
    entities.push({...entity, evidence: [{kind: 'language', source, ...(line ? {location: {line}} : {})}]})
    if (parent) relationships.push({id: `contains:${parent}->${entity.id}`, kind: 'contains', from: parent, to: entity.id})
  }
  const root = 'rules'
  declare(
    undefined,
    {
      id: root,
      kind: 'language',
      label: 'ComparatorRules',
      data: {signature: `CEL in ${language.format} files, version ${language.version}, revision ${language.revision}`},
    },
    undefined,
  )
  declare(root, {id: `${root}:budget`, kind: 'constant', label: 'budget', data: {signature: `budget = ${language.budget}`}}, '"budget"')
  const seen = new Map()
  for (const fn of language.library ?? []) {
    // Overloads share a name: the second is `name#2`.
    const count = (seen.get(fn.name) ?? 0) + 1
    seen.set(fn.name, count)
    const id = `${root}:${fn.name}${count > 1 ? `#${count}` : ''}`
    declare(
      root,
      {id, kind: 'function', label: fn.name, data: {signature: `${fn.name}(${(fn.params ?? []).join(', ')}): ${fn.returns}`}},
      `"name": "${fn.name}"`,
    )
  }
  for (const macro of language.macros ?? [])
    declare(root, {id: `${root}:${macro}`, kind: 'macro', label: macro, data: {signature: `macro ${macro}`}}, `"${macro}"`)
  // A type's fields are few and short: one signature lists them, so a field's change shows in its type's row.
  for (const type of language.types ?? []) {
    const fields = (type.fields ?? []).map(([name, fieldType]) => `${name}: ${fieldType}`).join('; ')
    declare(
      root,
      {id: `${root}:${type.name}`, kind: 'type', label: type.name, data: {signature: `type ${type.name} = {${fields}}`}},
      `"name": "${type.name}"`,
    )
  }
  return {entities, relationships}
}
