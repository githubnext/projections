// Version strings: comparing them, matching them against simple ranges and finding them in a tool's output.

/** Compares dotted versions numerically: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(/[.-]/u).map(part => Number.parseInt(part, 10) || 0)
  const right = b.split(/[.-]/u).map(part => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

/** Whether `version` satisfies a simple range: `>=x`, `^x`, `~x`, `x.x.x` or `x.x.*`. */
export function satisfies(version: string, range: string): boolean {
  return range
    .split('||')
    .map(part => part.trim())
    .some(part => {
      const match = /^(>=|[\^~=])?\s*v?([\d.x*]+)$/u.exec(part)
      if (!match) return true
      const [, operator, wanted = ''] = match
      const [major, minor] = wanted.split('.')
      if (operator === '>=') return compareVersions(version, wanted) >= 0
      if (operator === '^') return version.split('.')[0] === major && compareVersions(version, wanted) >= 0
      if (operator === '~') return version.split('.').slice(0, 2).join('.') === `${major}.${minor}` && compareVersions(version, wanted) >= 0
      const prefix = wanted.replace(/\.?[x*].*$/u, '')
      return prefix === wanted ? compareVersions(version, wanted) === 0 : version === prefix || version.startsWith(`${prefix}.`)
    })
}

/** The first dotted version in a tool's output. */
export function versionIn(text: string | undefined): string | undefined {
  return text ? /(\d+\.\d+(?:\.\d+)?)/u.exec(text)?.[1] : undefined
}
