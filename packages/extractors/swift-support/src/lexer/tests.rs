use super::*;

fn texts(source: &str) -> Vec<String> {
    tokens(source).unwrap().into_iter().map(|token| token.text).collect()
}

#[test]
fn drops_comments_and_keeps_directives_and_operators() {
    assert_eq!(
        texts("/* a /* nested */ b */ let x = [1, 2] // done\n#if os(Linux)\nlet y = \"1.0.0\"..<\"2.0.0\"\n#endif"),
        [
            "let", "x", "=", "[", "1", ",", "2", "]", "#if", "os", "(", "Linux", ")", "let", "y", "=", "1.0.0", "..<", "2.0.0", "#endif"
        ]
    );
    assert_eq!(
        texts("a...b x+=[y] `default`"),
        ["a", "...", "b", "x", "+=", "[", "y", "]", "default"]
    );
}

#[test]
fn reads_string_literals() {
    let all = tokens(
        r####""a\"b\u{41}" #"raw \(x)"# "\(name)s" """
    first
      second
    """"####,
    )
    .unwrap();
    assert_eq!(all[0].text, "a\"bA");
    assert_eq!(all[1].kind, Kind::Str { interpolated: false });
    assert_eq!(all[1].text, r"raw \(x)");
    assert_eq!(all[2].kind, Kind::Str { interpolated: true });
    assert_eq!(all[3].text, "first\n  second");
}

#[test]
fn counts_lines() {
    let all = tokens("a\n/* x\ny */\nb \"\"\"\n\n\"\"\" c").unwrap();
    assert_eq!(all.iter().map(|token| token.line).collect::<Vec<_>>(), [1, 4, 4, 6]);
}

#[test]
fn rejects_unterminated_literals() {
    assert!(tokens("\"abc").is_err());
    assert!(tokens("/* abc").is_err());
}
