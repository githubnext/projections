use super::*;

fn one(source: &str) -> Block {
    let mut blocks = parse(source, "schema.prisma", 0).unwrap();
    assert_eq!(blocks.len(), 1);
    blocks.remove(0)
}

fn error(source: &str) -> String {
    parse(source, "schema.prisma", 0).unwrap_err().to_string()
}

#[test]
fn parses_fields_modifiers_and_attributes() {
    let model = one(
        "/// Docs\nmodel User { // trailing\n  id Int @id @default(autoincrement())\n  name String? @db.VarChar(10)\n  tags String[]\n  raw Unsupported(\"tsvector\")?\n\n  @@index([name(sort: Desc), tags], map: \"x\")\n}\n",
    );
    assert_eq!(model.kind, BlockKind::Model);
    assert_eq!(model.name, "User");
    let arities: Vec<_> = model.fields.iter().map(|f| f.arity).collect();
    assert_eq!(arities, [Arity::Required, Arity::Optional, Arity::List, Arity::Optional]);
    assert_eq!(model.fields[3].ty, TypeName::Unsupported("tsvector".into()));
    assert_eq!(model.fields[1].attributes[0].name, "db.VarChar");
    assert_eq!(model.fields[1].attributes[0].args[0].value, Expr::Number("10".into()));
    assert_eq!(model.fields[0].span.line, 3);
    let index = &model.attributes[0];
    assert_eq!(index.name, "index");
    assert_eq!(index.span.line, 8);
    assert_eq!(index.args[1].name.as_deref(), Some("map"));
    let Expr::Array(fields) = &index.args[0].value else { panic!() };
    assert_eq!(
        fields[0],
        Expr::Call(
            "name".into(),
            vec![Arg {
                name: Some("sort".into()),
                value: Expr::Ident("Desc".into())
            }]
        )
    );
}

#[test]
fn arguments_and_arrays_span_lines_with_trailing_commas() {
    let model = one("model A {\n  id Int\n  @@id(\n    [\n      id,\n    ],\n    map: \"pk\",\n  )\n}");
    assert_eq!(model.attributes[0].args.len(), 2);
}

#[test]
fn parses_datasources_generators_and_enums() {
    let blocks = parse(
            "datasource db {\n  provider = \"postgresql\"\n  url = env(\"URL\")\n  extensions = [pg_trgm, postgis(version: \"2.1\")]\n}\ngenerator client {\n  provider = \"prisma-client-js\"\n}\nenum Role {\n  USER\n  ADMIN @map(\"admin\")\n  @@map(\"roles\")\n}\ntype Address {\n  city String\n}\nview V {\n  id Int @unique\n}\n",
            "schema.prisma",
            0,
        )
        .unwrap();
    let kinds: Vec<_> = blocks.iter().map(|b| b.kind).collect();
    assert_eq!(
        kinds,
        [
            BlockKind::Datasource,
            BlockKind::Generator,
            BlockKind::Enum,
            BlockKind::Type,
            BlockKind::View
        ]
    );
    assert_eq!(
        blocks[0].properties[1].1,
        Expr::Call(
            "env".into(),
            vec![Arg {
                name: None,
                value: Expr::String("URL".into())
            }]
        )
    );
    assert_eq!(blocks[2].values.len(), 2);
    assert_eq!(blocks[2].values[1].attributes[0].name, "map");
}

#[test]
fn decodes_string_escapes() {
    let model = one("model A {\n  s String @default(\"q\\\"uote \\\\ \\n \\t \\u0041 \\ud83d\\ude00 // not a comment\")\n}");
    assert_eq!(
        model.fields[0].attributes[0].args[0].value,
        Expr::String("q\"uote \\ \n \t A 😀 // not a comment".into())
    );
}

#[test]
fn numbers_and_identifiers() {
    let model = one("model A {\n  a Int @default(-1)\n  b Float @default(2.50)\n  c-d Int\n}");
    assert_eq!(model.fields[0].attributes[0].args[0].value, Expr::Number("-1".into()));
    assert_eq!(model.fields[1].attributes[0].args[0].value, Expr::Number("2.50".into()));
    assert_eq!(model.fields[2].name, "c-d");
}

#[test]
fn rejects_malformed_input_with_locations() {
    assert!(error("model Nope { unknown syntax }").contains("schema.prisma:1"));
    assert!(error("model A {\n  id Int }").contains("expected end of line"));
    assert!(parse("model A {}\n", "schema.prisma", 0).is_ok());
    assert!(error("model A {\n  id Int\n").contains("unclosed model A"));
    assert!(error("table A {}").contains("unknown block `table`"));
    assert!(error("model A {\n  id Int @id @\n}").contains(":2"));
    assert!(error("model A {\n  s String @default(\"open\n}").contains("unterminated"));
    assert!(error("model A {\n  s String @default(\"\\q\")\n}").contains("unknown escape"));
    assert!(error("model A {\n  s String[]?\n}").contains("optional lists"));
    assert!(error("model A {\n  a Int b Int\n}").contains("expected end of line"));
    assert!(error("model A {\n  a Int\n} }").contains("expected a datasource"));
    assert!(error("datasource db {\n  provider \"x\"\n}").contains("expected `=`"));
    assert!(error("model A {\n  a Int /* block */\n}").contains("unexpected character"));
    assert!(error("datasource db {\n  @@map(\"x\")\n}").contains("cannot have attributes"));
    assert!(error("model A {\n  a Int @default(12abc)\n}").contains("invalid number"));
}
