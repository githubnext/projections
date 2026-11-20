//! A change's context: the core's structural context, and the Engine's checks
//! of the context a comparison claims.

use projections_engine::context::{Containment, Core, MAX_CONTEXT, MAX_CONTEXT_BYTES, MAX_CONTEXT_TOTAL, extend};
use projections_engine::{Change, Collection, Correspondence, Extraction, Status, normalize, validate_comparison};
use serde_json::{Value, json};

fn node(id: &str, kind: &str) -> Value {
    json!({"id": id, "kind": kind, "label": id})
}

fn edge(id: &str, kind: &str, from: &str, to: &str) -> Value {
    json!({"id": id, "kind": kind, "from": from, "to": to})
}

fn extraction(schema: &str, entities: Value, relationships: Value) -> Value {
    normalize(
        &json!({"protocolVersion": 0, "schema": schema, "entities": entities, "relationships": relationships}),
        "",
    )
    .unwrap()
}

/// A module containing a package containing a function, and a call into it.
fn nested(function_label: &str) -> Value {
    let mut function = node("function", "function");
    function["label"] = json!(function_label);
    extraction(
        "graph/v0",
        json!([
            node("module", "module"),
            node("package", "package"),
            function,
            node("caller", "function")
        ]),
        json!([
            edge("module>package", "contains", "module", "package"),
            edge("package>function", "contains", "package", "function"),
            edge("caller>function", "calls", "caller", "function"),
        ]),
    )
}

fn typed(value: &Value) -> Extraction {
    Extraction::from_json(value, "").unwrap()
}

fn change(id: &str, collection: Collection, before: &[&str], after: &[&str], status: Status, correspondence: Correspondence) -> Change {
    let ids = |ids: &[&str]| ids.iter().map(|id| (*id).to_owned()).collect();
    Change {
        id: id.to_owned(),
        collection,
        before: ids(before),
        after: ids(after),
        status,
        correspondence,
        varied: Vec::new(),
        summary: None,
        context: None,
    }
}

