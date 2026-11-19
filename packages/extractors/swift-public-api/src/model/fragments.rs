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

/// The parameters of the first parameter list after the name, in order. String
/// literals in defaults are skipped whole, so their commas, parentheses and
/// `=` don't split anything; `variadic` and `inout` come from the type alone.
pub(crate) fn parameters(value: &Value) -> Vec<Shown> {
    let rest = after_name(value);
    let Some(open) = rest.find('(') else {
        return Vec::new();
    };
    let chars: Vec<char> = rest[open + 1..].chars().collect();
    // Each parameter's text before its top-level ` = `, and its default.
    let mut chunks: Vec<(String, Option<String>)> = vec![(String::new(), None)];
    let mut depth = 0i32;
    let mut at = 0;
    while at < chars.len() {
        let c = chars[at];
        let chunk = chunks.last_mut().unwrap();
        if starts_literal(&chars[at..]) {
            let end = literal_end(&chars, at);
            push(chunk, &chars[at..end]);
            at = end;
            continue;
        }
        match c {
            '(' | '[' | '<' => depth += 1,
            '>' if at > 0 && chars[at - 1] == '-' => {}
            ')' | ']' | '>' if depth > 0 => depth -= 1,
            ')' => break,
            ',' if depth == 0 => {
                chunks.push((String::new(), None));
                at += 1;
                continue;
            }
            '=' if depth == 0 && chunk.1.is_none() && at > 0 && chars[at - 1] == ' ' && chars.get(at + 1) == Some(&' ') => {
                chunk.1 = Some(String::new());
                at += 1;
                continue;
            }
            _ => {}
        }
        push(chunk, &chars[at..=at]);
        at += 1;
    }
    chunks
        .into_iter()
        .filter(|(typed, _)| !typed.trim().is_empty())
        .map(|(typed, default)| {
            let typed = typed.split_once(':').map_or("", |(_, typed)| typed).trim();
            Shown {
                default: default.map(|default| default.trim().to_owned()),
                variadic: typed.ends_with("..."),
                inout: typed.starts_with("inout "),
            }
        })
        .collect()
}

fn push(chunk: &mut (String, Option<String>), text: &[char]) {
    match &mut chunk.1 {
        Some(default) => default.extend(text),
        None => chunk.0.extend(text),
    }
}

/// Whether a string literal starts here: `"`, or `#`s and then `"`.
fn starts_literal(chars: &[char]) -> bool {
    chars.iter().find(|c| **c != '#') == Some(&'"')
}

/// Just past the string literal starting at `start`: single-line, multiline
/// or raw (`#"…"#`, whose escapes need as many `#`).
fn literal_end(chars: &[char], start: usize) -> usize {
    let hashes = chars[start..].iter().take_while(|c| **c == '#').count();
    let open = start + hashes;
    let quotes = if chars[open..].starts_with(&['"', '"', '"']) { 3 } else { 1 };
    let mut at = open + quotes;
    while at < chars.len() {
        let after = chars.get(at + quotes..).unwrap_or_default();
        let closes = chars[at..].iter().take(quotes).filter(|c| **c == '"').count() == quotes
            && after.iter().take(hashes).filter(|c| **c == '#').count() == hashes;
        if closes {
            return (at + quotes + hashes).min(chars.len());
        }
        let escapes = chars[at] == '\\' && chars[at + 1..].iter().take(hashes).filter(|c| **c == '#').count() == hashes;
        at += if escapes { 2 + hashes } else { 1 };
    }
    chars.len()
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
        let tricky = declaration(&[
            ("keyword", "func"),
            ("text", " "),
            ("identifier", "f"),
            ("text", "(message: "),
            ("typeIdentifier", "String"),
            ("text", " = \"a, (b) = ...\", raw: "),
            ("typeIdentifier", "String"),
            ("text", " = #\"x\\\"y\"#, count: "),
            ("typeIdentifier", "Int"),
            ("text", " = 0)"),
        ]);
        let shown = parameters(&tricky);
        assert_eq!(shown.len(), 3);
        assert_eq!(
            shown[0],
            Shown {
                default: Some("\"a, (b) = ...\"".into()),
                variadic: false,
                inout: false
            }
        );
        assert_eq!(shown[1].default.as_deref(), Some("#\"x\\\"y\"#"));
        assert_eq!(shown[2].default.as_deref(), Some("0"));
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
