//! Django's model registry.

use std::fs;

use serde_json::{Value, json};

use crate::common::{Scratch, canonical, collect, compare, copy, definition, fixtures, items, modified_entities, selected, tool};

#[test]
fn native_django_registry_includes_implicit_objects_stable_moves_and_meaningful_changes() {
    if !selected(&["PROJECTIONS_NATIVE_TESTS"]) && std::env::var("PROJECTIONS_DJANGO_PYTHON").is_err() {
        return;
    }
    let python = tool("PROJECTIONS_DJANGO_PYTHON", "python3");
    let scratch = Scratch::new();
    let root = &scratch.0;
    copy(&fixtures("django-schema").join("django"), root, &["__pycache__"]);
    let input = json!({"settings":"settings","python":python});
    let collect = |inputs: &Value| collect(root, &definition("django-schema", inputs.clone(), json!({})), true);
    let before = collect(&input).unwrap();
    let node = |state: &Value, predicate: &dyn Fn(&Value) -> bool| items(state, "entities").iter().any(predicate);
    assert!(node(&before, &|n| n["label"] == "posts_tags" && n["data"]["autoCreated"] == true));
    assert!(node(&before, &|n| n["label"] == "posts_author_title" && n["data"]["type"] == "unique"));
    assert!(node(&before, &|n| n["label"] == "posts_positive_rating" && n["data"]["type"] == "check"));
    assert!(node(&before, &|n| n["kind"] == "column"
        && n["label"] == "id"
        && n["data"]["autoCreated"] == true));
    assert_eq!(
        items(&before, "entities")
            .iter()
            .find(|n| n["kind"] == "column" && n["label"] == "title")
            .unwrap()["data"]["default"],
        json!({"callable":"schemaapp.defaults.default_title"})
    );
    let models = root.join("schemaapp/models.py");
    let entities = root.join("schemaapp/entities.py");
    fs::rename(&models, &entities).unwrap();
    fs::write(&models, "from .entities import *\n").unwrap();
    let source = fs::read_to_string(&entities).unwrap();
    fs::write(&entities, format!("# Moved model declarations\n\n{source}")).unwrap();
    assert_eq!(canonical(&before), canonical(&collect(&input).unwrap()));
    let source = fs::read_to_string(&entities).unwrap();
    fs::write(
        &entities,
        source.replace("email =", "contact =").replace("\"email\"]", "\"contact\"]"),
    )
    .unwrap();
    assert_eq!(canonical(&before), canonical(&collect(&input).unwrap()));
    fs::write(&entities, source.replace("max_length=160", "max_length=240")).unwrap();
    let after = collect(&input).unwrap();
    let changed = compare(&before, &after);
    assert!(modified_entities(&changed, &after).iter().any(|n| n["label"] == "email_address"));
    fs::write(
        &entities,
        format!("{source}\nfrom django.db import connection\nconnection.cursor()\n"),
    )
    .unwrap();
    let error = collect(&input).unwrap_err();
    assert!(format!("{error:#}").contains("forbids database access"), "{error:#}");
    let mut wrong = input.clone();
    wrong["settings"] = json!("not_real_settings");
    let error = collect(&wrong).unwrap_err();
    assert!(format!("{error:#}").contains("not_real_settings"), "{error:#}");
}
