// A lint rule for what Considered (.considered.yaml) can measure. Its scc provider reads a backtick inside a regular
// expression literal as the start of a template string and stops counting the rest of the file, so a file can be over
// its size and complexity limits unnoticed. The rule reports such a backtick and fixes it to `\x60`, the same character.

/** The pattern with each backtick (escaped or not) written `\x60`. */
const withoutBackticks = pattern => pattern.replaceAll(/(?<!\\)((?:\\\\)*)\\?\x60/gu, '$1\\x60')

/** @type {import('eslint').Rule.RuleModule} */
const regexBacktick = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {description: 'Write a backtick in a regular expression literal as \\x60, which scc counts correctly'},
    messages: {
      backtick:
        'Write this backtick as \\x60: scc, which `considered` measures files with, reads it as the start of a template string and stops counting the file.',
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (!node.regex?.pattern.includes('`')) return
        context.report({
          node,
          messageId: 'backtick',
          fix: fixer => fixer.replaceText(node, `/${withoutBackticks(node.regex.pattern)}/${node.regex.flags}`),
        })
      },
    }
  },
}

export const consideredPlugin = {rules: {'regex-backtick': regexBacktick}}
