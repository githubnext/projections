/*
 * A definition's paths are relative to its project, the directory holding its `.github/projections` (or
 * `.projections`); git reports paths relative to the repository's root. Nothing here imports VS Code.
 */

/**
 * `path`, relative to the project at `prefix` (its repository-relative directory, as `git rev-parse --show-prefix`
 * prints it: `/`-terminated, or empty at the repository's root), as a repository-relative path. A definition's paths
 * are relative to its project; leading `..` segments leave it, but nothing leaves the repository.
 */
export function inRepository(prefix: string, path: unknown): string | undefined {
  if (typeof path !== 'string' || !path || path.startsWith('/')) return undefined
  const parts = prefix.split('/').filter(Boolean)
  for (const segment of path.split(/[\\/]/)) {
    if (segment === '' || segment === '.') continue
    if (segment !== '..') parts.push(segment)
    else if (!parts.pop()) return undefined
  }
  return parts.join('/') || undefined
}
