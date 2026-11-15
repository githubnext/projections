use projections_engine::{DATA_RULES, Field, FieldType, SCHEMAS, VOCABULARIES, normalize};
use serde_json::{Map, Value, json};

/// A type as `packages/schemas/scripts/generate.mjs` writes it: a primitive's name,
/// `{enum}`, `{array}`, or `{record, fields}`.
fn type_json(field_type: FieldType) -> Value {
    match field_type {
        FieldType::Enum(values) => json!({"enum": values}),
        FieldType::Array(items) => json!({"array": type_json(*items)}),
        FieldType::Record(record) => {
            json!({"record": record.name, "fields": fields_json(record.fields)})
        }
        primitive => json!(primitive.name()),
    }
}

fn fields_json(fields: &[Field]) -> Vec<Value> {
    fields
        .iter()
        .map(|field| json!({"name": field.name, "type": type_json(field.field_type), "required": field.required}))
        .collect()
}

/// The engine's rule table equals the rules the TypeBox schemas are generated from.
#[test]
fn the_rule_table_equals_the_schemas_data_rules() {
    let fixture: Value = serde_json::from_str(include_str!("../../schemas/fixtures/data-rules.json")).unwrap();
    let table: Vec<Value> = DATA_RULES
        .iter()
        .map(|rule| {
            json!({
                "schema": rule.schema,
                "vocabulary": rule.vocabulary,
                "collection": rule.collection,
                "kinds": rule.kinds,
                "fields": fields_json(rule.fields),
            })
        })
        .collect();
    let vocabularies: Map<String, Value> = VOCABULARIES
        .iter()
        .map(|(name, schemas)| (name.to_string(), json!(schemas)))
        .collect();
    assert_eq!(fixture, json!({"version": 0, "vocabularies": vocabularies, "rules": table}));
}

/// The engine's schemas are the published domain schemas, each with its own JSON Schema document.
#[test]
fn every_engine_schema_is_published() {
    let published = concat!(env!("CARGO_MANIFEST_DIR"), "/../schemas/schemas");
    let extraction: Value = serde_json::from_str(&std::fs::read_to_string(format!("{published}/extraction/v0.json")).unwrap()).unwrap();
    assert_eq!(extraction["$defs"]["domainSchema"]["enum"], json!(SCHEMAS));
    for schema in SCHEMAS {
        let (name, version) = schema.split_once('/').unwrap();
        let document: Value =
            serde_json::from_str(&std::fs::read_to_string(format!("{published}/{name}/{version}.json")).unwrap()).unwrap();
        assert_eq!(
            document["$id"],
            format!("https://schemas.projections.githubnext.com/{name}/{version}.json")
        );
    }
}

fn valid(field_type: FieldType) -> Value {
    match field_type {
        FieldType::Text | FieldType::String | FieldType::NullableString => json!("x"),
        FieldType::Number => json!(-1.5),
        FieldType::Nonnegative => json!(2),
        FieldType::Boolean => json!(true),
        FieldType::Strings => json!(["a", "b"]),
        FieldType::Object => json!({"any": [1]}),
        FieldType::Enum(values) => json!(values[values.len() - 1]),
        FieldType::Array(items) => json!([valid(*items)]),
        FieldType::Record(record) => Value::Object(
            record
                .fields
                .iter()
                .filter(|field| field.required)
                .map(|field| (field.name.to_owned(), valid(field.field_type)))
                .collect(),
        ),
    }
}

/// Other values of the type, beyond `valid`'s: a nullable string may be
/// null; an array may be empty; a record may have every field.
fn also_valid(field_type: FieldType) -> Vec<Value> {
    match field_type {
        FieldType::NullableString => vec![json!(null)],
        FieldType::Enum(values) => values.iter().map(|value| json!(value)).collect(),
        FieldType::Array(_) => vec![json!([])],
        FieldType::Record(record) => vec![Value::Object(
            record
                .fields
                .iter()
                .map(|field| (field.name.to_owned(), valid(field.field_type)))
                .collect(),
        )],
        _ => vec![],
    }
}

/// The code the engine reports for a missing required field of this type.
fn missing(field_type: FieldType) -> &'static str {
    match field_type {
        FieldType::Number | FieldType::Nonnegative | FieldType::Boolean | FieldType::Enum(_) => "invalid-domain-value",
        _ => "invalid-type",
    }
}

