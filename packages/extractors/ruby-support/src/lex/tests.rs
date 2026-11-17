use super::{Token, lex};

fn tokens(source: &str) -> Vec<Token> {
    lex(source, "test.rb").unwrap().into_iter().map(|t| t.token).collect()
}

fn string(value: &str) -> Token {
    Token::Str {
        value: value.into(),
        interpolated: false,
    }
}

#[test]
fn reads_labels_symbols_strings_and_numbers() {
    assert_eq!(
        tokens("t.string \"name\", limit: 20, default: -1.5 # note\n"),
        [
            Token::Ident("t".into()),
            Token::Op("."),
            Token::Ident("string".into()),
            string("name"),
            Token::Op(","),
            Token::Label("limit".into()),
            Token::Number("20".into()),
            Token::Op(","),
            Token::Label("default".into()),
            Token::Op("-"),
            Token::Number("1.5".into()),
            Token::Newline,
            Token::Newline,
            Token::End,
        ]
    );
    assert_eq!(
        tokens(":foo? :\"a b\" Foo::Bar 2024_01_02")[..5],
        [
            Token::Symbol("foo?".into()),
            Token::Symbol("a b".into()),
            Token::Const("Foo".into()),
            Token::Op("::"),
            Token::Const("Bar".into()),
        ]
    );
    assert_eq!(tokens("2024_01_02")[0], Token::Number("20240102".into()));
    assert_eq!(tokens("\"key\": 1")[0], Token::Label("key".into()));
}

#[test]
fn decodes_escapes_and_keeps_interpolation() {
    assert_eq!(tokens(r#""a\"b\n""#)[0], string("a\"b\n"));
    assert_eq!(tokens(r"'a\'b\n'")[0], string("a'b\\n"));
    assert_eq!(
        tokens(r#""x#{y + "}"}z""#)[0],
        Token::Str {
            value: "x#{y + \"}\"}z".into(),
            interpolated: true
        }
    );
}

#[test]
fn reads_word_arrays_regexes_and_percent_strings() {
    assert_eq!(
        tokens("only: %i[index show]")[1],
        Token::Words {
            items: vec!["index".into(), "show".into()],
            symbols: true
        }
    );
    assert_eq!(
        tokens("%w(a b)")[0],
        Token::Words {
            items: vec!["a".into(), "b".into()],
            symbols: false
        }
    );
    assert_eq!(tokens("id: /\\d+\\/x/i")[1], Token::Regex("\\d+\\/x".into()));
    assert_eq!(tokens("x %r{a/b}")[1], Token::Regex("a/b".into()));
    assert_eq!(tokens("a / b")[1], Token::Op("/"));
    assert_eq!(tokens("%q(it's (fine))")[0], string("it's (fine)"));
}

#[test]
fn reads_heredoc_bodies_after_their_line() {
    let lexed = lex(
        "create_view \"v\", sql_definition: <<~SQL, x: 1\n    SELECT 1\n      FROM t\n  SQL\nnext_call\n",
        "test.rb",
    )
    .unwrap();
    let tokens: Vec<_> = lexed.iter().map(|t| &t.token).collect();
    assert_eq!(tokens[4], &string("SELECT 1\n  FROM t\n"));
    assert_eq!(tokens[6], &Token::Label("x".into()));
    let next = lexed.iter().find(|t| t.token == Token::Ident("next_call".into())).unwrap();
    assert_eq!(next.line, 5);
    assert!(
        lex("x = <<-EOS\nbody\n", "test.rb")
            .unwrap_err()
            .to_string()
            .contains("not terminated")
    );
}

#[test]
fn skips_comments_block_comments_and_data() {
    assert_eq!(
        tokens("=begin\nanything\n=end\na # b\n__END__\nignored(")[..2],
        [Token::Ident("a".into()), Token::Newline]
    );
    let lexed = lex("=begin\nx\n=end\nfoo", "test.rb").unwrap();
    assert_eq!(lexed[0].line, 4);
}

#[test]
fn reports_unterminated_strings_with_their_line() {
    assert_eq!(lex("\n\"open", "f.rb").unwrap_err().to_string(), "f.rb:2: unterminated string");
}
