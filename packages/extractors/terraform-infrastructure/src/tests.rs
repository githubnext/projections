use super::*;

#[test]
fn module_addresses_keep_indexes_and_quoted_dots() {
    assert_eq!(module_of("module.a.aws_x.y"), Some("module.a"));
    assert_eq!(
        module_of(r#"module.a["x.y"].module.b[0].aws_x.y"#),
        Some(r#"module.a["x.y"].module.b[0]"#)
    );
    assert_eq!(module_of("aws_x.y"), None);
    assert_eq!(module_parent("module.a.module.b"), Some("module.a"));
    assert_eq!(module_parent("module.a"), None);
}

#[test]
fn only_the_longest_traversal_is_kept() {
    assert_eq!(
        longest(vec![
            "module.net.subnet".into(),
            "module.net".into(),
            "aws_vpc.main.id".into(),
            "aws_vpc.main".into(),
            r#"aws_subnet.private["a"].id"#.into(),
        ]),
        ["aws_subnet.private.id", "aws_vpc.main.id", "module.net.subnet"]
    );
}

#[test]
fn sensitive_and_unknown_values_are_never_copied() {
    let value = json!({"a":"secret","b":null,"c":[1,"x"],"d":{"e":"f"}});
    let sensitive = json!({"a":true,"c":[false,true]});
    let mut secrets = Secrets::default();
    secrets.add(&value, &sensitive);
    let safe = safe(&value, &sensitive, &json!({"d":{"g":true}}), &secrets);
    assert_eq!(
        safe,
        json!({"a":"(sensitive value)","c":[1,"(sensitive value)"],"d":{"e":"f","g":"(known after apply)"}})
    );
    // A copy without the marker, and a longer string embedding it, are replaced too.
    let copied = json!({"plain":"x","embedded":"user:secret@host","exact":"secret"});
    assert_eq!(
        super::safe(&copied, &Value::Null, &Value::Null, &secrets),
        json!({"plain":"(sensitive value)","embedded":"(sensitive value)","exact":"(sensitive value)"})
    );
}

#[test]
fn replacement_is_one_action() {
    assert_eq!(action(&["delete".into(), "create".into()], false).unwrap(), Some("replace"));
    assert_eq!(action(&["create".into(), "delete".into()], false).unwrap(), Some("replace"));
    assert_eq!(action(&["no-op".into()], false).unwrap(), None);
    assert_eq!(action(&["no-op".into()], true).unwrap(), Some("import"));
    assert!(action(&["explode".into()], false).is_err());
}

#[test]
fn forgotten_resources_remain_and_destroyed_ones_are_listed() {
    let change = |actions: Value, before: Value| {
        json!({"address":"","mode":"managed","type":"aws_s3_bucket","name":"","provider_name":"aws",
                "change":{"actions":actions,"before":before,"after":null,"before_sensitive":{},"after_sensitive":false}})
    };
    let mut kept = change(json!(["forget"]), json!({"bucket":"logs"}));
    kept["address"] = json!("aws_s3_bucket.logs");
    kept["name"] = json!("logs");
    let mut gone = change(json!(["delete"]), json!({"bucket":"tmp"}));
    gone["address"] = json!("aws_s3_bucket.tmp");
    gone["name"] = json!("tmp");
    let document = json!({"format_version":"1.2","planned_values":{"root_module":{}},"resource_changes":[kept,gone]});
    let graph = infrastructure(&document).unwrap();
    assert_eq!(graph["entities"][0]["id"], "aws_s3_bucket.logs");
    assert_eq!(graph["entities"][0]["data"]["action"], "forget");
    assert_eq!(graph["entities"][0]["data"]["values"], json!({"bucket":"logs"}));
    assert_eq!(graph["entities"].as_array().unwrap().len(), 1);
    assert_eq!(graph["metadata"]["destroyed"], json!(["aws_s3_bucket.tmp"]));
}
