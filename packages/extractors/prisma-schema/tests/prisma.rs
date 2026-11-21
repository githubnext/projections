//! The Prisma parser against fixture schemas.
//!
//! `tests/fixtures/expected` holds the `database/v0` extractions the previous
//! extractor produced for each fixture by driving Prisma 6.19.3's own schema engine
//! (`get_dmmf`), so these tests check that the native parser preserves Prisma's
//! semantics, not merely its own earlier output. `expected/views.json` departs from
//! it deliberately: views are `view` entities, and an enum in a multiSchema
//! database schema is identified within that schema.

use anyhow::Result;
use projections_extractor_prisma_schema::{collect, database_type, extract};
use projections_extractor_sdk::testing;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn source(relative: &str) -> (String, String) {
    (relative.to_owned(), fs::read_to_string(fixtures().join(relative)).unwrap())
}

fn sources(files: &[&str]) -> Vec<(String, String)> {
    files.iter().map(|f| source(f)).collect()
}

/// Each item's semantic content (without evidence), keyed by ID.
fn semantic(extraction: &Value) -> BTreeMap<String, Value> {
    let normalized = projections_engine::normalize(extraction, "").unwrap();
    projections_engine::COLLECTIONS
        .iter()
        .flat_map(|c| normalized[*c].as_array().unwrap().clone())
        .map(|item| (item["id"].as_str().unwrap().to_owned(), projections_engine::semantic(&item)))
        .collect()
}

fn digest(extraction: &Value) -> String {
    let normalized = projections_engine::normalize(extraction, "").unwrap();
    projections_engine::canonicalize(&normalized).unwrap().1
}

fn extracted(files: &[&str]) -> Value {
    extract(&sources(files)).unwrap()
}

fn error(files: &[(&str, &str)]) -> String {
    let sources: Vec<_> = files.iter().map(|(p, s)| ((*p).to_owned(), (*s).to_owned())).collect();
    format!("{:#}", extract(&sources).unwrap_err())
}

/// Labels of entities whose content differs between two extractions with the same ID.
fn modified(before: &Value, after: &Value) -> BTreeSet<String> {
    let (before, after) = (semantic(before), semantic(after));
    after
        .iter()
        .filter(|(id, item)| before.get(*id).is_some_and(|b| b != *item))
        .filter_map(|(_, item)| item["label"].as_str().map(str::to_owned))
        .collect()
}

#[test]
fn matches_prisma_schema_engine_semantics_for_every_fixture() {
    let cases: [(&str, &[&str]); 13] = [
        ("schema", &["schema.prisma"]),
        ("providers-postgresql", &["providers/postgresql.prisma"]),
        ("providers-mysql", &["providers/mysql.prisma"]),
        ("providers-sqlserver", &["providers/sqlserver.prisma"]),
        ("relations", &["cases/relations.prisma"]),
        ("self-relations", &["cases/self-relations.prisma"]),
        ("composite", &["cases/composite.prisma"]),
        ("views", &["cases/views.prisma"]),
        ("compound", &["cases/compound.prisma"]),
        ("defaults", &["cases/defaults.prisma"]),
        ("sqlserver-options", &["cases/sqlserver-options.prisma"]),
        ("mysql-options", &["cases/mysql-options.prisma"]),
        (
            "folder",
            &[
                "cases/folder/main.prisma",
                "cases/folder/sub/user.prisma",
                "cases/folder/post.prisma",
            ],
        ),
    ];
    for (name, files) in cases {
        let mut actual = extracted(files);
        // `databaseType` is Projections' spelling of the native type Prisma's engine
        // reports as `nativeType`; it is checked against that, then set aside.
        for entity in actual["entities"].as_array_mut().unwrap() {
            if entity["kind"] != "column" {
                continue;
            }
            let data = entity["data"].as_object_mut().unwrap();
            let expected = match &data["nativeType"] {
                Value::Array(native) => json!(database_type(
                    native[0].as_str().unwrap(),
                    &native[1]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|arg| arg.as_str().unwrap().to_owned())
                        .collect::<Vec<_>>()
                )),
                _ => Value::Null,
            };
            assert_eq!(data.remove("databaseType"), Some(expected), "{name}: {}", entity["id"]);
        }
        let expected: Value = serde_json::from_str(&fs::read_to_string(fixtures().join(format!("expected/{name}.json"))).unwrap()).unwrap();
        let (actual_items, expected_items) = (semantic(&actual), semantic(&expected));
        for (id, item) in &expected_items {
            assert_eq!(actual_items.get(id), Some(item), "{name}: {id}");
        }
        for id in actual_items.keys() {
            assert!(expected_items.contains_key(id), "{name}: unexpected {id}");
        }
        assert_eq!(digest(&actual), digest(&expected), "{name}");
    }
}

