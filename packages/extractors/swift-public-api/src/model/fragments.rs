//! Declaration fragments: the declaration as the compiler prints it, as
//! tokens with kinds (`keyword`, `identifier`, `typeIdentifier`, `text`, …).

use serde_json::Value;

fn fragments(value: &Value) -> impl Iterator<Item = (&str, &str)> {
    value.as_array().into_iter().flatten().map(|fragment| {
        (
            fragment["kind"].as_str().unwrap_or_default(),
            fragment["spelling"].as_str().unwrap_or_default(),
        )
    })
}

/// The fragments as source text.
pub(crate) fn text(value: &Value) -> String {
    fragments(value).map(|(_, spelling)| spelling).collect()
}

pub(crate) fn has_keyword(value: &Value, keyword: &str) -> bool {
    fragments(value).any(|(kind, spelling)| kind == "keyword" && spelling == keyword)
}

/// Attributes the declaration shows, such as `@discardableResult` or `@MainActor`.
pub(crate) fn attributes(value: &Value) -> Vec<String> {
    fragments(value)
        .filter(|(kind, _)| *kind == "attribute")
        .map(|(_, spelling)| spelling.to_owned())
        .collect()
}

/// The text after the declared name: from its identifier fragment on, or,
/// for an initializer or subscript, whose keyword is its name, from that.
fn after_name(value: &Value) -> String {
    let mut seen = false;
    let mut out = String::new();
    for (kind, spelling) in fragments(value) {
        if seen {
            out.push_str(spelling);
        } else if kind == "identifier" || (kind == "keyword" && matches!(spelling, "init" | "subscript")) {
            seen = true;
        }
    }
    out
}

/// A property's, variable's or case's type: what follows `name:` up to an
/// accessor block or initial value.
pub(crate) fn declared_type(value: &Value) -> Option<String> {
    let rest = after_name(value);
    let rest = rest.trim_start().strip_prefix(':')?;
    let end = rest.find(" {").or_else(|| rest.find(" =")).unwrap_or(rest.len());
    Some(rest[..end].trim().to_owned()).filter(|text| !text.is_empty())
}

/// What a type alias names: what follows `=`.
pub(crate) fn aliased(value: &Value) -> Option<String> {
    let rest = after_name(value);
    let (_, aliased) = rest.split_once('=')?;
    Some(aliased.trim().to_owned())
}

/// What the declaration's parameter list shows about each parameter.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Shown {
    pub default: Option<String>,
    pub variadic: bool,
    pub inout: bool,
}

/// The parameters of the first parameter list after the name, in order.
pub(crate) fn parameters(value: &Value) -> Vec<Shown> {
    let rest = after_name(value);
    let Some(open) = rest.find('(') else {
        return Vec::new();
    };
    let mut chunks = vec![String::new()];
    let mut depth = 0i32;
    let chars: Vec<char> = rest[open + 1..].chars().collect();
    for (at, &c) in chars.iter().enumerate() {
        match c {
            '(' | '[' | '<' => depth += 1,
            '>' if at > 0 && chars[at - 1] == '-' => {}
            ')' | ']' | '>' if depth > 0 => depth -= 1,
            ')' => break,
            ',' if depth == 0 => {
                chunks.push(String::new());
                continue;
            }
            _ => {}
        }
        chunks.last_mut().unwrap().push(c);
    }
    chunks
        .into_iter()
        .filter(|chunk| !chunk.trim().is_empty())
        .map(|chunk| Shown {
            default: chunk.split_once(" = ").map(|(_, default)| default.trim().to_owned()),
            variadic: chunk.contains("..."),
            inout: chunk.contains("inout "),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn declaration(parts: &[(&str, &str)]) -> Value {
        json!(
            parts
                .iter()
                .map(|(kind, spelling)| json!({"kind": kind, "spelling": spelling}))
                .collect::<Vec<_>>()
        )
    }

    #[test]
    fn reads_types_and_parameters_from_fragments() {
        let property = declaration(&[
            ("keyword", "var"),
            ("text", " "),
            ("identifier", "entries"),
            ("text", ": "),
            ("typeIdentifier", "Store"),
            ("text", " { "),
            ("keyword", "get"),
            ("text", " }"),
        ]);
        assert_eq!(declared_type(&property).as_deref(), Some("Store"));
        let method = declaration(&[
            ("keyword", "func"),
            ("text", " "),
            ("identifier", "balance"),
            ("text", "<T>(in currency: "),
            ("typeIdentifier", "String"),
            ("text", ", by: ("),
            ("typeIdentifier", "Int"),
            ("text", ") -> "),
            ("typeIdentifier", "Bool"),
            ("text", ", rates: [String : Double] = [:], _ values: inout "),
            ("typeIdentifier", "Int"),
            ("text", "...) -> "),
            ("typeIdentifier", "Amount"),
        ]);
        let shown = parameters(&method);
        assert_eq!(shown.len(), 4);
        assert_eq!(shown[2].default.as_deref(), Some("[:]"));
        assert!(shown[3].variadic && shown[3].inout);
        let init = declaration(&[
            ("keyword", "init"),
            ("text", "("),
            ("externalParam", "memo"),
            ("text", ": "),
            ("typeIdentifier", "String"),
            ("text", "? = nil)"),
        ]);
        assert_eq!(parameters(&init)[0].default.as_deref(), Some("nil"));
        let alias = declaration(&[
            ("keyword", "typealias"),
            ("text", " "),
            ("identifier", "Rates"),
            ("text", " = ["),
            ("typeIdentifier", "String"),
            ("text", "]"),
        ]);
        assert_eq!(aliased(&alias).as_deref(), Some("[String]"));
    }
}
