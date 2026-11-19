//! `$(NAME)` and `${NAME}` references, with the modifiers module names use
//! (`$(PRODUCT_NAME:c99extidentifier)`).

use super::Settings;

/// `value` with every reference replaced, or `None` when one names a setting
/// that isn't set or a modifier this reader doesn't apply.
pub(crate) fn expand(settings: &Settings, value: &str) -> Option<String> {
    expand_at(settings, value, 0)
}

fn expand_at(settings: &Settings, value: &str, depth: usize) -> Option<String> {
    if depth > 32 {
        return None;
    }
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('$') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let close = match after.chars().next() {
            Some('(') => ')',
            Some('{') => '}',
            _ => {
                out.push('$');
                rest = after;
                continue;
            }
        };
        let end = after.find(close)?;
        let reference = &after[1..end];
        let mut parts = reference.split(':');
        let name = parts.next()?;
        let mut resolved = expand_at(settings, settings.get(name)?, depth + 1)?;
        for modifier in parts {
            resolved = modify(&resolved, modifier)?;
        }
        out.push_str(&resolved);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

fn modify(value: &str, modifier: &str) -> Option<String> {
    Some(match modifier {
        "c99extidentifier" | "identifier" => {
            let replaced: String = value
                .chars()
                .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
                .collect();
            if replaced.starts_with(|c: char| c.is_ascii_digit()) {
                format!("_{replaced}")
            } else {
                replaced
            }
        }
        "rfc1034identifier" => value
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '.' {
                    c
                } else {
                    '-'
                }
            })
            .collect(),
        "lower" => value.to_lowercase(),
        "upper" => value.to_uppercase(),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_references_and_module_name_modifiers() {
        let settings: Settings = [
            ("TARGET_NAME", "Harbor Widgets"),
            ("PRODUCT_NAME", "$(TARGET_NAME)"),
            ("PRODUCT_MODULE_NAME", "$(PRODUCT_NAME:c99extidentifier)"),
            ("BUNDLE", "com.example.${PRODUCT_NAME:rfc1034identifier:lower}"),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect();
        assert_eq!(expand(&settings, "$(PRODUCT_MODULE_NAME)").as_deref(), Some("Harbor_Widgets"));
        assert_eq!(expand(&settings, "$(BUNDLE)").as_deref(), Some("com.example.harbor-widgets"));
        assert_eq!(expand(&settings, "$(UNSET)"), None);
        assert_eq!(expand(&settings, "$(TARGET_NAME:base)"), None);
        assert_eq!(expand(&settings, "a$b").as_deref(), Some("a$b"));
    }
}
