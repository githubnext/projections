//! The schema reader against Rails schema files: Active Record 7.1's
//! PostgreSQL dump (`fixtures/storefront`) and a Rails 6 MySQL one
//! (`fixtures/legacy`), a migration's before and after, and discovery.

use projections_extractor_rails_schema::{collect, extract};
use projections_extractor_ruby_support::inflect::Inflections;
use projections_extractor_sdk::testing;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn extracted(relative: &str) -> Value {
    let source = fs::read_to_string(fixtures().join(relative)).unwrap();
    extract(&[(relative.to_owned(), source)], &Inflections::default()).unwrap()
}

fn from_source(source: &str) -> Value {
    extract(&[("db/schema.rb".to_owned(), source.to_owned())], &Inflections::default()).unwrap()
}

fn entities(extraction: &Value) -> BTreeMap<String, Value> {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["id"].as_str().unwrap().to_owned(), e.clone()))
        .collect()
}

fn relationships(extraction: &Value) -> Vec<(String, String, String)> {
    extraction["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["kind"].as_str().unwrap().into(),
                r["from"].as_str().unwrap().into(),
                r["to"].as_str().unwrap().into(),
            )
        })
        .collect()
}

/// A column's shown type, nullability, primary key flag and default.
fn column(entities: &BTreeMap<String, Value>, table: &str, name: &str) -> (String, bool, bool, Value) {
    let data = &entities[&format!("column:table%3A%2F{table}/{name}")]["data"];
    (
        data["type"].as_str().unwrap().to_owned(),
        data["nullable"] == true,
        data["primaryKey"] == true,
        data["default"].clone(),
    )
}

