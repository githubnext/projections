use super::database_type;

#[test]
fn native_types_read_as_the_database_names_them() {
    let args = |values: &[&str]| values.iter().map(|v| v.to_string()).collect::<Vec<_>>();
    for (name, arguments, expected) in [
        ("VarChar", args(&["200"]), "varchar(200)"),
        ("Decimal", args(&["10", "2"]), "decimal(10,2)"),
        ("Uuid", args(&[]), "uuid"),
        ("Timestamptz", args(&["6"]), "timestamptz(6)"),
        ("DoublePrecision", args(&[]), "double precision"),
        ("UnsignedInt", args(&[]), "int unsigned"),
        ("UnsignedTinyInt", args(&["1"]), "tinyint(1) unsigned"),
        ("NVarChar", args(&["Max"]), "nvarchar(max)"),
    ] {
        assert_eq!(database_type(name, &arguments), expected, "{name}");
    }
}
