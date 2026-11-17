use super::Inflections;
use crate::parse;

#[test]
fn matches_activesupport_defaults() {
    let inflections = Inflections::default();
    for (singular, plural) in [
        ("user", "users"),
        ("category", "categories"),
        ("address", "addresses"),
        ("person", "people"),
        ("salesperson", "salespeople"),
        ("child", "children"),
        ("status", "statuses"),
        ("analysis", "analyses"),
        ("wife", "wives"),
        ("half", "halves"),
        ("matrix", "matrices"),
        ("index", "indices"),
        ("mouse", "mice"),
        ("ox", "oxen"),
        ("quiz", "quizzes"),
        ("medium", "media"),
        ("bus", "buses"),
        ("tomato", "tomatoes"),
        ("line_item", "line_items"),
        ("equipment", "equipment"),
        ("news", "news"),
        ("series", "series"),
        ("database", "databases"),
        ("movie", "movies"),
        ("octopus", "octopi"),
        ("hive", "hives"),
    ] {
        assert_eq!(inflections.pluralize(singular), plural, "pluralize {singular}");
        assert_eq!(inflections.singularize(plural), singular, "singularize {plural}");
    }
    assert_eq!(inflections.singularize("user_information"), "user_information");
    assert_eq!(inflections.pluralize("user_information"), "user_informations");
}

#[test]
fn reads_an_applications_inflections() {
    let source = "ActiveSupport::Inflector.inflections(:en) do |inflect|\n  inflect.irregular \"cactus\", \"cacti\"\n  inflect.uncountable %w[metadata]\n  inflect.plural /^(ox)$/i, '\\1es'\n  inflect.acronym \"API\"\n  inflect.clear\nend\n";
    let mut inflections = Inflections::default();
    inflections.read(&parse(source, "inflections.rb").unwrap());
    assert_eq!(inflections.pluralize("cactus"), "cacti");
    assert_eq!(inflections.singularize("cacti"), "cactus");
    assert_eq!(inflections.pluralize("metadata"), "metadata");
    assert_eq!(inflections.pluralize("ox"), "oxes");
    assert_eq!(inflections.unread, ["inflect.clear"]);
}
