// Decisions the engine owns, which code outside it must ask the engine for rather than re-derive. Each is an ESLint
// `no-restricted-syntax` entry, applied to source files outside the engine here and, by importing this module, in
// repositories that embed this workspace. Tests (engine-contracts.test.mjs) pin what each one catches.

const pair = 'Whether two extractions can be compared is the engine’s decision: call `engine.pair(before, after)`.'

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
]

/** The ESLint rule entry: `rules: {'no-restricted-syntax': engineContractsRule}`. */
export const engineContractsRule = ['error', ...engineContracts]
