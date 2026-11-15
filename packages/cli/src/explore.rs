//! `projections explore`: which projections apply to this repository, found
//! from the files it holds and offered as trial definitions without writing
//! anything. Each built-in extractor's descriptor declares the files that
//! mean it may apply (`detects`); a candidate says which pattern matched and
//! the first matching files.

use crate::{collectors, runtime::Runner};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::path::Path;

mod vendored;

/// Files listed at most, so discovery stays bounded in very large checkouts.
const MAX_FILES: usize = 200_000;
/// Matching files named in a candidate's basis.
const EXAMPLES: usize = 3;
/// Per-file candidates of one extractor the text lists before summarizing the rest.
const PER_FILE_SHOWN: usize = 5;
/// Directories whose files never propose a projection: tests, fixtures,
/// examples and vendored code describe other systems, and Projections' own
/// files describe projections.
const IGNORED: [&str; 10] = [
    "test",
    "tests",
    "__tests__",
    "testdata",
    "fixtures",
    "examples",
    "vendor",
    "node_modules",
    "third_party",
    ".github/projections",
];

fn ignored(path: &str) -> bool {
    IGNORED
        .iter()
        .any(|directory| path.starts_with(&format!("{directory}/")) || path.contains(&format!("/{directory}/")))
}

/// A glob over repository-relative `/` paths: `**/` any directories (or
/// none), `*` any characters within one segment, `?` one.
fn glob(pattern: &str) -> Result<regex::Regex> {
    let mut expression = String::from("^");
    let mut rest = pattern;
    while !rest.is_empty() {
        if let Some(tail) = rest.strip_prefix("**/") {
            expression.push_str("(?:.*/)?");
            rest = tail;
        } else if let Some(tail) = rest.strip_prefix("**") {
            expression.push_str(".*");
            rest = tail;
        } else {
            let character = rest.chars().next().unwrap();
            match character {
                '*' => expression.push_str("[^/]*"),
                '?' => expression.push_str("[^/]"),
                other => expression.push_str(&regex::escape(&other.to_string())),
            }
            rest = &rest[character.len_utf8()..];
        }
    }
    expression.push('$');
    regex::Regex::new(&expression).with_context(|| format!("Invalid detection pattern {pattern}"))
}