/// Values of the wrong type, the code each must produce, and the path below the field it points to.
fn invalid(field_type: FieldType) -> Vec<(Value, &'static str, String)> {
    let here = |value: Value, code: &'static str| (value, code, String::new());
    match field_type {
        FieldType::Text => vec![here(json!(1), "invalid-type"), here(json!(" "), "invalid-type")],
        FieldType::String => vec![here(json!(1), "invalid-type"), here(json!(null), "invalid-type")],
        FieldType::Number => vec![here(json!("1"), "invalid-domain-value")],
        FieldType::Nonnegative => vec![here(json!(-1), "invalid-domain-value"), here(json!("1"), "invalid-domain-value")],
        FieldType::Boolean => vec![here(json!(1), "invalid-domain-value"), here(json!(null), "invalid-domain-value")],
        FieldType::NullableString => vec![here(json!(1), "invalid-type"), here(json!(false), "invalid-type")],
        FieldType::Strings => vec![here(json!("a"), "invalid-type"), (json!(["a", 1]), "invalid-type", "/1".into())],
        FieldType::Object => vec![here(json!([]), "invalid-type"), here(json!("x"), "invalid-type")],
        FieldType::Enum(_) => vec![
            here(json!("unknown value"), "invalid-domain-value"),
            here(json!(1), "invalid-domain-value"),
        ],
        FieldType::Array(items) => {
            let mut values = vec![here(json!({}), "invalid-type")];
            values.extend(
                invalid(*items)
                    .into_iter()
                    .map(|(value, code, below)| (json!([valid(*items), value]), code, format!("/1{below}"))),
            );
            values
        }
        FieldType::Record(record) => {
            let base = valid(field_type);
            let mut values = vec![here(json!([]), "invalid-type")];
            let mut unknown = base.clone();
            unknown["unknown"] = json!(1);
            values.push((unknown, "unknown-field", "/unknown".into()));
            for field in record.fields {
                for (value, code, below) in invalid(field.field_type) {
                    let mut with = base.clone();
                    with[field.name] = value;
                    values.push((with, code, format!("/{}{below}", field.name)));
                }
                if field.required {
                    let mut without = base.clone();
                    without.as_object_mut().unwrap().remove(field.name);
                    values.push((without, missing(field.field_type), format!("/{}", field.name)));
                }
            }
            values
        }
    }
}

/// Valid `data` for an item of `kind` in `collection` of `schema`: every required field of every rule.
fn data(schema: &str, vocabulary: Option<&str>, collection: &str, kind: &str) -> Map<String, Value> {
    let mut data = Map::new();
    for rule in DATA_RULES.iter().filter(|rule| {
        rule.schema == schema
            && (rule.vocabulary.is_none() || rule.vocabulary == vocabulary)
            && rule.collection == collection
            && rule.kinds.is_none_or(|kinds| kinds.contains(&kind))
    }) {
        for field in rule.fields.iter().filter(|field| field.required) {
            data.insert(field.name.to_owned(), valid(field.field_type));
        }
    }
    if schema == "treemap/v0" && collection == "entities" {
        data.insert("value".into(), json!(1));
    }
    data
}

/// An extraction whose only item under test is `item` (index 0 of `collection`), with valid endpoints.
/// `scope` is the schema and the vocabulary the extraction declares, if any.
fn extraction(scope: (&str, Option<&str>), collection: &str, kind: &str, data: Map<String, Value>) -> Value {
    let (schema, vocabulary) = scope;
    let endpoint =
        |id: &str| json!({"id": id, "kind": "endpoint", "label": id, "data": self::data(schema, vocabulary, "entities", "endpoint")});
    let mut extraction = if collection == "entities" {
        json!({"protocolVersion": 0, "schema": schema, "entities": [{"id": "a", "kind": kind, "label": "a", "data": data}], "relationships": []})
    } else {
        json!({
            "protocolVersion": 0,
            "schema": schema,
            "entities": [endpoint("a"), endpoint("b")],
            "relationships": [{"id": "r", "kind": kind, "from": "a", "to": "b", "data": data}],
        })
    };
    if let Some(vocabulary) = vocabulary {
        extraction["vocabularies"] = json!([vocabulary]);
    }
    extraction
}

