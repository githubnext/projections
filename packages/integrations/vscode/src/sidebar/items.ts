import * as vscode from 'vscode'
import {rowUri} from '../decorations.js'
import type {FolderModel} from '../folder-model.js'
import {candidateReason} from '../projections/definitions.js'
import {rendererIcon} from '../projections/rows.js'
import type {Candidate, InvalidDefinition, ProjectionDefinition} from '../projections/definitions.js'
import {rowDescription, rowStatus} from '../row-status.js'

export type Node =
  | {kind: 'folder'; model: FolderModel}
  | {kind: 'projection'; model: FolderModel; definition: ProjectionDefinition}
  | {kind: 'invalid'; model: FolderModel; invalid: InvalidDefinition}
  | {kind: 'problem'; model: FolderModel; invalid: InvalidDefinition; index: number}
  | {kind: 'candidate'; model: FolderModel; candidate: Candidate}
  | {kind: 'message'; label: string; icon: string}

type Of<Kind extends Node['kind']> = Extract<Node, {kind: Kind}>

/** The Projections mark, which a projection's row shares with the tab it opens (as a file's row and tab share theirs). */
let projectionIcon: {light: vscode.Uri; dark: vscode.Uri} | undefined
export function setProjectionIcon(extensionUri: vscode.Uri): {light: vscode.Uri; dark: vscode.Uri} {
  projectionIcon = {
    light: vscode.Uri.joinPath(extensionUri, 'media', 'projection-light.svg'),
    dark: vscode.Uri.joinPath(extensionUri, 'media', 'projection-dark.svg'),
  }
  return projectionIcon
}

function folderItem(node: Of<'folder'>): vscode.TreeItem {
  const item = new vscode.TreeItem(node.model.folder.name, vscode.TreeItemCollapsibleState.Expanded)
  item.iconPath = vscode.ThemeIcon.Folder
  item.resourceUri = node.model.folder.uri
  return item
}

/** A projection: a leaf that opens its tab, with its change count as a badge on its resource. */
function projectionItem(node: Of<'projection'>): vscode.TreeItem {
  const {definition, model} = node
  const title = model.title(definition.id)
  const edited = model.edits.get(definition.id) === 'edited'
  const status = rowStatus(model.status(definition.id), model.pair ? model.describe().name : undefined)
  // A leaf: viewing is a click away; its parts are the Definition view's (a reversible decision; see the README).
  const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None)
  item.id = `${model.folder.uri.toString()}#${definition.id}`
  // Its change count is a badge on its resource (`RowDecorations`); the description says only what is unusual,
  // and whether the definition has uncommitted edits, which its tabs apply. Tabs show the committed title.
  item.resourceUri = rowUri(model.folder, definition.id)
  item.description = rowDescription(status, edited)
  item.iconPath = projectionIcon ?? new vscode.ThemeIcon(rendererIcon(definition.renderer))
  item.contextValue = 'projection'
  item.tooltip = new vscode.MarkdownString(
    [
      `**${title}** \`${definition.id}\``,
      ...(definition.description ? ['', definition.description] : []),
      '',
      status.tooltip,
      ...(edited
        ? ['', 'Its definition has uncommitted edits, which its tabs apply ("Your edits"; Show committed shows the committed version).']
        : []),
    ].join('\n'),
  )
  item.command = {title: 'Open Projection', command: 'projections.openProjection', arguments: [model.folder.uri, definition.id]}
  return item
}

/** A definition file that doesn't load: a failed row, its problems under it. */
function invalidItem(node: Of<'invalid'>): vscode.TreeItem {
  const {invalid, model} = node
  const label = invalid.id ?? invalid.path
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed)
  item.id = `${model.folder.uri.toString()}#invalid:${invalid.path}`
  item.description = 'failed'
  item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'))
  item.contextValue = 'invalidProjection'
  item.tooltip = new vscode.MarkdownString(
    [
      `**${label}** can't load: \`${invalid.path}\` is invalid.`,
      '',
      ...invalid.diagnostics.map(diagnostic => `- ${diagnostic.message}`),
    ].join('\n'),
  )
  item.command = invalid.id
    ? {title: 'Open Projection', command: 'projections.openProjection', arguments: [model.folder.uri, invalid.id]}
    : {title: 'Open Definition', command: 'projections.openDefinitionProblem', arguments: [model.folder.uri, invalid.path, 0]}
  return item
}

function problemItem(node: Of<'problem'>): vscode.TreeItem {
  const diagnostic = node.invalid.diagnostics[node.index]!
  const item = new vscode.TreeItem(diagnostic.message, vscode.TreeItemCollapsibleState.None)
  item.description = diagnostic.location ? `${diagnostic.location.path}:${diagnostic.location.line}` : node.invalid.path
  item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'))
  item.tooltip = diagnostic.message
  item.command = {
    title: 'Open Definition',
    command: 'projections.openDefinitionProblem',
    arguments: [node.model.folder.uri, node.invalid.path, node.index],
  }
  return item
}

/** A suggested projection: why it applies, and Adopt. */
function candidateItem(node: Of<'candidate'>): vscode.TreeItem {
  const {candidate} = node
  const item = new vscode.TreeItem(candidate.title, vscode.TreeItemCollapsibleState.None)
  item.id = `${node.model.folder.uri.toString()}#candidate:${candidate.id}`
  // A short fact (its ID); why it applies is the tooltip's.
  item.description = candidate.id
  item.iconPath = projectionIcon ?? new vscode.ThemeIcon(rendererIcon(candidate.renderer))
  item.contextValue = 'candidate'
  item.tooltip = new vscode.MarkdownString(
    [
      `**${candidate.title}** \`${candidate.id}\``,
      ...(candidate.description ? ['', candidate.description] : []),
      '',
      `${candidateReason(candidate)}, for example:`,
      ...candidate.basis.examples.map(example => `- \`${example}\``),
      ...(candidate.requiresTrust ? ['', 'Runs repository code: needs a trusted workspace.'] : []),
      '',
      'Adopt writes its definition; click to try it on recent changes first.',
    ].join('\n'),
  )
  item.command = {title: 'Explore', command: 'projections.exploreRepository'}
  return item
}

function messageItem(node: Of<'message'>): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
  item.iconPath = new vscode.ThemeIcon(node.icon)
  return item
}

/** A row of the Projections or Suggested view. */
export function sidebarItem(node: Node): vscode.TreeItem {
  switch (node.kind) {
    case 'folder':
      return folderItem(node)
    case 'projection':
      return projectionItem(node)
    case 'invalid':
      return invalidItem(node)
    case 'problem':
      return problemItem(node)
    case 'candidate':
      return candidateItem(node)
    case 'message':
      return messageItem(node)
  }
  throw new TypeError('Unknown sidebar node')
}
