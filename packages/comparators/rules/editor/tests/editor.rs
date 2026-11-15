//! The editor service (`projections_rules_editor` in `rules-editor.wasm`): semantic tokens over
//! exactly the CEL in a rules file, the diagnostics loading reports at their
//! line and column, hovers and completions.

use projections_comparator_rules::inspect;
use projections_rules_editor::call as edit;
use serde_json::{Value, json};

mod common {
    /// Runs a test on a thread with a large stack, as the interpreter's tests
    /// do: unoptimized builds of the CEL parser use large frames.
    pub fn with_stack(f: impl FnOnce() + Send + 'static) {
        std::thread::Builder::new()
            .stack_size(64 * 1024 * 1024)
            .spawn(f)
            .unwrap()
            .join()
            .unwrap_or_else(|panic| std::panic::resume_unwind(panic));
    }
}

fn call(request: Value) -> Value {
    serde_json::from_slice(&edit(&serde_json::to_vec(&request).unwrap())).unwrap()
}

/// Tokens as `(line, text, type, modifiers)`, with each token's text read
/// from the source at its position.
fn tokens(source: &str) -> Vec<(usize, String, String, Vec<String>)> {
    let lines: Vec<&str> = source.lines().collect();
    call(json!({"op": "tokens", "source": source}))["tokens"]
        .as_array()
        .unwrap()
        .iter()
        .map(|token| {
            let line = token["line"].as_u64().unwrap() as usize;
            let column = token["column"].as_u64().unwrap() as usize;
            let length = token["length"].as_u64().unwrap() as usize;
            let text: String = lines[line - 1].chars().skip(column - 1).take(length).collect();
            let modifiers = token["modifiers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|modifier| modifier.as_str().unwrap().to_owned())
                .collect();
            (line, text, token["type"].as_str().unwrap().to_owned(), modifiers)
        })
        .collect()
}

/// The type and modifiers of the token spelled `text` on `line`.
fn token(all: &[(usize, String, String, Vec<String>)], line: usize, text: &str) -> (String, Vec<String>) {
    let found = all
        .iter()
        .find(|(at, spelled, ..)| *at == line && spelled == text)
        .unwrap_or_else(|| panic!("no token `{text}` on line {line}: {all:#?}"));
    (found.2.clone(), found.3.clone())
}

fn is(all: &[(usize, String, String, Vec<String>)], line: usize, text: &str, ty: &str, modifiers: &[&str]) {
    assert_eq!(
        token(all, line, text),
        (ty.to_owned(), modifiers.iter().map(|m| m.to_string()).collect()),
        "`{text}` on line {line}"
    );
}

const RULES: &str = r#"format: projections.comparator
version: 0
description: >-
  Plain prose, never highlighted: before.entities.map(x, x)
checks:
  - assert: "has(options.mode) && options.mode in [\"fast\", 'slow']"
    message: "'invalid options: unknown `mode`'"
functions:
  rank:
    description: How severe a level is.
    params: [{name: level, type: string}, {name: item, type: Item}]
    returns: int
    body: 'match(level, {''low'': 1, ''high'': 2}, 0) + size(item.id)'
variables:
  - name: kinds
    description: Every entity kind, once.
    expression: |-
      before.entities
        .map(e, e.kind).distinct()
  - name: label
    expression: >-
      template('{kinds} kinds', {'kinds': json(variables.kinds)})
      + graph.entity('after', 'x').label
classify:
  summary: |-
    cond({change.status == 'added': prose.code(item.id)}, null)
"#;

#[test]
fn tokens_mark_every_kind_of_name() {
    common::with_stack(tokens_mark_every_kind_of_name_);
}

fn tokens_mark_every_kind_of_name_() {
    let all = tokens(RULES);
    // Prose and the YAML keys are not CEL.
    assert!(all.iter().all(|(line, ..)| *line != 4), "{all:#?}");
    // A double-quoted value, with escaped quotes inside it.
    is(&all, 6, "has", "macro", &["defaultLibrary"]);
    is(&all, 6, "options", "parameter", &["readonly", "defaultLibrary"]);
    is(&all, 6, "mode", "property", &[]);
    is(&all, 6, "&&", "operator", &[]);
    is(&all, 6, "in", "keyword", &[]);
    is(&all, 6, "\\\"fast\\\"", "string", &[]);
    is(&all, 6, "'slow'", "string", &[]);
    is(&all, 7, "'invalid options: unknown `mode`'", "string", &[]);
    // Parameters, their types, a macro, and single-quoted escapes.
    is(&all, 11, "level", "parameter", &["declaration"]);
    is(&all, 11, "string", "type", &[]);
    is(&all, 11, "Item", "type", &[]);
    is(&all, 12, "int", "type", &[]);
    is(&all, 13, "match", "macro", &[]);
    is(&all, 13, "level", "parameter", &[]);
    is(&all, 13, "''low''", "string", &[]);
    is(&all, 13, "1", "number", &[]);
    is(&all, 13, "size", "function", &["defaultLibrary"]);
    is(&all, 13, "item", "parameter", &[]);
    is(&all, 13, "id", "property", &[]);
    // A literal block over two lines, comprehension variables and methods.
    is(&all, 15, "kinds", "variable", &["declaration", "readonly"]);
    is(&all, 18, "before", "parameter", &["readonly", "defaultLibrary"]);
    is(&all, 18, "entities", "property", &[]);
    is(&all, 19, "map", "macro", &["defaultLibrary"]);
    is(&all, 19, "e", "variable", &["declaration"]);
    is(&all, 19, "kind", "property", &[]);
    is(&all, 19, "distinct", "method", &["defaultLibrary"]);
    // A folded block: the template's fields, the library and `variables.*`.
    is(&all, 22, "template", "macro", &[]);
    is(&all, 22, "'", "string", &[]);
    is(&all, 22, "{", "operator", &[]);
    is(&all, 22, " kinds'", "string", &[]);
    is(&all, 22, "json", "function", &["defaultLibrary"]);
    is(&all, 22, "variables", "namespace", &[]);
    is(&all, 23, "graph", "namespace", &["defaultLibrary"]);
    is(&all, 23, "entity", "function", &["defaultLibrary"]);
    is(&all, 23, "label", "property", &[]);
    let kinds: Vec<_> = all.iter().filter(|(line, text, ..)| *line == 22 && text == "kinds").collect();
    assert_eq!(kinds.len(), 2, "{kinds:#?}");
    assert!(
        kinds
            .iter()
            .all(|(_, _, ty, modifiers)| ty == "variable" && modifiers == &["readonly"])
    );
    // A section's inputs and the library's namespaces.
    is(&all, 26, "cond", "macro", &[]);
    is(&all, 26, "change", "parameter", &["readonly", "defaultLibrary"]);
    is(&all, 26, "prose", "namespace", &["defaultLibrary"]);
    is(&all, 26, "code", "function", &["defaultLibrary"]);
    is(&all, 26, "item", "parameter", &["readonly", "defaultLibrary"]);
    is(&all, 26, "null", "keyword", &[]);
}

#[test]
fn tokens_cover_expressions_that_dont_parse_and_nothing_else() {
    common::with_stack(|| {
        let source = "format: projections.comparator\nversion: 0\nvariables:\n  - name: x\n    expression: before.entities.filter(e, e.kind ==\n  - name: y\n    expression: 'graph.'\n";
        let all = tokens(source);
        is(&all, 5, "filter", "macro", &["defaultLibrary"]);
        is(&all, 5, "==", "operator", &[]);
        is(&all, 7, "graph", "namespace", &["defaultLibrary"]);
        // A file that isn't YAML yet has no tokens, rather than wrong ones.
        assert!(tokens("variables:\n  - name: x\n    expression: 'a\n  b: [\n").is_empty());
        // Test files have no CEL.
        let tests = call(json!({"op": "tokens", "kind": "tests", "source": "format: projections.comparator-tests\n"}));
        assert_eq!(tests, json!({"tokens": []}));
    });
}

#[test]
fn tokens_follow_folded_lines_and_escapes() {
    common::with_stack(|| {
        // A plain scalar over two lines, and a double-quoted one with a
        // unicode escape and an escaped line break.
        let source = "format: projections.comparator\nversion: 0\nvariables:\n  - name: a\n    expression: before.schema ==\n      after.schema\n  - name: b\n    expression: \"'\\u00e9' + \\\n      after.schema\"\n";
        let all = tokens(source);
        is(&all, 5, "before", "parameter", &["readonly", "defaultLibrary"]);
        is(&all, 6, "after", "parameter", &["readonly", "defaultLibrary"]);
        is(&all, 8, "'\\u00e9'", "string", &[]);
        is(&all, 9, "schema", "property", &[]);
    });
}

fn diagnostics(source: &str) -> Vec<Value> {
    call(json!({"op": "diagnostics", "source": source}))["diagnostics"]
        .as_array()
        .unwrap()
        .clone()
}

fn at(diagnostic: &Value) -> (u64, u64, u64) {
    (
        diagnostic["line"].as_u64().unwrap(),
        diagnostic["column"].as_u64().unwrap(),
        diagnostic["endColumn"].as_u64().unwrap(),
    )
}

#[test]
fn diagnostics_are_what_loading_reports_where_it_points() {
    common::with_stack(diagnostics_are_what_loading_reports_where_it_points_);
}

fn diagnostics_are_what_loading_reports_where_it_points_() {
    let header = "format: projections.comparator\nversion: 0\n";
    // An unknown function, with its suggestion, and an operator's types.
    let source = format!(
        "{header}variables:\n  - name: a\n    expression: |-\n      graph.entty('after', 'x')\n  - name: b\n    expression: \"size(1) + 'x'\"\n"
    );
    let found = diagnostics(&source);
    assert_eq!(found.len(), 2, "{found:#?}");
    assert_eq!(found[0]["severity"], "error");
    assert_eq!(found[0]["code"], "invalid-rules");
    assert_eq!(found[0]["path"], "/variables/0/expression");
    assert!(
        found[0]["message"]
            .as_str()
            .unwrap()
            .starts_with("Undeclared function `graph.entty`; did you mean `graph.entity`?"),
        "{found:#?}"
    );
    assert_eq!(at(&found[0]), (6, 13, 18));
    assert_eq!(found[1]["message"], "No overload for `+` on (int, string)");
    assert_eq!(at(&found[1]), (8, 26, 27));
    // They are inspect's own diagnostics, each with its position read out.
    let inspected: Value = serde_json::from_slice(&inspect(source.as_bytes())).unwrap();
    for (editor, loaded) in found.iter().zip(inspected["diagnostics"].as_array().unwrap()) {
        assert_eq!(editor["code"], loaded["code"]);
        assert_eq!(editor["path"], loaded["path"]);
        let message = loaded["message"].as_str().unwrap();
        assert!(message.ends_with(editor["message"].as_str().unwrap()), "{message}");
        assert!(message.starts_with(&format!("Line {}, column {}: ", editor["line"], editor["column"])));
    }
    // Positions count characters, after text that isn't ASCII too.
    let found = diagnostics(&format!(
        "{header}variables:\n  - name: a\n    expression: \"'😀 é' + jsno(before.schema) + before.schma\"\n"
    ));
    assert_eq!(at(&found[0]), (5, 26, 30), "{found:#?}");
    assert_eq!(at(&found[1]), (5, 54, 55), "{found:#?}");
    // A macro's misuse.
    let found = diagnostics(&format!(
        "{header}variables:\n  - name: a\n    expression: match(before.schema, {{'x': 1, 'x': 2}}, 0)\n"
    ));
    assert_eq!(found.len(), 1, "{found:#?}");
    assert_eq!(found[0]["line"], 5);
    // CEL that doesn't parse.
    let found = diagnostics(&format!("{header}variables:\n  - name: a\n    expression: before.schema ==\n"));
    assert!(found[0]["message"].as_str().unwrap().starts_with("Invalid CEL"), "{found:#?}");
    assert_eq!(found[0]["line"], 5);
    // YAML that doesn't parse.
    let found = diagnostics("format: [\n");
    assert_eq!(found[0]["severity"], "error");
    assert!(found[0]["line"].as_u64().unwrap() >= 1);
    // A problem with a path but no expression: at the key.
    let found = diagnostics(&format!("{header}classify:\n  where: true\n  sumary: x\n"));
    assert_eq!(found[0]["path"], "/classify/sumary");
    assert_eq!(found[0]["line"], 5);
    // A valid file has none.
    assert!(diagnostics(&format!("{header}variables:\n  - name: a\n    expression: before.schema\n")).is_empty());
}

#[test]
fn lint_warnings_are_warnings() {
    common::with_stack(|| {
        let source = "format: projections.comparator\nversion: 0\nfunctions:\n  rank:\n    params: [{name: level, type: string, values: [low, high]}]\n    body: \"match(level, {'low': 1, 'medium': 2}, 0)\"\nclassify:\n  summary: |-\n    change.status == 'added' ? 'a' : change.status == 'removed' ? 'r' : change.status == 'modified' ? 'm' : 'u'\n";
        let found = diagnostics(source);
        let codes: Vec<&str> = found.iter().map(|item| item["code"].as_str().unwrap()).collect();
        assert_eq!(codes, ["chained-conditional", "match-values", "match-values"], "{found:#?}");
        assert!(found.iter().all(|item| item["severity"] == "warning"));
        // The chain at its first `?`, the `match` at its name.
        assert_eq!(at(&found[0]), (9, 30, 31));
        assert_eq!(at(&found[1]), (6, 12, 17));
    });
}

#[test]
fn test_files_report_their_own_errors() {
    common::with_stack(|| {
        let found = call(json!({"op": "diagnostics", "kind": "tests", "source": "format: projections.comparator-tests\nversion: 0\ncases:\n  - name: one\n    before: a.json\n    expect:\n      count: {chnges: 1}\n"}))["diagnostics"]
            .clone();
        let found = found.as_array().unwrap();
        assert!(!found.is_empty());
        assert_eq!(found[0]["severity"], "error");
        assert_eq!(found[0]["code"], "invalid-tests");
        assert!(found.iter().any(|item| item["line"].as_u64().unwrap() >= 4), "{found:#?}");
        let valid = "format: projections.comparator-tests\nversion: 0\ncases:\n  - name: one\n    before: a.json\n    after: b.json\n    expect:\n      count: {changes: 1}\n";
        assert_eq!(
            call(json!({"op": "diagnostics", "kind": "tests", "source": valid})),
            json!({"diagnostics": []})
        );
    });
}

/// The source position of the `occurrence`th `text` on `line`, plus `offset` characters.
fn position(source: &str, line: usize, text: &str, offset: usize) -> (usize, usize) {
    let found = source
        .lines()
        .nth(line - 1)
        .unwrap()
        .find(text)
        .unwrap_or_else(|| panic!("{text} on {line}"));
    let column = source.lines().nth(line - 1).unwrap()[..found].chars().count() + 1;
    (line, column + offset)
}

fn hover(source: &str, (line, column): (usize, usize)) -> Value {
    call(json!({"op": "hover", "source": source, "line": line, "column": column}))["hover"].clone()
}

#[test]
fn hovers_show_signatures_types_and_documentation() {
    common::with_stack(hovers_show_signatures_types_and_documentation_);
}

fn hovers_show_signatures_types_and_documentation_() {
    let markdown = |line, text, offset| {
        hover(RULES, position(RULES, line, text, offset))["markdown"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    };
    let json_hover = hover(RULES, position(RULES, 22, "json", 1));
    assert!(
        json_hover["markdown"]
            .as_str()
            .unwrap()
            .starts_with("```\njson(value: dyn) -> string\n```\n\nThe value as JSON text"),
        "{json_hover}"
    );
    assert_eq!(
        (&json_hover["line"], &json_hover["column"], &json_hover["endColumn"]),
        (&json!(22), &json!(43), &json!(47))
    );
    assert!(markdown(23, "entity", 0).contains("graph.entity(side: string, id: string) -> Entity"));
    assert!(markdown(13, "match", 2).contains("match(subject, {'key': value, …}, default)"));
    assert!(markdown(19, "distinct", 0).contains("list.distinct() -> list"));
    assert!(markdown(22, "variables.kinds", 12).starts_with(
        "```\nvariables.kinds: list<string>\n```\n\nEvery entity kind, once.\n\n```\nbefore.entities\n  .map(e, e.kind).distinct()\n```"
    ));
    // A template's field reads the variable.
    assert!(markdown(22, "{kinds}", 2).starts_with("```\nvariables.kinds: list<string>"));
    assert!(markdown(26, "change", 0).starts_with("```\nchange: Change\n```\n\nThe change being classified"));
    assert!(markdown(26, "status", 0).starts_with("```\nChange.status: string\n```"));
    assert_eq!(markdown(13, "level", 0), "```\n(parameter) level: string\n```");
    assert_eq!(markdown(19, "e.kind", 0), "```\ne: Entity\n```\n\nA comprehension variable.");
    assert!(markdown(26, "prose", 0).contains("`prose.code`"));
    // Outside CEL, or on a literal, there is none.
    assert_eq!(hover(RULES, (4, 30)), Value::Null);
    assert_eq!(hover(RULES, position(RULES, 13, "''low''", 2)), Value::Null);

    // The file's own functions.
    let source = format!("{RULES}metadata:\n  values:\n    worst: rank('high', item)\n");
    let found = hover(&source, position(&source, 29, "rank", 1));
    assert_eq!(
        found["markdown"],
        "```\nrank(level: string, item: Item) -> int\n```\n\nHow severe a level is."
    );
}

fn complete(source: &str, (line, column): (usize, usize)) -> (Vec<String>, Value) {
    let result = call(json!({"op": "complete", "source": source, "line": line, "column": column}));
    let labels = result["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["label"].as_str().unwrap().to_owned())
        .collect();
    (labels, result)
}

fn with(expression: &str) -> (String, (usize, usize)) {
    let source = format!(
        "format: projections.comparator\nversion: 0\nfunctions:\n  weight:\n    description: A change's weight.\n    params: [{{name: change, type: Change}}]\n    returns: int\n    body: size(change.before)\nvariables:\n  - name: kinds\n    expression: before.entities.map(e, e.kind)\n  - name: mode\n    expression: options.mode\nclassify:\n  summary: |-\n    {expression}\n"
    );
    let column = 4 + expression.chars().count() + 1;
    (source, (16, column))
}

#[test]
fn completions_follow_the_context() {
    common::with_stack(completions_follow_the_context_);
}

fn completions_follow_the_context_() {
    // After `variables.`, the variables in scope, with their types; it
    // doesn't parse, and needn't.
    let (source, at) = with("variables.");
    let (labels, result) = complete(&source, at);
    assert_eq!(labels, ["kinds", "mode"]);
    assert_eq!(result["items"][0]["detail"], "variables.kinds: list<string>");
    assert_eq!(result["range"], json!({"line": 16, "column": 15, "endColumn": 15}));
    // A partial name replaces the name.
    let (source, at) = with("variables.ki");
    let (labels, result) = complete(&source, at);
    assert!(labels.contains(&"kinds".to_owned()));
    assert_eq!(result["range"], json!({"line": 16, "column": 15, "endColumn": 17}));
    // The options the file reads.
    let (labels, _) = complete(&with("options.").0, with("options.").1);
    assert_eq!(labels, ["mode"]);
    // A namespace's functions.
    let (labels, result) = complete(&with("graph.").0, with("graph.").1);
    assert_eq!(labels, ["parents", "children", "entity", "relationship", "depths", "components"]);
    assert_eq!(result["items"][2]["detail"], "graph.entity(side: string, id: string) -> Entity");
    assert_eq!(result["items"][2]["insert"], "entity($0)");
    // A declared type's fields, through a library call's result and a
    // comprehension variable.
    let (labels, _) = complete(&with("change.").0, with("change.").1);
    assert!(
        labels.starts_with(
            &[
                "id",
                "collection",
                "before",
                "after",
                "status",
                "correspondence",
                "varied",
                "summary"
            ]
            .map(String::from)
        ),
        "{labels:?}"
    );
    let (labels, _) = complete(
        &with("graph.entity('after', change.id).").0,
        with("graph.entity('after', change.id).").1,
    );
    assert!(labels.starts_with(&["id", "kind", "label", "data"].map(String::from)), "{labels:?}");
    let (labels, _) = complete(&with("changes.filter(c, c.").0, with("changes.filter(c, c.").1);
    assert!(labels.contains(&"correspondence".to_owned()), "{labels:?}");
    let (labels, _) = complete(&with("item.data.mode.").0, with("item.data.mode.").1);
    assert!(
        labels.contains(&"startsWith".to_owned()) && labels.contains(&"map".to_owned()),
        "{labels:?}"
    );
    // Lists get list methods, strings string methods.
    let (labels, _) = complete(&with("variables.kinds.").0, with("variables.kinds.").1);
    assert!(
        labels.contains(&"exists".to_owned()) && !labels.contains(&"startsWith".to_owned()),
        "{labels:?}"
    );
    let (labels, _) = complete(&with("change.status.").0, with("change.status.").1);
    assert!(
        labels.contains(&"startsWith".to_owned()) && !labels.contains(&"exists".to_owned()),
        "{labels:?}"
    );
    // Anything else: the section's names, the file's functions, the macros and the library.
    let (labels, result) = complete(&with("size(").0, with("size(").1);
    for expected in [
        "change",
        "item",
        "before",
        "variables",
        "weight",
        "match",
        "template",
        "json",
        "graph",
        "size",
        "has",
        "true",
    ] {
        assert!(labels.contains(&expected.to_owned()), "{expected}: {labels:?}");
    }
    let weight = result["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["label"] == "weight")
        .unwrap();
    assert_eq!(weight["detail"], "weight(change: Change) -> int");
    assert_eq!(weight["documentation"], "A change's weight.");
    // Identity-pass names aren't in `classify`.
    assert!(!labels.contains(&"side".to_owned()));
    // Nothing inside a string, or outside CEL.
    assert!(complete(&with("'abc").0, with("'abc").1).0.is_empty());
    assert!(complete(&with("x").0, (5, 10)).0.is_empty());
}

#[test]
fn every_library_function_has_parameter_names_and_every_cel_function_docs() {
    use projections_rules_editor::docs;
    let named: Vec<&str> = docs::PARAMS.iter().map(|(name, _)| *name).collect();
    let library: Vec<&str> = projections_comparator_rules::library::LIBRARY
        .iter()
        .map(|function| function.name)
        .collect();
    assert_eq!(named, library);
    for function in projections_comparator_rules::library::LIBRARY {
        let names = docs::PARAMS.iter().find(|(name, _)| *name == function.name).unwrap().1;
        assert_eq!(names.len(), (function.params)().len(), "{}", function.name);
    }
    for name in projections_comparator_rules::check::CEL {
        if name.starts_with('@') || name.contains(".@") {
            continue;
        }
        assert!(
            docs::BUILTINS.iter().chain(docs::CEL_MACROS).any(|doc| doc.name == *name),
            "{name} has no documentation"
        );
    }
}

#[test]
fn requests_are_checked() {
    assert!(call(json!({"op": "tokens"}))["error"].is_string());
    assert!(call(json!({"op": "nope", "source": ""}))["error"].is_string());
    assert!(call(json!({"op": "hover", "source": ""}))["error"].is_string());
    assert!(call(json!({"op": "tokens", "source": "", "kind": "x"}))["error"].is_string());
    assert!(serde_json::from_slice::<Value>(&edit(b"\xff")).unwrap()["error"].is_string());
}