#[test]
fn every_rule_field_accepts_its_type_and_rejects_others_at_its_path() {
    let mut checked = 0;
    for rule in DATA_RULES {
        let kinds: Vec<&str> = rule.kinds.map_or(vec!["anything"], |kinds| kinds.to_vec());
        for kind in kinds {
            let base = data(rule.schema, rule.vocabulary, rule.collection, kind);
            normalize(&extraction((rule.schema, rule.vocabulary), rule.collection, kind, base.clone()), "")
                .unwrap_or_else(|failure| panic!("{} {kind}: {failure:?}", rule.schema));
            for field in rule.fields {
                let path = format!("/{}/0/data/{}", rule.collection, field.name);
                for value in [valid(field.field_type)].into_iter().chain(also_valid(field.field_type)) {
                    let mut with = base.clone();
                    with.insert(field.name.into(), value.clone());
                    assert!(
                        normalize(&extraction((rule.schema, rule.vocabulary), rule.collection, kind, with), "").is_ok(),
                        "{} {kind} {} = {value}",
                        rule.schema,
                        field.name
                    );
                }
                for (value, code, below) in invalid(field.field_type) {
                    let mut with = base.clone();
                    with.insert(field.name.into(), value.clone());
                    let failure = normalize(&extraction((rule.schema, rule.vocabulary), rule.collection, kind, with), "").unwrap_err();
                    assert_eq!(
                        (failure[0].code.as_str(), failure[0].path.as_str()),
                        (code, format!("{path}{below}").as_str()),
                        "{} {kind} {} = {value}",
                        rule.schema,
                        field.name
                    );
                    checked += 1;
                }
                let mut without = base.clone();
                without.remove(field.name);
                let result = normalize(&extraction((rule.schema, rule.vocabulary), rule.collection, kind, without), "");
                let leaf_weight = rule.schema == "treemap/v0";
                assert_eq!(
                    result.is_err(),
                    field.required || leaf_weight,
                    "{} {kind} without {}",
                    rule.schema,
                    field.name
                );
            }
        }
    }
    assert!(checked > 100, "{checked}");
}

#[test]
fn rules_apply_only_to_their_kinds_and_schemas() {
    // A column's rules don't apply to a table, or to a column in another schema.
    let column = Map::from_iter([("type".to_owned(), json!(1))]);
    assert!(normalize(&extraction(("database/v0", None), "entities", "table", column.clone()), "").is_ok());
    assert!(normalize(&extraction(("graph/v0", None), "entities", "column", column.clone()), "").is_ok());
    assert!(normalize(&extraction(("database/v0", None), "entities", "column", column), "").is_err());
}

#[test]
fn vocabulary_rules_apply_only_when_declared() {
    let service = Map::from_iter([("key".to_owned(), json!(1))]);
    let undeclared = extraction(("architecture/v0", None), "entities", "service", service.clone());
    assert!(normalize(&undeclared, "").is_ok());
    let declared = extraction(("architecture/v0", Some("dependency-injection/v0")), "entities", "service", service);
    let failure = normalize(&declared, "").unwrap_err();
    assert_eq!(failure[0].path, "/entities/0/data/key");
}

#[test]
fn vocabularies_are_known_applicable_and_declared_once_in_canonical_order() {
    let base = json!({"protocolVersion": 0, "schema": "architecture/v0", "entities": [], "relationships": []});
    let with = |vocabularies: Value| {
        let mut value = base.clone();
        value["vocabularies"] = vocabularies;
        normalize(&value, "")
    };
    let normalized = with(json!(["runtime-policy/v0", "dependency-injection/v0"])).unwrap();
    assert_eq!(normalized["vocabularies"], json!(["dependency-injection/v0", "runtime-policy/v0"]));
    assert!(with(json!([])).unwrap().get("vocabularies").is_none());
    assert!(normalize(&base, "").unwrap().get("vocabularies").is_none());
    for (vocabularies, code, path) in [
        (json!("infrastructure/v0"), "invalid-type", "/vocabularies"),
        (json!([1]), "invalid-type", "/vocabularies/0"),
        (json!(["unknown/v0"]), "unsupported-vocabulary", "/vocabularies/0"),
        (
            json!(["infrastructure/v0", "infrastructure/v0"]),
            "duplicate-vocabulary",
            "/vocabularies/1",
        ),
    ] {
        let failure = with(vocabularies.clone()).unwrap_err();
        assert_eq!((failure[0].code.as_str(), failure[0].path.as_str()), (code, path), "{vocabularies}");
    }
    let mut graph = base.clone();
    graph["schema"] = json!("graph/v0");
    graph["vocabularies"] = json!(["infrastructure/v0"]);
    let failure = normalize(&graph, "").unwrap_err();
    assert_eq!(failure[0].code, "unsupported-vocabulary");
    assert!(failure[0].message.contains("architecture/v0"), "{}", failure[0].message);
}
