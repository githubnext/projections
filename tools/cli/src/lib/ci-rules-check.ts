// Checks what .github/ci-rules.json's schema can't: that the groups and conditions its rules refer to, and the browser
// suites it configures, exist. The planner refuses rules that fail it, and the tools package's tests run it on the file.
import type {CiRules, When} from './ci-rules.schema.ts'

/** References the schema can't check: groups, conditions and browser suites that don't exist. */
export function ruleProblems(rules: CiRules, suites: readonly string[]): string[] {
  const problems: string[] = []
  const name = (kind: string, known: object, value: string, where: string) => {
    if (!(value in known)) problems.push(`${where}: no ${kind} ${value}`)
  }
  const visit = (when: When, where: string): void => {
    if (typeof when === 'string') return
    if ('any' in when) when.any.forEach((item, index) => visit(item, `${where}.any[${index}]`))
    else if ('not' in when) visit(when.not, `${where}.not`)
    else if ('if' in when) name('condition', rules.conditions, when.if, where)
    else if ('touches' in when) name('group', rules.groups, when.touches, where)
    else if ('reaches' in when) name('group', rules.groups, when.reaches, where)
  }
  for (const [group, {include, exclude = []}] of Object.entries(rules.groups))
    for (const selector of [...include, ...exclude])
      if (typeof selector === 'string' && selector.startsWith('@')) name('group', rules.groups, selector.slice(1), `groups.${group}`)
  for (const [condition, {when}] of Object.entries(rules.conditions)) visit(when, `conditions.${condition}`)
  for (const [job, definition] of Object.entries(rules.jobs)) {
    if ('when' in definition) visit(definition.when, `jobs.${job}`)
    else definition.matrix.forEach((item, index) => visit(item.when, `jobs.${job}.matrix[${index}]`))
  }
  for (const [suite, definition] of Object.entries(rules.browser.suites)) {
    if (!suites.includes(suite)) problems.push(`browser.suites: ${suite} has no test:browser script`)
    if (definition.when) visit(definition.when, `browser.suites.${suite}`)
    if (definition.narrow) name('group', rules.groups, definition.narrow.group, `browser.suites.${suite}.narrow`)
  }
  return problems
}
