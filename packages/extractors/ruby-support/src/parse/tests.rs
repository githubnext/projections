use crate::ast::{Arg, Expr, Kind, Stmt};
use crate::parse;

fn one(source: &str) -> Stmt {
    let mut statements = parse(source, "test.rb").unwrap();
    assert_eq!(statements.len(), 1, "{statements:#?}");
    statements.remove(0)
}

fn expr(source: &str) -> Expr {
    match one(source) {
        Stmt::Expr(expr) => expr,
        other => panic!("{other:?}"),
    }
}

#[test]
fn parses_command_calls_with_pairs_and_do_blocks() {
    let expr = expr(
        "create_table \"users\", force: :cascade do |t|\n  t.string \"email\", null: false\n  t.index [\"email\"], unique: true\nend\n",
    );
    let call = expr.call().unwrap();
    assert_eq!(call.name, "create_table");
    assert_eq!(call.positional().next().unwrap().name(), Some("users"));
    assert_eq!(call.option("force").unwrap().name(), Some("cascade"));
    let block = call.block.as_ref().unwrap();
    assert_eq!(block.params, ["t"]);
    let Stmt::Expr(index) = &block.body[1] else { panic!() };
    let index = index.call().unwrap();
    assert_eq!(index.receiver.as_ref().unwrap().text, "t");
    assert_eq!(index.positional().next().unwrap().names().unwrap(), ["email"]);
    assert_eq!(index.option("unique").unwrap().kind, Kind::Bool(true));
    assert_eq!(expr.line, 1);
}

#[test]
fn binds_do_to_the_outer_command_and_braces_to_the_nearest_call() {
    let call = expr("resources :photos, only: index do\n  get :x\nend").call().cloned().unwrap();
    assert!(call.block.is_some());
    let Arg::Pair(_, only) = &call.args[1] else { panic!() };
    assert!(only.call().unwrap().block.is_none());
    let lambda = expr("t.datetime \"at\", default: -> { \"CURRENT_TIMESTAMP\" }")
        .call()
        .cloned()
        .unwrap();
    let Kind::Lambda(block) = &lambda.option("default").unwrap().kind else {
        panic!()
    };
    let Stmt::Expr(body) = &block.body[0] else { panic!() };
    assert_eq!(body.string(), Some("CURRENT_TIMESTAMP"));
}

#[test]
fn parses_method_chains_constants_and_hash_rockets() {
    let call = expr("Rails.application.routes.draw do\nend").call().cloned().unwrap();
    assert_eq!(call.name, "draw");
    assert_eq!(call.receiver.unwrap().text, "Rails.application.routes");
    let mount = expr("mount Sidekiq::Web => \"/sidekiq\", as: :jobs").call().cloned().unwrap();
    let (key, value) = mount.pairs().next().unwrap();
    assert_eq!(key.kind, Kind::Const("Sidekiq::Web".into()));
    assert_eq!(value.string(), Some("/sidekiq"));
    let chained = expr("Foo\n  .bar(1)\n  .baz").call().cloned().unwrap();
    assert_eq!(chained.name, "baz");
    let hash = expr("x({a: 1, \"b\" => [2, 3], c: {d: nil}})").call().cloned().unwrap();
    let hash = hash.positional().next().unwrap();
    assert!(hash.literal());
    assert_eq!(hash.get("c").unwrap().get("d").unwrap().kind, Kind::Nil);
}

#[test]
fn keeps_operators_and_unknown_statements_as_text() {
    let call = expr("get \"x\", constraints: lambda { |r| r.admin? && r.ok }")
        .call()
        .cloned()
        .unwrap();
    assert!(matches!(call.option("constraints").unwrap().kind, Kind::Lambda(_)));
    let assigned = expr("x = 1 + 2");
    assert_eq!((assigned.kind, assigned.text.as_str()), (Kind::Other, "x = 1 + 2"));
    let statements = parse("def helper(a)\n  a + 1\nend\ncase x\nwhen 1 then y\nend\nfoo\n", "t.rb").unwrap();
    assert!(matches!(&statements[0], Stmt::Other { line: 1, text } if text.starts_with("def helper")));
    assert!(matches!(&statements[1], Stmt::Other { line: 4, text } if text.ends_with("end")));
    assert!(matches!(&statements[2], Stmt::Expr(e) if e.text == "foo"));
    let each = one("%w[a b].each do |name|\n  get name\nend");
    let Stmt::Expr(each) = each else { panic!() };
    assert_eq!(each.call().unwrap().name, "each");
}

#[test]
fn parses_conditionals_and_modifiers() {
    let Stmt::If {
        condition,
        negated,
        then,
        otherwise,
        ..
    } = one("if Rails.env.development?\n  get \"a\"\nelsif x\n  get \"b\"\nelse\n  get \"c\"\nend")
    else {
        panic!()
    };
    assert_eq!((condition.as_str(), negated, then.len()), ("Rails.env.development?", false, 1));
    let Stmt::If { otherwise: last, .. } = &otherwise[0] else {
        panic!()
    };
    assert_eq!(last.len(), 1);
    let Stmt::If { condition, negated, .. } = one("get \"a\" unless ENV[\"X\"]") else {
        panic!()
    };
    assert_eq!((condition.as_str(), negated), ("ENV[\"X\"]", true));
}

#[test]
fn reports_unbalanced_source() {
    assert!(parse("foo do\n  bar\n", "f.rb").unwrap_err().to_string().starts_with("f.rb:"));
    assert!(parse("end\n", "f.rb").is_err());
}
