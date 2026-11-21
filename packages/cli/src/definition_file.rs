//! Saving a projection's parts to its definition file: the Inspector's
//! **Save to definition**. Only the `extractor`, `comparator` and `renderer`
//! fields change; the rest of the file keeps its content, its indentation and
//! the order of its fields. The result must be a valid definition of the same projection, and a
//! write only happens when the file still holds what the preview showed.

use crate::{artifact, json_text, runtime::read_regular};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const PARTS: [&str; 3] = ["extractor", "comparator", "renderer"];

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

/// The working tree file that defines `id`.
fn find(root: &Path, id: &str) -> Result<PathBuf> {
    for directory in crate::project::directories() {
        let Ok(entries) = std::fs::read_dir(root.join(directory)) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect();
        paths.sort();
        for path in paths {
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let Ok(bytes) = read_regular(&path, 1024 * 1024) else {
                continue;
            };
            if serde_json::from_slice::<Value>(&bytes).is_ok_and(|value| value["id"] == id) {
                return Ok(path);
            }
        }
    }
    let [github, dot] = crate::project::directories();
    bail!("The working tree defines no projection {id} in a file under {github} or {dot}")
}

/// What saving `parts` (each a new value, or `null` to remove an optional
/// part) to the projection's definition would write, and, unless `dry_run`,
/// writes it when the file's digest is still `expected` (when given).
/// Returns `{"path", "before", "after", "digest", "changed", "written"}`;
/// `digest` is the file's digest before the write.
pub fn save(root: &Path, id: &str, parts: &Value, expected: Option<&str>, dry_run: bool) -> Result<Value> {
    let parts = parts.as_object().context("parts must be an object")?;
    ensure!(!parts.is_empty(), "parts names no part to save");
    for name in parts.keys() {
        ensure!(
            PARTS.contains(&name.as_str()),
            "Only a definition's parts (extractor, comparator, renderer) can be saved, not {name}"
        );
    }
    let path = find(root, id)?;
    let bytes = read_regular(&path, 1024 * 1024)?;
    let before = String::from_utf8(bytes.clone()).context("The definition file is not UTF-8")?;
    let current = digest(&bytes);
    let mut object = serde_json::from_str::<Value>(&before)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .context("The definition file is not a JSON object")?;
    for (name, value) in parts {
        if value.is_null() {
            object.remove(name);
        } else {
            object.insert(name.clone(), value.clone());
        }
    }
    let object = Value::Object(object);
    let definition = artifact::validate_definition(&object).context("The saved definition would be invalid")?;
    ensure!(definition["id"] == id, "Saving parts cannot change the projection's ID");
    let after = json_text::render(&object, Some(&before), &json_text::DEFINITION_ORDER)?;
    let unchanged = serde_json::from_str::<Value>(&before).ok() == serde_json::from_str::<Value>(&after).ok();
    let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
    let mut result = json!({
        "path": relative, "before": before, "after": if unchanged { before.clone() } else { after.clone() },
        "digest": current, "changed": !unchanged, "written": false,
    });
    if dry_run || unchanged {
        return Ok(result);
    }
    if let Some(expected) = expected {
        ensure!(
            expected == current,
            "{relative} changed since the preview; review the new difference before saving"
        );
    }
    let directory = path.parent().context("The definition file has no directory")?;
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    std::io::Write::write_all(&mut file, after.as_bytes())?;
    crate::replace::replace(file, &path)?;
    result["written"] = json!(true);
    Ok(result)
}

/// The precondition failure `save` reports, for a `409` response.
pub fn is_conflict(error: &anyhow::Error) -> bool {
    error.to_string().contains("changed since the preview")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_a_part_keeps_the_other_fields_in_order() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(".github/projections")).unwrap();
        let file = root.path().join(".github/projections/map.json");
        let original = "{\n  \"title\": \"Map\",\n  \"id\": \"map\",\n  \"renderer\": \"graph\",\n  \"extractor\": {\"command\": [\"node\", \"x.mjs\"]}\n}\n";
        std::fs::write(&file, original).unwrap();
        let preview = save(root.path(), "map", &json!({"renderer": "dag"}), None, true).unwrap();
        assert_eq!(preview["written"], false);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), original);
        let after = preview["after"].as_str().unwrap();
        assert!(after.find("\"title\"").unwrap() < after.find("\"id\"").unwrap(), "{after}");
        assert!(after.contains("\"renderer\": \"dag\""), "{after}");
        // A stale preview is refused; the right one writes exactly the preview.
        let stale = save(root.path(), "map", &json!({"renderer": "dag"}), Some("sha256:00"), false).unwrap_err();
        assert!(is_conflict(&stale));
        let digest = preview["digest"].as_str().unwrap();
        let saved = save(root.path(), "map", &json!({"renderer": "dag"}), Some(digest), false).unwrap();
        assert_eq!(saved["written"], true);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), after);
        // A file indented by four spaces stays so; a minified one is pretty-printed.
        let four = "{\n    \"id\": \"map\",\n    \"renderer\": \"graph\",\n    \"extractor\": {\n        \"command\": [\"node\", \"x.mjs\"]\n    }\n}\n";
        std::fs::write(&file, four).unwrap();
        let saved = save(root.path(), "map", &json!({"renderer": "dag"}), None, false).unwrap();
        assert_eq!(saved["written"], true);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "{\n    \"id\": \"map\",\n    \"renderer\": \"dag\",\n    \"extractor\": {\n        \"command\": [\n            \"node\",\n            \"x.mjs\"\n        ]\n    }\n}\n"
        );
        std::fs::write(
            &file,
            r#"{"title":"Map","id":"map","renderer":"graph","extractor":"repository-map"}"#,
        )
        .unwrap();
        save(root.path(), "map", &json!({"renderer": "dag"}), None, false).unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "{\n  \"title\": \"Map\",\n  \"id\": \"map\",\n  \"renderer\": \"dag\",\n  \"extractor\": \"repository-map\"\n}\n"
        );
        // Only parts, and only valid results.
        assert!(save(root.path(), "map", &json!({"id": "other"}), None, true).is_err());
        assert!(save(root.path(), "map", &json!({"extractor": null}), None, true).is_err());
        assert!(save(root.path(), "absent", &json!({"renderer": "dag"}), None, true).is_err());
    }
}