/// Files Git tracks or would track in the working tree, sorted.
fn files(runner: &Runner, root: &Path) -> Result<Vec<String>> {
    let listed = runner.git(
        root,
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        None,
        64 * 1024 * 1024,
    )?;
    let mut files: Vec<String> = listed
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .take(MAX_FILES)
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .filter(|path| !ignored(path))
        // A nested project proposes from its own files.
        .filter(|path| crate::project::prefix().is_empty() || path.starts_with(&format!("{}/", crate::project::prefix())))
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

/// Whether the patterns match any file: everything in the repository (`*`, `**/*`).
fn generic(patterns: &[Value]) -> bool {
    patterns.iter().all(|pattern| pattern == "*" || pattern == "**/*")
}

/// The candidates for the project in the repository at `root`, its paths
/// relative to the project: one per built-in extractor
/// whose detection patterns match (or, for one that reads a single file of
/// several, one per matching file), specific ones first. Files
/// `.gitattributes` marks vendored or generated propose nothing, and a
/// candidate of the whole repository excludes them. A candidate whose
/// extractor or ID an authored definition already uses is marked `adopted`.
pub fn candidates(runner: &Runner, root: &Path) -> Result<Vec<Value>> {
    let listed = files(runner, root)?;
    let marked = vendored::marked(runner, root, &listed)?;
    // A nested project's definitions name its files relative to it.
    let project = |path: &String| match crate::project::prefix() {
        "" => path.clone(),
        prefix => path.strip_prefix(&format!("{prefix}/")).unwrap_or(path).to_owned(),
    };
    let listed: Vec<String> = listed.iter().map(project).collect();
    let marked: std::collections::BTreeSet<String> = marked.iter().map(project).collect();
    let exclusions = vendored::exclusions(&listed, &marked);
    let files: Vec<String> = listed.into_iter().filter(|file| !marked.contains(file)).collect();
    // Only what the repository defines, never a session's trials.
    let authored = runner.without_trials().discover("working-tree").unwrap_or_default();
    let authored: Vec<&Value> = authored.iter().filter(|_| crate::workspace::authored(root)).collect();
    let mut specific = Vec::new();
    let mut general = Vec::new();
    for descriptor in collectors::catalog()["extractors"].as_array().into_iter().flatten() {
        let patterns = descriptor["detects"].as_array().cloned().unwrap_or_default();
        if patterns.is_empty() {
            continue;
        }
        let matchers = patterns
            .iter()
            .map(|pattern| Ok((pattern.as_str().unwrap_or_default(), glob(pattern.as_str().unwrap_or_default())?)))
            .collect::<Result<Vec<_>>>()?;
        // Every file any pattern matches, each under the first pattern that matched.
        let matched: Vec<(&str, &String)> = files
            .iter()
            .filter_map(|file| {
                matchers
                    .iter()
                    .find(|(_, matcher)| matcher.is_match(file))
                    .map(|(pattern, _)| (*pattern, file))
            })
            .collect();
        let Some((pattern, _)) = matched.first() else {
            continue;
        };
        let id = descriptor["id"].as_str().unwrap_or_default();
        if let Some(input) = collectors::per_file_input(id) {
            specific.extend(per_file(descriptor, input, &matched, &authored));
            continue;
        }
        let mut basis = json!({
            "pattern": pattern,
            "count": matched.len(),
            "examples": matched.iter().take(EXAMPLES).map(|(_, file)| file).collect::<Vec<_>>(),
        });
        let mut definition = descriptor["template"].clone();
        if generic(&patterns) && !marked.is_empty() {
            basis["skipped"] = json!(marked.len());
            if descriptor["inputs"].get("exclude").is_some() && !exclusions.is_empty() {
                definition["inputs"]["exclude"] = json!(exclusions);
            }
        }
        let adopted = authored
            .iter()
            .find(|item| item["extractor"] == id || item["id"] == id)
            .and_then(|item| item["id"].as_str());
        let candidate = candidate(descriptor, id, basis, adopted, definition);
        if generic(&patterns) {
            general.push(candidate);
        } else {
            specific.push(candidate);
        }
    }
    specific.extend(general);
    Ok(specific)
}

fn candidate(descriptor: &Value, id: &str, basis: Value, adopted: Option<&str>, definition: Value) -> Value {
    json!({
        "id": id,
        "title": definition.get("title").unwrap_or(&descriptor["title"]),
        "description": descriptor["description"],
        "extractor": descriptor["id"],
        "schema": descriptor["schema"],
        "renderer": descriptor["renderer"],
        "requiresTrust": collectors::requires_trust(&definition),
        "basis": basis,
        "adopted": adopted,
        "definition": definition,
    })
}

/// One candidate per matched file for an extractor that reads one file named
/// by `input`: `<extractor>-<file stem>`, with the input set to the file.
fn per_file(descriptor: &Value, input: &str, matched: &[(&str, &String)], authored: &[&Value]) -> Vec<Value> {
    let extractor = descriptor["id"].as_str().unwrap_or_default();
    let mut seen = std::collections::BTreeSet::new();
    matched
        .iter()
        .map(|(pattern, file)| {
            let name = file.rsplit('/').next().unwrap_or(file);
            let stem = name.split_once('.').map_or(name, |(stem, _)| stem);
            let mut id = format!("{extractor}-{}", slug(stem));
            if !seen.insert(id.clone()) {
                id = format!("{extractor}-{}", slug(name));
            }
            let mut definition = descriptor["template"].clone();
            definition["id"] = json!(id);
            definition["title"] = json!(format!("{}: {name}", descriptor["title"].as_str().unwrap_or(extractor)));
            definition["inputs"] = json!({input: file});
            let adopted = authored
                .iter()
                .find(|item| item["id"] == id.as_str() || (item["extractor"] == extractor && item["inputs"][input] == file.as_str()))
                .and_then(|item| item["id"].as_str());
            let basis = json!({"pattern": pattern, "count": 1, "examples": [file], "file": file});
            candidate(descriptor, &id, basis, adopted, definition)
        })
        .collect()
}

/// A projection ID segment for a name: lowercase letters, digits and `-`.
fn slug(name: &str) -> String {
    let slug: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect();
    let slug = slug.trim_matches('-');
    if slug.is_empty() { "file".to_owned() } else { slug.to_owned() }
}

/// A candidate's basis in words: "found `packages/a/package.json` and 3 more".
pub fn basis_text(candidate: &Value) -> String {
    let basis = &candidate["basis"];
    let count = basis["count"].as_u64().unwrap_or(0);
    let examples: Vec<&str> = basis["examples"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if basis["pattern"] == "*" || basis["pattern"] == "**/*" {
        return match basis["skipped"].as_u64() {
            Some(skipped) => format!("{count} files in the repository, skipping {skipped} vendored or generated"),
            None => format!("{count} files in the repository"),
        };
    }
    let first = examples.first().copied().unwrap_or_default();
    match count {
        0 | 1 => format!("found `{first}`"),
        _ => format!(
            "found `{first}` and {} more matching `{}`",
            count - 1,
            basis["pattern"].as_str().unwrap_or_default()
        ),
    }
}

/// The candidates as text, for the terminal.
pub fn text(candidates: &[Value]) -> String {
    if candidates.is_empty() {
        return "No built-in projection applies to this repository. Build one for it: projections init <id> (projections help authoring).\n".to_owned();
    }
    let width = candidates
        .iter()
        .filter_map(|candidate| candidate["id"].as_str())
        .map(str::len)
        .max()
        .unwrap_or(0);
    let mut text = String::from("Projections that apply to this repository:\n");
    // Per-file candidates beyond the first few, by extractor.
    let mut shown = std::collections::BTreeMap::<&str, usize>::new();
    let mut hidden = std::collections::BTreeMap::<&str, usize>::new();
    for candidate in candidates {
        if candidate["basis"]["file"].is_string() {
            let extractor = candidate["extractor"].as_str().unwrap_or_default();
            let count = shown.entry(extractor).or_default();
            *count += 1;
            if *count > PER_FILE_SHOWN {
                *hidden.entry(extractor).or_default() += 1;
                continue;
            }
        }
        let mut notes = Vec::new();
        if let Some(adopted) = candidate["adopted"].as_str() {
            notes.push(format!("adopted as {adopted}"));
        }
        if candidate["requiresTrust"] == true {
            notes.push("runs repository code: --trust".to_owned());
        }
        text.push_str(&format!(
            "  {:width$}  {}: {}{}\n",
            candidate["id"].as_str().unwrap_or_default(),
            candidate["title"].as_str().unwrap_or_default(),
            basis_text(candidate),
            if notes.is_empty() {
                String::new()
            } else {
                format!(" ({})", notes.join("; "))
            },
        ));
    }
    for (extractor, count) in hidden {
        text.push_str(&format!(
            "  …and {count} more {extractor} candidates, one per file: projections explore --list --json lists them\n"
        ));
    }
    text.push_str("\nTry them on recent changes: projections explore --sweep. Keep the useful ones: projections adopt <id>...\n");
    text
}

/// The trial definitions for `candidates` that aren't adopted yet.
pub fn trials(candidates: &[Value]) -> Vec<Value> {
    candidates
        .iter()
        .filter(|candidate| candidate["adopted"].is_null())
        .map(|candidate| candidate["definition"].clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tests_fixtures_and_projections_files_are_ignored() {
        assert!(ignored("tests/fixtures/main.tf"));
        assert!(ignored("crates/x/tests/main.tf"));
        assert!(ignored(".github/projections/map/renderer/tsconfig.json"));
        assert!(!ignored("infra/main.tf"));
        assert!(!ignored("contest/main.tf"));
    }

    #[test]
    fn globs_match_segments_and_any_depth() {
        let any = glob("**/*.prisma").unwrap();
        assert!(any.is_match("schema.prisma"));
        assert!(any.is_match("db/prisma/schema.prisma"));
        assert!(!any.is_match("schema.prisma.bak"));
        let workflows = glob(".github/workflows/*.yml").unwrap();
        assert!(workflows.is_match(".github/workflows/ci.yml"));
        assert!(!workflows.is_match(".github/workflows/nested/ci.yml"));
        assert!(glob("package.json").unwrap().is_match("package.json"));
        assert!(!glob("package.json").unwrap().is_match("packages/a/package.json"));
    }
}
