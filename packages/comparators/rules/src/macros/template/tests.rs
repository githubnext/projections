use super::parse_template;

#[test]
fn templates_name_fields_and_escape_braces_and_percents() {
    assert_eq!(
        parse_template("{a} is 100% {{b}} {c}").unwrap(),
        ("%s is 100%% {b} %s".to_owned(), vec!["a".to_owned(), "c".to_owned()])
    );
    assert!(parse_template("{a").is_err());
    assert!(parse_template("a}").is_err());
    assert!(parse_template("{a b}").is_err());
}
