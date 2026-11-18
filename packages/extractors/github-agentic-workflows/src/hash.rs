//! The hashes gh-aw records in a compiled lock file's `gh-aw-metadata`
//! header, recomputed from the workflow's source as gh-aw v1.3.0 computes
//! them (`pkg/parser/frontmatter_hash.go`): `frontmatter_hash` over the front
//! matter text, its imports' front matter and the body's template expressions,
//! and `body_hash` over the body and its imports' bodies.

use crate::document::{Document, normalize, split};
use crate::paths::{dir, resolve_import, runtime_candidates};
use projections_extractor_sdk::{parse_yaml, sha256};
use regex::Regex;
use std::collections::BTreeSet;
use std::sync::LazyLock;

/// Reads a project-relative file, or `None` when the revision doesn't have it.
pub type Read<'a> = &'a dyn Fn(&str) -> Option<String>;

/// The most front matter, in bytes after normalization, gh-aw hashes.
const MAX_HASHED_BYTES: usize = 1 << 20;

/// The hashes of a workflow at `path`, or why they can't be computed (gh-aw
/// fails to compile it then too).
pub struct Hashes {
    pub frontmatter: String,
    pub body: String,
}

pub fn hashes(path: &str, document: &Document, inlined: bool, read: Read) -> Result<Hashes, String> {
    let base = dir(path);
    let expressions = if inlined {
        vec![]
    } else {
        let mut found = relevant_expressions(&document.body);
        found.extend(runtime_import_expressions(document, &base, read));
        found.into_iter().collect::<BTreeSet<_>>().into_iter().collect()
    };
    let mut visited = BTreeSet::new();
    let (imports, fronts) = imported_fronts(&document.front, &base, &base, &mut visited, read)?;
    let front = normalize(&document.front);
    let mut fronts: Vec<String> = fronts.iter().map(|text| normalize(text)).collect();
    if front.len() + fronts.iter().map(String::len).sum::<usize>() > MAX_HASHED_BYTES {
        return Err(format!(
            "its front matter and imports exceed the {MAX_HASHED_BYTES} bytes gh-aw hashes"
        ));
    }
    let mut canonical = String::from("{");
    let body = if inlined { normalize(&document.body) } else { String::new() };
    if !body.is_empty() {
        canonical.push_str(&format!("\"body-text\":{},", go_string(&body)));
    }
    canonical.push_str(&format!("\"frontmatter-text\":{}", go_string(&front)));
    if !fronts.is_empty() {
        fronts.sort();
        canonical.push_str(&format!(",\"imported-frontmatters\":{}", go_string(&fronts.join("\n---\n"))));
    }
    if !imports.is_empty() {
        let mut imports = imports;
        imports.sort();
        canonical.push_str(&format!(",\"imports\":{}", go_strings(&imports)));
    }
    if !inlined && !expressions.is_empty() {
        canonical.push_str(&format!(",\"template-expressions\":{}", go_strings(&expressions)));
    }
    canonical.push('}');
    Ok(Hashes {
        frontmatter: hex(&canonical),
        body: body_hash(document, &base, read)?,
    })
}

fn hex(text: &str) -> String {
    sha256(text).trim_start_matches("sha256:").to_owned()
}

fn body_hash(document: &Document, base: &str, read: Read) -> Result<String, String> {
    let mut bodies: Vec<String> = imported_bodies(&document.front, base, base, &mut BTreeSet::new(), read)?
        .iter()
        .map(|body| normalize(body))
        .collect();
    bodies.sort();
    let mut parts = vec![normalize(&document.body)];
    parts.extend(bodies);
    Ok(hex(&parts.join("\n---\n")))
}

