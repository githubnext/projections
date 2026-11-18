//! A Swift file's top-level `import` declarations.

use crate::lexer::{Kind, Token, tokens};
use anyhow::Result;

/// One `import`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Import {
    /// The imported module: the first component of the path (`Foundation` in
    /// `import struct Foundation.URL`).
    pub module: String,
    /// Attributes such as `@testable`, `@_exported` or `@preconcurrency`.
    pub attributes: Vec<String>,
    /// An access modifier (`public import`, `internal import`), if any.
    pub access: Option<String>,
    /// Inside `#if`, so whether it applies depends on the build.
    pub conditional: bool,
    pub line: usize,
}

const ACCESS: [&str; 6] = ["public", "package", "internal", "fileprivate", "private", "open"];

/// The imports in `source`, in order.
pub fn imports(source: &str) -> Result<Vec<Import>> {
    let tokens = tokens(source)?;
    let mut found = Vec::new();
    let (mut depth, mut conditional) = (0usize, 0usize);
    for (at, token) in tokens.iter().enumerate() {
        match (&token.kind, token.text.as_str()) {
            (Kind::Punct, "{" | "(" | "[") => depth += 1,
            (Kind::Punct, "}" | ")" | "]") => depth = depth.saturating_sub(1),
            (Kind::Directive, "#if") => conditional += 1,
            (Kind::Directive, "#endif") => conditional = conditional.saturating_sub(1),
            (Kind::Ident, "import") if depth == 0 => {
                if let Some(import) = declaration(&tokens, at, conditional > 0) {
                    found.push(import);
                }
            }
            _ => {}
        }
    }
    Ok(found)
}

/// The import whose `import` keyword is at `at`.
fn declaration(tokens: &[Token], at: usize, conditional: bool) -> Option<Import> {
    let line = tokens[at].line;
    let mut path = at + 1;
    // `import struct Foundation.URL`: a kind before the path.
    if tokens
        .get(path + 1)
        .is_some_and(|next| next.kind == Kind::Ident && next.line == line)
    {
        path += 1;
    }
    let module = tokens.get(path).filter(|token| token.kind == Kind::Ident)?.text.clone();
    let (mut attributes, mut access) = (Vec::new(), None);
    let mut before = at;
    while before > 0 {
        let token = &tokens[before - 1];
        if token.kind == Kind::Ident && ACCESS.contains(&token.text.as_str()) && access.is_none() {
            access = Some(token.text.clone());
            before -= 1;
        } else if token.kind == Kind::Ident && before >= 2 && tokens[before - 2].punct("@") {
            attributes.insert(0, format!("@{}", token.text));
            before -= 2;
        } else {
            break;
        }
    }
    Some(Import {
        module,
        attributes,
        access,
        conditional,
        line,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_top_level_imports_with_their_attributes_kind_and_conditions() {
        let source = "@testable import Harbor\npublic import struct Foundation.URL\n#if canImport(UIKit)\n@preconcurrency import UIKit\n#endif\nfunc f() { let import = 1 }\n// import Hidden\nimport A; import B\n";
        let found = imports(source).unwrap();
        let summary: Vec<(&str, Vec<&str>, Option<&str>, bool)> = found
            .iter()
            .map(|import| {
                (
                    import.module.as_str(),
                    import.attributes.iter().map(String::as_str).collect(),
                    import.access.as_deref(),
                    import.conditional,
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("Harbor", vec!["@testable"], None, false),
                ("Foundation", vec![], Some("public"), false),
                ("UIKit", vec!["@preconcurrency"], None, true),
                ("A", vec![], None, false),
                ("B", vec![], None, false),
            ]
        );
    }
}
