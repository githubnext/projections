/**
 * A projection tab's resource: `projection:/<folder name>/<title>?folder=<folder URI>&id=<id>`. The path's last
 * segment is the tab title (VS Code titles custom editors by their resource's name), and its folder segment tells
 * apart projections of the same name in different folders.
 */
export function projectionPath(folderName: string, title: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = (text: string) => text.replace(/[/\\]/g, '∕').replace(/[\u0000-\u001f]/g, '') || 'projection'
  return `/${clean(folderName)}/${clean(title)}`
}

export function projectionQuery(folder: string, id: string): string {
  return new URLSearchParams({folder, id}).toString()
}

/** The folder URI and projection ID of a `projection:` resource's query. */
export function parseProjectionQuery(query: string): {folder: string; id: string} | undefined {
  const params = new URLSearchParams(query)
  const folder = params.get('folder')
  const id = params.get('id')
  return folder && id && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) ? {folder, id} : undefined
}