/// Imports as gh-aw reads them for hashing, without parsing YAML
/// (`extractImportsFromText`): the items under the first `imports:` line, or
/// under its `aw:` key in the object form, with a `uses:` or `path:` prefix
/// and surrounding quotes removed.
pub fn imports_of(front: &str) -> Vec<String> {
    let indent = |line: &str| line.len() - line.trim_start_matches([' ', '\t']).len();
    let (mut inside, mut base, mut object, mut aw, mut aw_indent) = (false, 0, false, false, 0);
    let mut imports = Vec::new();
    for line in front.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with("imports:") {
            (inside, base, object, aw) = (true, indent(line), false, false);
            continue;
        }
        if !inside {
            continue;
        }
        let level = indent(line);
        if level <= base {
            break;
        }
        if level == base + 2 && trimmed.starts_with("aw:") {
            (object, aw, aw_indent) = (true, true, level);
            continue;
        }
        if object && level == base + 2 && trimmed.contains(':') && !trimmed.starts_with('-') {
            aw = false;
            continue;
        }
        let Some(item) = trimmed.strip_prefix('-') else { continue };
        if object && (!aw || level <= aw_indent) {
            continue;
        }
        let item = item.trim();
        let item = item
            .strip_prefix("uses:")
            .or_else(|| item.strip_prefix("path:"))
            .map_or(item, str::trim);
        let item = item.trim_matches(['"', '\'']);
        if !item.is_empty() {
            imports.push(item.to_owned());
        }
    }
    imports
}

/// Each import resolved, visited once, depth first in sorted order, with
/// what `visit` makes of its document; a missing or unclosed file is skipped.
fn walk<T>(
    front: &str,
    base: &str,
    root: &str,
    visited: &mut BTreeSet<String>,
    read: Read,
    visit: &mut dyn FnMut(&str, &Document, &mut Vec<T>),
) -> Result<Vec<T>, String> {
    let mut imports = imports_of(front);
    imports.sort();
    let mut found = Vec::new();
    for import in imports {
        let full = resolve_import(&import, base, root)?;
        if !visited.insert(full.clone()) {
            continue;
        }
        let Some(document) = read(&full).and_then(|content| split(&content).ok()) else {
            continue;
        };
        visit(&import, &document, &mut found);
        found.extend(walk(&document.front, &dir(&full), root, visited, read, visit)?);
    }
    Ok(found)
}

type Imported = (Vec<String>, Vec<String>);

fn imported_fronts(front: &str, base: &str, root: &str, visited: &mut BTreeSet<String>, read: Read) -> Result<Imported, String> {
    let found = walk(
        front,
        base,
        root,
        visited,
        read,
        &mut |import, document, found: &mut Vec<(String, String)>| {
            found.push((import.to_owned(), document.front.clone()));
        },
    )?;
    Ok(found.into_iter().unzip())
}

fn imported_bodies(front: &str, base: &str, root: &str, visited: &mut BTreeSet<String>, read: Read) -> Result<Vec<String>, String> {
    walk(front, base, root, visited, read, &mut |_, document, found: &mut Vec<String>| {
        found.push(document.body.clone());
    })
}

/// `${{ … }}` spans as gh-aw's quote-aware scanner finds them (single quotes
/// open a string, `''` escapes one, `}}` closes only outside a string), as
/// (whole span, content).
fn expressions(text: &str) -> Vec<(&str, &str)> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut offset = 0;
    while let Some(start) = text[offset..].find("${{").map(|index| index + offset) {
        let (mut index, mut quoted, mut end) = (start + 3, false, None);
        while index < bytes.len() {
            if bytes[index] == b'\'' {
                if quoted && bytes.get(index + 1) == Some(&b'\'') {
                    index += 2;
                    continue;
                }
                quoted = !quoted;
            } else if !quoted && bytes[index] == b'}' && bytes.get(index + 1) == Some(&b'}') {
                end = Some(index);
                break;
            }
            index += 1;
        }
        match end {
            Some(end) => {
                found.push((&text[start..end + 2], &text[start + 3..end]));
                offset = end + 2;
            }
            None => offset = start + 3,
        }
    }
    found
}

