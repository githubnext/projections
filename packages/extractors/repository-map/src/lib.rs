//! Tracked and untracked nonignored file hierarchy, with each file's size.

use anyhow::{Result, ensure};
use projections_extractor_sdk::{Context, Descriptor, Trust, basename, extraction, globs, parent, relative_path};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub const ID: &str = "repository-map";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Repository map",
        description: "Tracked and untracked nonignored file hierarchy",
        schema: "graph/v0",
        renderer: "file-packing",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({"include":"Array of globs to map; default every file","exclude":"Array of globs to skip","lines":"Boolean; also count the lines of each text file (default false)"}),
        template_inputs: None,
        detects: &["*", "**/*"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (files, definition) = (cx.files()?, cx.definition());
    let include = globs(definition["inputs"].get("include"), "inputs.include")?;
    let exclude = globs(definition["inputs"].get("exclude"), "inputs.exclude")?;
    let lines = match definition["inputs"].get("lines") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(_) => anyhow::bail!("inputs.lines must be a boolean"),
    };
    let mut nodes = vec![json!({"id":"directory:.","kind":"directory","label":"."})];
    let mut edges = vec![];
    let mut directories = BTreeSet::from([".".to_owned()]);
    fn add_directory(directory: &str, directories: &mut BTreeSet<String>, nodes: &mut Vec<Value>, edges: &mut Vec<Value>) {
        if directories.contains(directory) {
            return;
        }
        let p = parent(directory);
        add_directory(p, directories, nodes, edges);
        directories.insert(directory.to_owned());
        nodes.push(json!({"id":format!("directory:{directory}"),"kind":"directory","label":basename(directory),"data":{"path":directory}}));
        edges.push(json!({"id":format!("contains:directory:{directory}"),"from":format!("directory:{p}"),"to":format!("directory:{directory}"),"kind":"contains"}));
    }
    for file in files {
        if file.split('/').any(|s| s == ".git")
            || (!include.is_empty() && !include.iter().any(|g| g.is_match(file)))
            || exclude.iter().any(|g| g.is_match(file))
        {
            continue;
        }
        relative_path(file)?;
        let Ok(entry) = cx.entry(file) else {
            continue;
        };
        let symlink = entry.symlink;
        // The size of the revision's blob (a symlink's is its target path).
        let mut data = json!({"path":file,"size":entry.size});
        if lines && !symlink {
            if let Some(count) = line_count(&cx.read_bytes(file, 256 * 1024 * 1024)?) {
                data["lines"] = json!(count);
            }
        }
        let p = parent(file);
        add_directory(p, &mut directories, &mut nodes, &mut edges);
        nodes.push(json!({"id":format!("file:{file}"),"kind":if symlink {"symlink"} else {"file"},
            "label":basename(file),"data":data,"evidence":[{"kind":"file","source":file}]}));
        edges.push(
            json!({"id":format!("contains:file:{file}"),"from":format!("directory:{p}"),"to":format!("file:{file}"),"kind":"contains"}),
        );
        ensure!(
            nodes.len() <= 10_000,
            "repository-map exceeds the 10,000-node state limit; narrow it with inputs.include or inputs.exclude globs"
        );
    }
    Ok(extraction("graph/v0", nodes, edges, None))
}

/// Lines in a text file: newline-terminated lines plus a final unterminated one.
/// `None` for binary content (a NUL byte in its first 8,000 bytes, as Git decides).
fn line_count(bytes: &[u8]) -> Option<u64> {
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return None;
    }
    let newlines = bytes.iter().filter(|byte| **byte == b'\n').count() as u64;
    Some(newlines + u64::from(bytes.last().is_some_and(|byte| *byte != b'\n')))
}

#[cfg(test)]
mod tests {
    use super::line_count;

    #[test]
    fn counts_terminated_and_unterminated_lines_and_skips_binary() {
        assert_eq!(line_count(b""), Some(0));
        assert_eq!(line_count(b"one\ntwo\n"), Some(2));
        assert_eq!(line_count(b"one\ntwo"), Some(2));
        assert_eq!(line_count(b"\n\n"), Some(2));
        assert_eq!(line_count(b"a\0b\n"), None);
    }
}