#[test]
fn reads_a_rails_7_postgresql_schema() {
    let extraction = extracted("storefront/db/schema.rb");
    assert_eq!(extraction["metadata"]["skipped"], json!([]));
    assert_eq!(
        extraction["metadata"]["schemaVersions"][0],
        json!({"source":"storefront/db/schema.rb","format":"7.1","version":"20240918101500"})
    );
    let entities = entities(&extraction);
    let kinds = |kind: &str| entities.values().filter(|e| e["kind"] == kind).count();
    assert_eq!((kinds("table"), kinds("column"), kinds("enum"), entities.len()), (8, 52, 1, 85));
    let extensions: Vec<&str> = extraction["metadata"]["extensions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(extensions, ["citext", "pgcrypto", "plpgsql"]);
    let expected = [
        ("accounts", "id", ("uuid", false, true, json!({"sql":"gen_random_uuid()"}))),
        ("accounts", "name", ("string(120)", false, false, Value::Null)),
        ("accounts", "roles", ("string[]", false, false, json!([]))),
        ("accounts", "preferences", ("jsonb", false, false, json!({}))),
        ("accounts", "confirmed_at", ("datetime", true, false, Value::Null)),
        ("accounts", "display_name", ("string", true, false, Value::Null)),
        ("accounts", "created_at", ("datetime(6)", false, false, Value::Null)),
        ("orders", "id", ("bigint", false, true, Value::Null)),
        ("orders", "status", ("order_status", false, false, json!("pending"))),
        ("orders", "total", ("decimal(12,2)", false, false, json!("0.0"))),
        (
            "orders",
            "placed_at",
            ("datetime(6)", false, false, json!({"sql":"CURRENT_TIMESTAMP"})),
        ),
        ("product_tags", "product_id", ("bigint", false, true, Value::Null)),
        ("product_tags", "tag", ("string", false, true, Value::Null)),
        ("line_items", "quantity", ("integer", false, false, json!(1))),
    ];
    for (table, name, (ty, nullable, key, default)) in expected {
        assert_eq!(
            column(&entities, table, name),
            (ty.to_owned(), nullable, key, default),
            "{table}.{name}"
        );
    }
    assert!(!entities.contains_key("column:table%3A%2Fschema_notes/id"));
    let virtual_column = &entities["column:table%3A%2Faccounts/display_name"]["data"];
    assert_eq!(
        (&virtual_column["virtual"], &virtual_column["stored"]),
        (&json!(true), &json!(true))
    );
    let index = &entities["constraint:table%3A%2Faccounts/unique/index_accounts_on_lower_email"]["data"];
    assert_eq!(
        (&index["expression"], &index["columns"]),
        (&json!("lower((email)::text)"), &json!([]))
    );
    assert_eq!(
        entities["constraint:table%3A%2Faccounts/index/index_accounts_on_preferences"]["data"]["using"],
        "gin"
    );
    assert_eq!(
        entities["constraint:table%3A%2Faccounts/check/accounts_name_present"]["data"]["expression"],
        "char_length(name::text) > 0"
    );
    assert_eq!(
        entities["constraint:table%3A%2Forders/index/index_orders_on_status_open"]["data"]["where"],
        "((status)::text <> 'cancelled'::text)"
    );
    assert_eq!(
        entities["constraint:table%3A%2Fproduct_tags/primary-key/%5B%22product_id%22%2C%22tag%22%5D"]["data"]["columns"],
        json!(["product_id", "tag"])
    );
    let blob_key = &entities["constraint:table%3A%2Factive_storage_attachments/foreign-key/%5B%22blob_id%22%5D/table%3A%2Factive_storage_blobs"]
        ["data"];
    assert_eq!(
        (&blob_key["columns"], &blob_key["references"]),
        (&json!(["blob_id"]), &json!(["id"]))
    );
    let order_key = &entities["constraint:table%3A%2Fline_items/foreign-key/%5B%22order_id%22%5D/table%3A%2Forders"]["data"];
    assert_eq!(order_key["onDelete"], "cascade");
    let relationships = relationships(&extraction);
    assert!(relationships.contains(&(
        "foreign-key".into(),
        "column:table%3A%2Forders/account_id".into(),
        "column:table%3A%2Faccounts/id".into()
    )));
    assert!(relationships.contains(&(
        "enum-type".into(),
        "column:table%3A%2Forders/status".into(),
        "enum:order_status".into()
    )));
    assert_eq!(
        entities["enum:order_status"]["data"]["values"],
        json!(["pending", "paid", "shipped", "cancelled"])
    );
    assert_eq!(entities["table:/accounts"]["data"]["comment"], "A customer or a business");
    assert_eq!(entities["column:table%3A%2Faccounts/email"]["evidence"][0]["location"]["line"], 44);
}

#[test]
fn reads_a_rails_6_mysql_schema_with_its_own_defaults() {
    let entities = entities(&extracted("legacy/db/schema.rb"));
    assert_eq!(column(&entities, "people", "id"), ("integer".into(), false, true, Value::Null));
    // Before Rails 7, a datetime without precision has none.
    assert_eq!(column(&entities, "people", "created_at").0, "datetime");
    assert_eq!(column(&entities, "categories", "created_at").0, "datetime(6)");
    assert_eq!(
        column(&entities, "categories", "position"),
        ("integer(2)".into(), true, false, json!(0))
    );
    assert_eq!(entities["column:table%3A%2Fcategories/position"]["data"]["unsigned"], true);
    assert_eq!(entities["column:table%3A%2Fpeople/bio"]["data"]["size"], "medium");
    let fulltext = &entities["constraint:table%3A%2Fpeople/index/index_people_on_name"]["data"];
    assert_eq!((&fulltext["indexType"], &fulltext["length"]), (&json!("fulltext"), &json!(20)));
    assert!(entities.contains_key("constraint:table%3A%2Fpeople/foreign-key/%5B%22category_id%22%5D/table%3A%2Fcategories"));
    assert_eq!(
        entities["table:/people"]["data"]["options"],
        "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

const BEFORE: &str = r#"ActiveRecord::Schema[7.1].define(version: 2024_05_01_000000) do
  create_table "licenses", force: :cascade do |t|
    t.string "key", limit: 100, null: false
    t.string "email", null: false
    t.datetime "created_at", null: false
    t.index ["key"], name: "index_licenses_on_key", unique: true
  end
end
"#;

const AFTER: &str = r#"ActiveRecord::Schema[7.1].define(version: 2024_06_12_093000) do
  create_table "licenses", force: :cascade do |t|
    t.string "key", limit: 200, null: false
    t.string "email"
    t.bigint "user_id"
    t.datetime "created_at", null: false
    t.index ["key"], name: "index_licenses_on_key", unique: true
    t.index ["user_id"], name: "index_licenses_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
  end

  add_foreign_key "licenses", "users"
end
"#;

#[test]
fn a_migration_reads_as_added_and_changed_schema() {
    let (before, after) = (entities(&from_source(BEFORE)), entities(&from_source(AFTER)));
    let added: Vec<&String> = after.keys().filter(|id| !before.contains_key(*id)).collect();
    assert_eq!(
        added,
        [
            "column:table%3A%2Flicenses/user_id",
            "column:table%3A%2Fusers/created_at",
            "column:table%3A%2Fusers/email",
            "column:table%3A%2Fusers/id",
            "column:table%3A%2Fusers/updated_at",
            "constraint:table%3A%2Flicenses/foreign-key/%5B%22user_id%22%5D/table%3A%2Fusers",
            "constraint:table%3A%2Flicenses/index/index_licenses_on_user_id",
            "constraint:table%3A%2Fusers/primary-key/%5B%22id%22%5D",
            "constraint:table%3A%2Fusers/unique/index_users_on_email",
            "table:/users",
        ]
    );
    let changed = |id: &str| before[id]["data"] != after[id]["data"];
    assert!(changed("column:table%3A%2Flicenses/key"), "a limit change is a type change");
    assert_eq!(after["column:table%3A%2Flicenses/key"]["data"]["type"], "string(200)");
    assert!(changed("column:table%3A%2Flicenses/email"), "made optional");
    assert!(!changed("column:table%3A%2Flicenses/created_at"));
    assert!(!changed("table:/licenses"), "the schema version is metadata, not the table");
}

#[test]
fn lists_statements_it_does_not_read() {
    let extraction = from_source(
        "ActiveRecord::Schema[7.1].define(version: 1) do\n  create_table \"a\" do |t|\n    t.string \"x\"\n    t.string \"y\" if ENV[\"Y\"]\n  end\n  execute \"CREATE FUNCTION f() ...\"\n  create_function :f, sql_definition: <<-SQL\n    SELECT 1\n  SQL\nend\n",
    );
    let skipped: Vec<(i64, &str)> = extraction["metadata"]["skipped"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["line"].as_i64().unwrap(), s["text"].as_str().unwrap()))
        .collect();
    assert_eq!(
        skipped,
        [
            (4, "t.string \"y\" if ENV[\"Y\"]"),
            (6, "execute \"CREATE FUNCTION f() ...\""),
            (7, "create_function :f, sql_definition: <<-SQL")
        ]
    );
}

#[test]
fn rejects_files_that_are_not_schemas() {
    let error = |source: &str| {
        format!(
            "{:#}",
            extract(&[("db/schema.rb".into(), source.into())], &Inflections::default()).unwrap_err()
        )
    };
    assert!(error("puts 1\n").contains("has no ActiveRecord::Schema.define block"));
    assert!(
        error("ActiveRecord::Schema.define do\n  add_foreign_key \"a\", \"b\"\nend\n").contains("db/schema.rb:2 adds a foreign key to a")
    );
    assert!(error("ActiveRecord::Schema.define do\n  create_table \"a\" do |t|\nend\n").starts_with("db/schema.rb:"));
}

#[test]
fn discovers_an_applications_databases_and_inflections() {
    let root = tempfile::tempdir().unwrap();
    let write = |path: &str, source: &str| {
        let path = root.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, source).unwrap();
    };
    write(
        "web/db/schema.rb",
        "ActiveRecord::Schema[7.1].define(version: 1) do\n  create_table \"cacti\"\n  create_table \"pots\" do |t|\n    t.bigint \"cactus_id\"\n  end\n  add_foreign_key \"pots\", \"cacti\"\nend\n",
    );
    write(
        "web/db/queue_schema.rb",
        "ActiveRecord::Schema[7.1].define(version: 1) do\n  create_table \"solid_queue_jobs\"\nend\n",
    );
    write("web/test/dummy/db/schema.rb", "not ruby at all (\n");
    write(
        "web/config/initializers/inflections.rb",
        "ActiveSupport::Inflector.inflections(:en) do |inflect|\n  inflect.irregular \"cactus\", \"cacti\"\nend\n",
    );
    let files = [
        "web/config/initializers/inflections.rb",
        "web/db/queue_schema.rb",
        "web/db/schema.rb",
        "web/test/dummy/db/schema.rb",
    ];
    let definition = json!({"id": "schema", "extractor": "rails-schema", "inputs": {}});
    let cx = testing::context(root.path(), definition).with_files(files.iter().map(|f| f.to_string()).collect());
    let extraction = collect(&cx).unwrap();
    let entities = entities(&extraction);
    assert!(entities.contains_key("table:queue/solid_queue_jobs"));
    assert_eq!(entities["table:queue/solid_queue_jobs"]["data"]["database"], "queue");
    assert!(entities.contains_key("constraint:table%3A%2Fpots/foreign-key/%5B%22cactus_id%22%5D/table%3A%2Fcacti"));
    assert_eq!(extraction["metadata"]["inflections"], "web/config/initializers/inflections.rb");

    write("api/db/schema.rb", "ActiveRecord::Schema.define do\nend\n");
    let mut files = files.map(str::to_owned).to_vec();
    files.push("api/db/schema.rb".into());
    let definition = json!({"id": "schema", "extractor": "rails-schema", "inputs": {}});
    let error = collect(&testing::context(root.path(), definition).with_files(files.clone())).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("more than one Rails application (api/db/schema.rb, web/db/schema.rb)"),
        "{error}"
    );
    let definition = json!({"id": "schema", "extractor": "rails-schema", "inputs": {"schema": "api/db/schema.rb"}});
    let extraction = collect(&testing::context(root.path(), definition).with_files(files)).unwrap();
    assert_eq!(extraction["entities"], json!([]));
}