/// The body's expressions that read `env.` or `vars.`.
fn relevant_expressions(body: &str) -> BTreeSet<String> {
    expressions(body)
        .into_iter()
        .filter(|(_, content)| content.contains("env.") || content.contains("vars."))
        .map(|(span, _)| span.to_owned())
        .collect()
}

fn all_expressions(body: &str) -> BTreeSet<String> {
    expressions(body)
        .into_iter()
        .filter(|(_, content)| !content.trim().is_empty())
        .map(|(span, _)| span.to_owned())
        .collect()
}

static RUNTIME_IMPORT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{#(?:runtime-import|import)\??(?:[ \t]+|[ \t]*:[ \t]*)([^{}]+?)\}\}").unwrap());
static LINE_RANGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?):(\d+)-(\d+)$").unwrap());

/// gh-aw's `collectRuntimeImportTemplateExpressions`: every expression of the
/// files the body runtime-imports, and of the bodies its imports bring in.
fn runtime_import_expressions(document: &Document, base: &str, read: Read) -> BTreeSet<String> {
    let mut seen = BTreeSet::new();
    let mut found = runtime_imported(&document.body, base, &mut seen, read);
    let Ok(bodies) = imported_bodies(&document.front, base, base, &mut BTreeSet::new(), read) else {
        return found;
    };
    for body in bodies {
        found.extend(all_expressions(&body));
        found.extend(runtime_imported(&body, base, &mut seen, read));
    }
    found
}

fn runtime_imported(body: &str, base: &str, seen: &mut BTreeSet<String>, read: Read) -> BTreeSet<String> {
    let mut references: Vec<(String, usize, usize)> = Vec::new();
    for capture in RUNTIME_IMPORT.captures_iter(body) {
        let target = capture[1].trim();
        let (path, start, end) = match LINE_RANGE.captures(target) {
            Some(range) => (
                range[1].trim().to_owned(),
                range[2].parse().unwrap_or(0),
                range[3].parse().unwrap_or(0),
            ),
            None => (target.to_owned(), 0, 0),
        };
        if target.is_empty() || path.starts_with("http://") || path.starts_with("https://") {
            continue;
        }
        if !references.contains(&(path.clone(), start, end)) {
            references.push((path, start, end));
        }
    }
    let mut found = BTreeSet::new();
    for (path, start, end) in references {
        if let Some(content) = runtime_body(&path, start, end, base, seen, read) {
            found.extend(all_expressions(&content));
            found.extend(runtime_imported(&content, base, seen, read));
        }
    }
    found
}

fn runtime_body(path: &str, start: usize, end: usize, base: &str, seen: &mut BTreeSet<String>, read: Read) -> Option<String> {
    for candidate in runtime_candidates(path, base) {
        let key = format!("{candidate}:{start}-{end}");
        if seen.contains(&key) {
            return None;
        }
        let Some(content) = read(&candidate) else { continue };
        seen.insert(key);
        let content = if start > 0 || end > 0 {
            line_range(&content, start, end)
        } else {
            content
        };
        // gh-aw drops front matter it can parse, and keeps the file whole otherwise.
        return Some(match split(&content) {
            Ok(document) if document.has_front && parse_yaml(&document.front, path).is_ok() => document.body,
            _ => content,
        });
    }
    None
}

fn line_range(content: &str, start: usize, end: usize) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    let start = start.max(1);
    let end = if end == 0 || end > lines.len() { lines.len() } else { end };
    if start > end || start > lines.len() {
        return String::new();
    }
    lines[start - 1..end].join("\n")
}

/// A JSON string as Go's `encoding/json` writes it without HTML escaping.
fn go_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            control if (control as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", control as u32)),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

fn go_strings(items: &[String]) -> String {
    format!("[{}]", items.iter().map(|item| go_string(item)).collect::<Vec<_>>().join(","))
}

#[cfg(test)]
mod tests;
