import Type from 'typebox'
import {Identifier} from './definition.js'
import {annotated, Closed, define} from './support.js'

const document = 'bookmarks'

const Revision = (description: string) => Type.String({minLength: 1, maxLength: 1024, description})

/** The JSON Schema of one bookmark, the bookmarks schema's `$defs/bookmark`: a named comparison to revisit. */
export const BookmarkSchema = define(
  document,
  'bookmark',
  Closed({
    id: annotated(Identifier, {description: "The bookmark's ID, unique in the file."}),
    title: Type.String({minLength: 1, maxLength: 1000, description: 'What the comparison shows.'}),
    projectionId: annotated(Identifier, {description: 'The projection it compares.'}),
    before: Revision('The revision before: a commit, branch, tag or other Git revision.'),
    after: Type.Optional(Revision('The revision after; absent means the working tree.')),
  }),
)

/** The JSON Schema of `.projections-bookmarks.json`, a repository's saved comparisons, which `projections bookmark` reads. */
export const BookmarksSchema = Closed(
  {
    format: Type.Literal('projections.bookmarks'),
    version: Type.Literal(0),
    bookmarks: Type.Array(BookmarkSchema, {maxItems: 100}),
  },
  {
    description:
      '`.projections-bookmarks.json` at the repository root: saved comparisons to revisit, each a projection and two revisions. `projections bookmark` reads it; bookmark IDs are unique within the file.',
  },
)
