use super::*;
use serde_json::json;

fn violations(schema: Value, value: Value) -> Vec<String> {
    let mut found = vec![];
    check(&schema, &value, "", &mut found);
    found
}

#[test]
fn checks_the_structural_schema() {
    let schema = json!({"type":"object","required":["spec"],"properties":{
            "spec":{"type":"object","properties":{
                "kprobes":{"type":"array","maxItems":2,"items":{"type":"object","required":["call"],"properties":{
                    "call":{"type":"string"},"syscall":{"type":"boolean"},
                    "selectors":{"type":"array","items":{"type":"object","properties":{
                        "matchActions":{"type":"array","items":{"type":"object","required":["action"],"properties":{
                            "action":{"type":"string","enum":["Post","Sigkill"]},
                            "argError":{"type":"integer","minimum":-4095}}}}}}},
                    "args":{"type":"array","items":{"type":"object","required":["type"],"properties":{"type":{"type":"string","default":"auto"}}}}}}},
                "options":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string","pattern":"^[a-z-]+$"}}}},
                "podSelector":{"type":"object","properties":{"matchLabels":{"type":"object","additionalProperties":{"type":"string"}}}}}}}});
    assert!(violations(schema.clone(), json!({"spec":{"kprobes":[{"call":"f","args":[{}]}]}})).is_empty());
    let found = violations(
        schema,
        json!({"spec":{
                "kprobes":[{"syscall":"yes","selectors":[{"matchActions":[{"action":"Explode","argError":-5000}]}]},{"call":"g"},{"call":"h","futureField":1}],
                "options":[{"name":"Policy_Mode"}],
                "podSelector":{"matchLabels":{"app":3}},
                "extra":true}}),
    );
    for expected in [
        "spec.kprobes: has 3 items; at most 2",
        "spec.kprobes[0].call: is required",
        "spec.kprobes[0].syscall: must be boolean, not string",
        "spec.kprobes[0].selectors[0].matchActions[0].action: \"Explode\" is not one of Post, Sigkill",
        "spec.kprobes[0].selectors[0].matchActions[0].argError: is less than -4095",
        "spec.kprobes[2].futureField: is not a field the CRD defines",
        "spec.options[0].name: \"Policy_Mode\" doesn't match ^[a-z-]+$",
        "spec.podSelector.matchLabels.app: must be string, not integer",
        "spec.extra: is not a field the CRD defines",
    ] {
        assert!(found.contains(&expected.to_owned()), "{expected} in {found:#?}");
    }
}
