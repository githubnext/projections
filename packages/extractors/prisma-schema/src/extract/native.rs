//! Native database type names.

/// A `@db.*` native type as the database names it: lowercase, arguments
/// joined without spaces (`@db.VarChar(200)` is `varchar(200)`,
/// `@db.Decimal(10, 2)` is `decimal(10,2)`), with Prisma's compound names
/// spelled out (`DoublePrecision` is `double precision`, MySQL's
/// `UnsignedInt` is `int unsigned`).
pub fn database_type(name: &str, args: &[String]) -> String {
    let base = match name {
        "DoublePrecision" => "double precision".to_owned(),
        _ => match name.strip_prefix("Unsigned") {
            Some(integer) if !integer.is_empty() => format!("{} unsigned", integer.to_lowercase()),
            _ => name.to_lowercase(),
        },
    };
    if args.is_empty() {
        return base;
    }
    let args = args.iter().map(|arg| arg.to_lowercase()).collect::<Vec<_>>().join(",");
    match base.split_once(' ') {
        // Arguments follow the type name, before a modifier: `int(10) unsigned`.
        Some((head, modifier)) if name.starts_with("Unsigned") => {
            format!("{head}({args}) {modifier}")
        }
        _ => format!("{base}({args})"),
    }
}