#[test]
fn evidence_names_each_items_file_and_line_and_metadata_states_the_authority() {
    let state = extracted(&["schema.prisma"]);
    let email = state["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["label"] == "email_address")
        .unwrap();
    assert_eq!(
        email["evidence"],
        json!([{"kind":"prisma-schema","source":"schema.prisma","location":{"line":14}}])
    );
    assert_eq!(state["metadata"]["framework"], "prisma");
    assert_eq!(state["metadata"]["sources"], json!(["schema.prisma"]));
    assert!(state["metadata"].get("frameworkVersion").is_none());
}

#[test]
fn file_moves_formatting_comments_and_mapped_renames_are_not_changes() {
    let (_, original) = source("schema.prisma");
    let before = extract(&[("schema.prisma".into(), original.clone())]).unwrap();
    let moved = extract(&[(
        "moved/models.prisma".into(),
        format!("// A comment\n\n{}\n", original.replace("  ", "    ")),
    )])
    .unwrap();
    assert_eq!(digest(&before), digest(&moved));
    // Keep the implicit relation name explicit while renaming the Prisma-only model name.
    let renamed = original
        .replace("User", "Account")
        .replace("email ", "contact ")
        .replace("[name(sort: Desc), email]", "[name(sort: Desc), contact]")
        .replace("tags  Tag[]", "tags  Tag[] @relation(\"TagToUser\")")
        .replace("users Account[]", "users Account[] @relation(\"TagToUser\")");
    let renamed = extract(&[("schema.prisma".into(), renamed)]).unwrap();
    assert_eq!(digest(&before), digest(&renamed));
    let changed = original.replace("VarChar(160)", "VarChar(240)").replace("sort: Desc", "sort: Asc");
    let after = extract(&[("schema.prisma".into(), changed)]).unwrap();
    let labels = modified(&before, &after);
    assert!(labels.contains("users_search"), "{labels:?}");
    assert!(labels.contains("email_address"), "{labels:?}");
}

#[test]
fn multi_file_schemas_equal_the_single_file_schema_in_any_order() {
    let (_, original) = source("schema.prisma");
    let boundary = original.find("model User").unwrap();
    let split = extract(&[
        ("models.prisma".into(), original[boundary..].to_owned()),
        ("base.prisma".into(), original[..boundary].to_owned()),
    ])
    .unwrap();
    assert_eq!(digest(&split), digest(&extracted(&["schema.prisma"])));
    let duplicate = error(&[
        ("a.prisma", "model A {\n  id Int @id\n}\n"),
        ("b.prisma", "model A {\n  id Int @id\n}\n"),
    ]);
    assert!(
        duplicate.contains("b.prisma:1") && duplicate.contains("already defined at a.prisma:1"),
        "{duplicate}"
    );
}

#[test]
fn connector_semantics_index_kinds_and_providers_are_semantic() {
    let mysql = extracted(&["providers/mysql.prisma"]);
    let (_, source) = source("providers/mysql.prisma");
    let after = extract(&[("schema.prisma".into(), source.replace("@@fulltext", "@@index"))]).unwrap();
    assert!(modified(&mysql, &after).contains("article_search"));

    let schema = |provider: &str| {
        format!(
            "generator custom {{\n  provider = \"not-an-executable\"\n}}\ndatasource db {{\n  provider = \"{provider}\"\n  url = env(\"PROJECTIONS_MISSING_DATABASE_URL\")\n}}\nmodel Item {{\n  id Int @id\n  name String\n  @@index([name])\n}}\n"
        )
    };
    let before = extract(&[("schema.prisma".into(), schema("postgresql"))]).unwrap();
    let after = extract(&[("schema.prisma".into(), schema("sqlite"))]).unwrap();
    assert!(modified(&before, &after).contains("Item"));
    assert!(!after.to_string().contains("PROJECTIONS_MISSING_DATABASE_URL"));
    let postgres = extract(&[("schema.prisma".into(), schema("postgres"))]).unwrap();
    assert_eq!(digest(&postgres), digest(&before));
    assert!(error(&[("schema.prisma", &schema("made-up-connector"))]).contains("unknown datasource provider"));
}

#[test]
fn self_relations_pair_the_opposite_field_regardless_of_declaration_order() {
    let schema = |order: [&str; 2]| format!("model Node {{\n  id Int @id\n  parentId Int?\n  {}\n  {}\n}}\n", order[0], order[1]);
    let children = "children Node[] @relation(\"Tree\")";
    let parent = "parent Node? @relation(\"Tree\", fields: [parentId], references: [id])";
    let first = extract(&[("schema.prisma".into(), schema([children, parent]))]).unwrap();
    let second = extract(&[("schema.prisma".into(), schema([parent, children]))]).unwrap();
    assert_eq!(digest(&first), digest(&second));
    assert!(
        !first["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["kind"] == "many-to-many")
    );
    let followers = "followers Node[] @relation(\"Follows\")";
    let following = "following Node[] @relation(\"Follows\")";
    let many = extract(&[("schema.prisma".into(), schema([followers, following]))]).unwrap();
    let edges: Vec<_> = many["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["kind"] == "many-to-many")
        .collect();
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0]["id"], "many-to-many:table%3A%2FNode/table%3A%2FNode/Follows");
}

#[test]
fn invalid_schemas_fail_with_locations_instead_of_guessing() {
    let cases: &[(&str, &str)] = &[
        ("model Nope { unknown syntax }", "schema.prisma:1"),
        ("model A {\n  id Int @id\n  b Missing\n}", "unknown type Missing"),
        ("model A {\n  id Int @id\n  id String\n}", "repeats field id"),
        ("model A {\n  id Int @id @primary\n}", "unknown or misplaced attribute @primary"),
        ("model A {\n  id Int @id @map(\"a\") @map(\"b\")\n}", "repeated"),
        ("model A {\n  id Int @id\n  @@index([missing])\n}", "unknown field A.missing"),
        ("model A {\n  id Int @id\n  @@index([id], name: \"a\", map: \"b\")\n}", "not both"),
        (
            "model A {\n  id Int @id\n  @@index([id], sorting: Desc)\n}",
            "no argument `sorting`",
        ),
        ("model A {\n  id Int\n}", "needs a unique criterion"),
        ("model A {\n  id Int @id\n  @@id([id])\n}", "more than one primary key"),
        ("model A {\n  id Int @id @default(\"x\")\n}", "requires a Int value"),
        ("model A {\n  id Int @id @default(seq())\n}", "unknown @default function seq()"),
        ("model A {\n  id DateTime @id @default(\"yesterday\")\n}", "RFC 3339"),
        ("enum E {\n  A\n  A\n}", "repeats value A"),
        (
            "enum E {\n  A\n}\nmodel M {\n  id Int @id\n  e E @default(B)\n}",
            "a value of enum E",
        ),
        (
            "datasource a {\n  provider = \"sqlite\"\n}\ndatasource b {\n  provider = \"sqlite\"\n}",
            "only one datasource",
        ),
        ("datasource a {\n  url = \"x\"\n}", "requires a provider"),
        ("model String {\n  id Int @id\n}", "reserved type name"),
        (
            "model A {\n  id Int @id\n  b B @relation(fields: [bId], references: [id])\n  bId Int\n}\nmodel B {\n  id Int @id\n}",
            "needs exactly two relation fields",
        ),
        (
            "model A {\n  id Int @id\n  b B @relation(fields: [missing], references: [id])\n}\nmodel B {\n  id Int @id\n  a A[]\n}",
            "references unknown field missing",
        ),
        (
            "model A {\n  id Int @id\n  b B @relation(fields: [id], references: [id, x])\n}\nmodel B {\n  id Int @id\n  a A[]\n}",
            "same number of fields and references",
        ),
        (
            "model A {\n  id Int @id\n  b B @relation(fields: [id], references: [id], onDelete: Explode)\n}\nmodel B {\n  id Int @id\n  a A[]\n}",
            "onDelete must be one of",
        ),
        (
            "type T {\n  a String\n}\nmodel A {\n  id Int @id\n  t T\n  @@index([t.a])\n}",
            "composite type is not supported",
        ),
    ];
    for (schema, expected) in cases {
        let message = error(&[("schema.prisma", schema)]);
        assert!(message.contains(expected), "{schema}\n=> {message}");
    }
}

#[test]
fn ignored_and_unsupported_fields_keep_their_index_without_a_column() {
    let state = extract(&[(
        "schema.prisma".into(),
        "datasource db {\n  provider = \"postgresql\"\n}\nmodel A {\n  id Int @id\n  search Unsupported(\"tsvector\")? @map(\"search_vector\")\n  legacy Int? @ignore\n  @@index([search], type: Gin)\n}\n"
            .into(),
    )])
    .unwrap();
    let items = semantic(&state);
    assert!(
        !items
            .keys()
            .any(|id| id.starts_with("column:") && (id.ends_with("search_vector") || id.ends_with("legacy")))
    );
    let index = items.values().find(|item| item["data"]["type"] == "index").unwrap();
    assert_eq!(index["data"]["fields"], json!([{"name":"search_vector"}]));
    assert!(
        !items
            .values()
            .any(|item| item["kind"] == "constrains" && item["from"] == index["id"])
    );
}

fn run(inputs: Value, files: &[&str]) -> Result<Value> {
    let root = fixtures();
    let files: Vec<String> = files.iter().map(|f| (*f).to_owned()).collect();
    collect(&testing::context(&root, json!({"id":"database","extractor":"prisma-schema","inputs":inputs})).with_files(files))
}

#[test]
fn schema_folders_include_nested_files_without_node_or_prisma() {
    let files = [
        "cases/folder/main.prisma",
        "cases/folder/post.prisma",
        "cases/folder/sub/user.prisma",
        "schema.prisma",
    ];
    let folder = run(json!({"schema":"cases/folder"}), &files).unwrap();
    assert_eq!(
        folder["metadata"]["sources"],
        json!([
            "cases/folder/main.prisma",
            "cases/folder/post.prisma",
            "cases/folder/sub/user.prisma"
        ])
    );
    assert_eq!(digest(&folder), digest(&extracted(&files[..3])));
    let listed = run(json!({"schemas":["cases/folder/", "cases/folder/post.prisma"]}), &files).unwrap();
    assert_eq!(digest(&listed), digest(&folder));
    assert!(
        run(json!({"schema":"cases"}), &[])
            .unwrap_err()
            .to_string()
            .contains("contains no .prisma files")
    );
    let discovered = run(json!({}), &["schema.prisma", "README.md"]).unwrap();
    assert_eq!(digest(&discovered), digest(&extracted(&["schema.prisma"])));
    assert!(run(json!({}), &["README.md"]).is_err());
    assert!(run(json!({"schema":"../schema.prisma"}), &[]).is_err());
}

#[test]
fn views_are_views_and_multi_schema_enums_are_identified_within_their_schema() {
    let state = extracted(&["cases/views.prisma"]);
    let entity = |id: &str| {
        state["entities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == id)
            .unwrap_or_else(|| panic!("missing {id}"))
            .clone()
    };
    assert_eq!(entity("view:public/AccountSummary")["kind"], "view");
    assert_eq!(entity("table:auth/accounts")["kind"], "table");
    let kind = entity("enum:auth/Kind");
    assert_eq!(kind["data"]["namespace"], "auth");
    // Without multiSchema, enum IDs keep their database name alone.
    assert!(
        extracted(&["schema.prisma"])["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == "enum:roles")
    );
    // Two schemas may each have an enum of the same name.
    let both = extract(&[(
        "schema.prisma".into(),
        "datasource db {\n  provider = \"postgresql\"\n  schemas = [\"a\", \"b\"]\n}\nenum Kind {\n  X\n  @@schema(\"a\")\n}\nenum Other {\n  Y\n  @@map(\"Kind\")\n  @@schema(\"b\")\n}\n"
            .into(),
    )])
    .unwrap();
    let ids: Vec<_> = both["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["enum:a/Kind", "enum:b/Kind"]);
}

#[test]
fn a_schema_the_revision_lacks_extracts_as_empty_and_is_recorded_as_missing() {
    let root = fixtures();
    let context = |inputs: Value| {
        testing::context(&root, json!({"id":"database","extractor":"prisma-schema","inputs":inputs}))
            .with_files(vec!["schema.prisma".into()])
    };
    // Missing whole: an empty schema that names the missing file.
    let cx = context(json!({"schema":"packages/api/prisma/schema.prisma"}));
    let absent = cx.finish(collect(&cx).unwrap());
    assert_eq!(absent["entities"], json!([]));
    assert_eq!(absent["relationships"], json!([]));
    assert_eq!(absent["missingInputs"], json!(["packages/api/prisma/schema.prisma"]));
    assert!(projections_engine::normalize(&absent, "").is_ok());
    // Missing in part: the rest is extracted.
    let cx = context(json!({"schemas":["schema.prisma", "packages/api/prisma/"]}));
    let partial = cx.finish(collect(&cx).unwrap());
    assert_eq!(semantic(&partial), semantic(&extracted(&["schema.prisma"])));
    assert_eq!(partial["missingInputs"], json!(["packages/api/prisma"]));
    // A missing snapshot is an empty schema too.
    let cx = context(json!({"snapshot":"schema.json"}));
    let snapshot = cx.finish(collect(&cx).unwrap());
    assert_eq!(snapshot["entities"], json!([]));
    assert_eq!(snapshot["missingInputs"], json!(["schema.json"]));
    // Present, with nothing missing, records nothing.
    let cx = context(json!({"schema":"schema.prisma"}));
    assert!(cx.finish(collect(&cx).unwrap()).get("missingInputs").is_none());
}

#[test]
fn a_schema_that_exists_but_does_not_parse_is_still_an_error() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("schema.prisma"), "model {").unwrap();
    let cx = testing::context(
        root.path(),
        json!({"id":"database","extractor":"prisma-schema","inputs":{"schema":"schema.prisma"}}),
    )
    .with_files(vec!["schema.prisma".into()]);
    assert!(collect(&cx).is_err());
    assert!(cx.missing_inputs().is_empty());
}
