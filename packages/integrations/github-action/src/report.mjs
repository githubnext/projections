// What the summary and the comment report: the run's manifest, each projection's document from the artifact
// directory, and any snapshots the workflow rendered.
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {snapshotIndex} from './lib.mjs'

export function loadReport(environment) {
  const manifestPath = environment.PROJECTIONS_MANIFEST
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const documents = new Map()
  for (const projection of manifest.projections) {
    if (projection.path)
      documents.set(projection.id, JSON.parse(readFileSync(path.join(path.dirname(manifestPath), projection.path), 'utf8')))
  }
  const indexPath = environment.PROJECTIONS_SNAPSHOTS && path.join(environment.PROJECTIONS_SNAPSHOTS, snapshotIndex)
  const snapshots =
    indexPath && existsSync(indexPath)
      ? {
          index: JSON.parse(readFileSync(indexPath, 'utf8')),
          images: environment.PROJECTIONS_SNAPSHOT_IMAGES ? JSON.parse(environment.PROJECTIONS_SNAPSHOT_IMAGES) : undefined,
          artifactUrl: environment.PROJECTIONS_SNAPSHOTS_ARTIFACT_URL || undefined,
        }
      : undefined
  const options = {hostedUrl: environment.INPUT_HOSTED_URL, artifactName: environment.INPUT_ARTIFACT_NAME || 'projections', snapshots}
  return {manifest, documents, options}
}