fn strings(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

#[test]
fn a_changed_entitys_context_is_what_contains_it_in_each_revision() {
    let (before, after) = (typed(&nested("f")), typed(&nested("g")));
    let mut core = Core::new(&before, &after);
    let modified = change(
        "function",
        Collection::Entities,
        &["function"],
        &["function"],
        Status::Modified,
        Correspondence::Exact,
    );
    let context = core.context(&modified).unwrap();
    let expected = strings(&["module", "module>package", "package", "package>function"]);
    assert_eq!((context.before.clone(), context.after.clone()), (expected.clone(), expected));
    assert!(context.rules.is_empty());
    // A removal's context is in before; an addition's in after.
    let removed = change(
        "function",
        Collection::Entities,
        &["function"],
        &[],
        Status::Removed,
        Correspondence::None,
    );
    assert!(core.context(&removed).unwrap().after.is_empty());
    // A root has none.
    let root = change(
        "module",
        Collection::Entities,
        &["module"],
        &["module"],
        Status::Modified,
        Correspondence::Exact,
    );
    assert_eq!(core.context(&root), None);
    // Unchanged and only-varied changes have none.
    let unchanged = change(
        "function",
        Collection::Entities,
        &["function"],
        &["function"],
        Status::Unchanged,
        Correspondence::Exact,
    );
    assert_eq!(core.context(&unchanged), None);
    // A rename is a change of identity, so it has context.
    let renamed = change(
        "function",
        Collection::Entities,
        &["function"],
        &["function"],
        Status::Unchanged,
        Correspondence::Declared,
    );
    assert!(core.context(&renamed).is_some());
}

#[test]
fn a_changed_relationships_context_is_its_endpoints_and_what_contains_them() {
    let (before, after) = (typed(&nested("f")), typed(&nested("f")));
    let mut core = Core::new(&before, &after);
    let call = change(
        "caller>function",
        Collection::Relationships,
        &[],
        &["caller>function"],
        Status::Added,
        Correspondence::None,
    );
    let context = core.context(&call).unwrap();
    assert!(context.before.is_empty());
    assert_eq!(
        context.after,
        strings(&["caller", "function", "module", "module>package", "package", "package>function"])
    );
    // A containment relationship's own ID is never its context.
    let contains = change(
        "package>function",
        Collection::Relationships,
        &["package>function"],
        &[],
        Status::Removed,
        Correspondence::None,
    );
    assert_eq!(
        core.context(&contains).unwrap().before,
        strings(&["function", "module", "module>package", "package"])
    );
}

/// The IDs of an extraction's relationships that mean containment.
fn containing(extraction: &Value) -> Vec<String> {
    let extraction = typed(extraction);
    let containment = Containment::of(&extraction);
    extraction
        .relationships()
        .iter()
        .filter(|relationship| containment.contains(relationship))
        .map(|relationship| relationship.id.clone())
        .collect()
}

#[test]
fn containment_follows_the_domain_schema_and_its_vocabularies() {
    assert_eq!(containing(&nested("f")), strings(&["module>package", "package>function"]));
    let tables = json!([
        node("orders", "table"),
        json!({"id": "orders.id", "kind": "column", "label": "id", "data": {"type": "int"}}),
        node("orders.pk", "primary-key"),
        node("orders.ix", "index")
    ]);
    let database = extraction(
        "database/v0",
        tables.clone(),
        json!([
            edge("c", "contains", "orders", "orders.id"),
            edge("k", "constraint", "orders", "orders.pk"),
            edge("i", "index", "orders", "orders.ix"),
        ]),
    );
    assert_eq!(containing(&database), strings(&["c", "i", "k"]));
    // The kinds mean containment only in the database schema.
    let graph = extraction("graph/v0", tables, json!([edge("k", "constraint", "orders", "orders.pk")]));
    assert!(containing(&graph).is_empty());
    // Dependency injection decides by the kinds at the ends, whatever the relationship is called.
    let injection = |vocabularies: Value| {
        normalize(
            &json!({"protocolVersion": 0, "schema": "architecture/v0", "vocabularies": vocabularies,
            "entities": [node("api", "service"), node("api#0", "registration"), node("Api", "implementation"), node("db", "service")],
            "relationships": [
                edge("api>api#0", "registration", "api", "api#0"),
                edge("api#0>Api", "implementation", "api#0", "Api"),
                edge("api>db", "dependsOn", "api", "db"),
            ]}),
            "",
        )
        .unwrap()
    };
    assert_eq!(
        containing(&injection(json!(["dependency-injection/v0"]))),
        strings(&["api#0>Api", "api>api#0"])
    );
    assert!(containing(&injection(json!([]))).is_empty());
}

#[test]
fn extending_a_context_keeps_it_sorted_and_unique() {
    let mut ids = strings(&["b", "d"]);
    extend(&mut ids, strings(&["c", "b", "a"]));
    assert_eq!(ids, strings(&["a", "b", "c", "d"]));
}

fn modified(id: &str, context: Option<Value>) -> Value {
    let mut change = json!({"id": id, "collection": "entities", "before": [id], "after": [id],
        "status": "modified", "correspondence": "exact"});
    if let Some(context) = context {
        change["context"] = context;
    }
    change
}

fn comparison(changes: Vec<Value>) -> Value {
    let ids: Vec<_> = changes.iter().map(|change| change["id"].clone()).collect();
    json!({"protocolVersion": 0, "changes": changes, "steps": [{"changes": ids}]})
}

fn check(before: &Value, after: &Value, comparison: &Value) -> Result<(), (String, String)> {
    validate_comparison(before, after, comparison)
        .map(|_| ())
        .map_err(|failure| (failure[0].code.clone(), failure[0].path.clone()))
}

fn failure(code: &str, path: &str) -> Result<(), (String, String)> {
    Err((code.to_owned(), path.to_owned()))
}

#[test]
fn validation_accepts_the_cores_context_and_more_and_comparisons_without_it() {
    let (before, after) = (nested("f"), nested("g"));
    let core = json!(["module", "module>package", "package", "package>function"]);
    let context = json!({"before": core, "after": core});
    assert_eq!(
        check(&before, &after, &comparison(vec![modified("function", Some(context))])),
        Ok(())
    );
    let more =
        json!({"before": core, "after": ["caller", "module", "module>package", "package", "package>function"], "rules": ["callers"]});
    let accepted = comparison(vec![modified("function", Some(more))]);
    assert_eq!(validate_comparison(&before, &after, &accepted).unwrap(), accepted);
    // Comparisons saved before context have none, and stay valid.
    assert_eq!(check(&before, &after, &comparison(vec![modified("function", None)])), Ok(()));
}

#[test]
fn validation_rejects_context_that_misses_the_cores_or_names_other_than_other_items() {
    let (before, after) = (nested("f"), nested("g"));
    let core = ["module", "module>package", "package", "package>function"];
    let with = |before: Value, after: Value| comparison(vec![modified("function", Some(json!({"before": before, "after": after})))]);
    let path = "/comparison/changes/0/context";
    assert_eq!(
        check(&before, &after, &with(json!(["module"]), json!(core))),
        failure("missing-context", &format!("{path}/before"))
    );
    assert_eq!(
        check(
            &before,
            &after,
            &with(
                json!(core),
                json!(["module", "module>package", "nowhere", "package", "package>function"])
            )
        ),
        failure("unknown-reference", &format!("{path}/after/2"))
    );
    assert_eq!(
        check(&before, &after, &with(json!(["function", "module"]), json!(core))),
        failure("invalid-context", &format!("{path}/before/0"))
    );
    assert_eq!(
        check(&before, &after, &with(json!(["package", "module"]), json!(core))),
        failure("invalid-context", &format!("{path}/before/1"))
    );
    assert_eq!(
        check(&before, &after, &with(json!(["module", "module"]), json!(core))),
        failure("invalid-context", &format!("{path}/before/1"))
    );
    assert_eq!(
        check(&before, &after, &with(json!([]), json!([]))),
        failure("invalid-context", path)
    );
    assert_eq!(
        check(&before, &after, &with(json!(core), json!([""]))),
        failure("invalid-type", &format!("{path}/after/0"))
    );
    assert_eq!(
        check(&before, &after, &with(json!(core), json!({}))),
        failure("invalid-type", &format!("{path}/after"))
    );
    let mut extra = with(json!(core), json!(core));
    extra["changes"][0]["context"]["why"] = json!("structure");
    assert_eq!(check(&before, &after, &extra), failure("unknown-field", &format!("{path}/why")));
    for (rules, code, at) in [
        (json!([]), "invalid-type", format!("{path}/rules")),
        (json!(["a", "a"]), "invalid-context", format!("{path}/rules/1")),
        (json!([1]), "invalid-type", format!("{path}/rules/0")),
    ] {
        let mut named = with(json!(core), json!(core));
        named["changes"][0]["context"]["rules"] = rules;
        assert_eq!(check(&before, &after, &named), failure(code, &at));
    }
}

#[test]
fn only_a_change_a_person_reviews_has_context() {
    let side = nested("f");
    let mut unchanged = modified("function", Some(json!({"before": ["module"], "after": ["module"]})));
    unchanged["status"] = json!("unchanged");
    let comparison = json!({"protocolVersion": 0, "changes": [unchanged], "steps": [{"changes": ["function"]}]});
    assert_eq!(
        check(&side, &side, &comparison),
        failure("unexpected-context", "/comparison/changes/0/context")
    );
}

#[test]
fn context_is_bounded_per_change_and_per_comparison() {
    // Changed entities, each beside every unchanged one.
    let others: Vec<String> = (0..MAX_CONTEXT).map(|index| format!("other{index:04}")).collect();
    let changed: Vec<String> = (0..MAX_CONTEXT_TOTAL / (2 * MAX_CONTEXT) + 1)
        .map(|index| format!("changed{index:03}"))
        .collect();
    let side = |label: &str| {
        let mut entities: Vec<Value> = others.iter().map(|id| node(id, "entity")).collect();
        entities.extend(changed.iter().map(|id| json!({"id": id, "kind": "entity", "label": label})));
        extraction("graph/v0", json!(entities), json!([]))
    };
    let (before, after) = (side("a"), side("b"));
    let context = json!({"before": others, "after": others});
    let all = comparison(changed.iter().map(|id| modified(id, Some(context.clone()))).collect());
    let last = changed.len() - 1;
    assert_eq!(
        check(&before, &after, &all),
        failure("context-limit", &format!("/comparison/changes/{last}/context"))
    );
    let mut too_many = others.clone();
    too_many.push("changed001".to_owned());
    let one = comparison(vec![modified("changed000", Some(json!({"before": [], "after": too_many})))]);
    assert_eq!(
        check(&before, &after, &one),
        failure("context-limit", "/comparison/changes/0/context/after")
    );
}

#[test]
fn applying_the_core_sets_every_changes_context_replacing_any_it_had() {
    let (before, after) = (typed(&nested("f")), typed(&nested("g")));
    let modified = |id: &str| change(id, Collection::Entities, &[id], &[id], Status::Modified, Correspondence::Exact);
    let mut changes = vec![modified("function"), modified("module")];
    let expected = Core::new(&before, &after).context(&changes[0]);
    assert!(expected.is_some());
    changes[1].context = expected.clone();
    Core::new(&before, &after).apply(&mut changes);
    assert_eq!((changes[0].context.clone(), changes[1].context.clone()), (expected, None));
}

/// A chain of `depth` entities, each containing the next; `changed` (the
/// deepest ones) relabelled in `after`.
fn chain(depth: usize, changed: usize, label: &str) -> Value {
    let id = |level: usize| format!("e{level:04}");
    let entities: Vec<Value> = (0..depth)
        .map(|level| json!({"id": id(level), "kind": "k", "label": if level >= depth - changed { label } else { "same" }}))
        .collect();
    let relationships: Vec<Value> = (1..depth)
        .map(|level| edge(&format!("c{level:04}"), "contains", &id(level - 1), &id(level)))
        .collect();
    extraction("graph/v0", json!(entities), json!(relationships))
}

#[test]
fn the_core_keeps_the_nearest_context_within_the_limit_per_change() {
    let (before, after) = (typed(&chain(800, 1, "a")), typed(&chain(800, 1, "b")));
    let deepest = change(
        "e0799",
        Collection::Entities,
        &["e0799"],
        &["e0799"],
        Status::Modified,
        Correspondence::Exact,
    );
    let context = Core::new(&before, &after).context(&deepest).unwrap();
    assert_eq!(context.after.len(), MAX_CONTEXT);
    // The nearest 500 containers and the relationships that place them: the parent, never the root.
    assert!(context.after.contains(&"e0798".to_owned()) && context.after.contains(&"c0799".to_owned()));
    assert!(context.after.contains(&"e0299".to_owned()) && !context.after.contains(&"e0298".to_owned()));
    assert!(!context.after.contains(&"e0000".to_owned()));
}

#[test]
fn the_core_spends_the_comparisons_budget_in_order_and_validation_agrees() {
    // 260 changes, each with more than its limit of containers: the first 250 fill the budget.
    let (before, after) = (chain(800, 260, "a"), chain(800, 260, "b"));
    let (typed_before, typed_after) = (typed(&before), typed(&after));
    let ids: Vec<String> = (540..800).map(|level| format!("e{level:04}")).collect();
    let mut changes: Vec<Change> = ids
        .iter()
        .map(|id| change(id, Collection::Entities, &[id], &[id], Status::Modified, Correspondence::Exact))
        .collect();
    Core::new(&typed_before, &typed_after).apply(&mut changes);
    let sizes: Vec<usize> = changes
        .iter()
        .map(|change| change.context.as_ref().map_or(0, |context| context.after.len()))
        .collect();
    assert_eq!(sizes.iter().sum::<usize>() * 2, MAX_CONTEXT_TOTAL);
    assert_eq!((sizes[0], sizes[124], sizes[125]), (MAX_CONTEXT, MAX_CONTEXT, 0));
    let mut written = json!({"protocolVersion": 0, "changes": changes.iter().map(Change::to_json).collect::<Vec<_>>(),
        "steps": [{"changes": ids}]});
    assert_eq!(check(&before, &after, &written), Ok(()));
    // Changes that omit their context still spend the budget, so a later change past it has no core context to
    // hold: it may claim a little of its own.
    for change in written["changes"].as_array_mut().unwrap()[5..10].iter_mut() {
        change.as_object_mut().unwrap().remove("context");
    }
    written["changes"][125]["context"] = json!({"before": [], "after": ["e0664"]});
    assert_eq!(check(&before, &after, &written), Ok(()));
}

#[test]
fn the_core_spends_the_comparisons_bytes_too_and_validation_agrees() {
    // A chain of 300 entities with 2 KB IDs, every label changed: about 90 MB of containers in all, past 16 MiB of
    // context, though under the counts.
    let id = |level: usize| format!("e{level:04}{}", "x".repeat(2000));
    let side = |label: &str| {
        let entities: Vec<Value> = (0..300)
            .map(|level| json!({"id": id(level), "kind": "k", "label": label}))
            .collect();
        let relationships: Vec<Value> = (1..300)
            .map(|level| edge(&format!("c{level:04}"), "contains", &id(level - 1), &id(level)))
            .collect();
        extraction("graph/v0", json!(entities), json!(relationships))
    };
    let (before, after) = (side("a"), side("b"));
    let ids: Vec<String> = (0..300).map(id).collect();
    let mut changes: Vec<Change> = ids
        .iter()
        .map(|id| change(id, Collection::Entities, &[id], &[id], Status::Modified, Correspondence::Exact))
        .collect();
    Core::new(&typed(&before), &typed(&after)).apply(&mut changes);
    let bytes: usize = changes
        .iter()
        .flat_map(|change| change.context.iter())
        .flat_map(|context| context.before.iter().chain(&context.after))
        .map(String::len)
        .sum();
    assert!(bytes <= MAX_CONTEXT_BYTES && bytes > MAX_CONTEXT_BYTES - 4096, "{bytes}");
    assert_eq!(changes.last().unwrap().context, None);
    let mut written = json!({"protocolVersion": 0, "changes": changes.iter().map(Change::to_json).collect::<Vec<_>>(),
        "steps": [{"changes": ids}]});
    assert_eq!(check(&before, &after, &written), Ok(()));
    // Past the bytes, a claimed context is refused, though it is within the counts.
    written["changes"][299]["context"] = json!({"before": [], "after": [id(0), id(1), id(2)]});
    assert_eq!(
        check(&before, &after, &written),
        failure("context-limit", "/comparison/changes/299/context")
    );
}
