// Decisions the engine owns, which code outside it must ask the engine for rather than re-derive. Each is an ESLint
// `no-restricted-syntax` entry, applied to source files outside the engine here and, by importing this module, in
// repositories that embed this workspace. Tests (engine-contracts.test.mjs) pin what each one catches.

const pair = 'Whether two extractions can be compared is the engine’s decision: call `engine.pair(before, after)`.'

const review =
  'Whether a comparison changed, and how many changes of each kind it has, is the engine’s review: call `engine.review(comparison)` or read a batch item’s `status` and `review`.'

/** Selector attributes for `<path>` being a comparison's `changes`: `comparison.changes` or `x.comparison.changes`. */
const comparisonChanges = path =>
  `[${path}.property.name='changes'][${path}.object.name='comparison'], [${path}.property.name='changes'][${path}.object.property.name='comparison']`

export const engineContracts = [
  {
    // `before.provenance.definitionDigest !== after.provenance.definitionDigest`
    selector:
      "BinaryExpression[operator=/^[!=]==?$/][left.property.name='definitionDigest'][left.object.property.name='provenance'][right.property.name='definitionDigest'][right.object.property.name='provenance']",
    message: pair,
  },
  {
    // `isDeepStrictEqual(before.provenance.definition, after.provenance.definition)`, or any deep equality over one
    selector:
      "CallExpression:matches([callee.name=/^(isDeepStrictEqual|isDeepEqual|deepEqual|deepStrictEqual|isEqual|sameJson)$/], [callee.property.name=/^(isDeepStrictEqual|isDeepEqual|deepEqual|deepStrictEqual|isEqual)$/]) MemberExpression[property.name='definition'][object.property.name='provenance']",
    message: pair,
  },
  {
    // `const {presentation, ...rest} = definition`: what of a definition affects extraction is the engine's
    // `extraction_definition`, which `engine.pair` applies.
    selector: "VariableDeclarator[init.name=/[dD]efinition$/] > ObjectPattern:has(Property[key.name='presentation']):has(RestElement)",
    message: `${pair} It ignores \`presentation\` itself.`,
  },
  {
    // `comparison.changes.length > 0`, `!comparison.changes.length`: expected variation alone is not a change.
    selector: `:matches(BinaryExpression, LogicalExpression, UnaryExpression[operator='!'], ConditionalExpression, IfStatement) > MemberExpression[property.name='length']:matches(${comparisonChanges('object')})`,
    message: review,
  },
  {
    // `comparison.changes.some(change => change.status !== 'unchanged')`: an identity change is reviewable too.
    selector: `CallExpression[callee.property.name=/^(some|every)$/]:matches(${comparisonChanges('callee.object')}) BinaryExpression[right.value='unchanged']`,
    message: review,
  },
]

/** The ESLint rule entry: `rules: {'no-restricted-syntax': engineContractsRule}`. */
export const engineContractsRule = ['error', ...engineContracts]
