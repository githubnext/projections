//! A theme seed for the viewer's page (`projections view --theme`): an
//! embedding app's few colors and families for each color mode, which the page
//! maps onto its whole theme (host core's `parseThemeSeed` and
//! `appThemeTokens`). It is checked here as the page checks it, so a seed the
//! page would ignore is refused before its link is printed, and it reaches the
//! page only in that link's `?theme=`.

use std::path::Path;

use anyhow::{Context as _, Result, bail};
use regex::Regex;
use serde_json::Value;

/// The keys a mode's seed may have, colors then families (`themeSeedKeys`).
const KEYS: [&str; 8] = ["background", "text", "muted", "border", "accent", "focus", "sans", "mono"];
const FAMILIES: [&str; 2] = ["sans", "mono"];
/// A value's longest, the renderer protocol's token length.
const VALUE_LENGTH: usize = 512;
/// The longest seed, as JSON text (`themeSeedMaxLength`).
const SEED_LENGTH: usize = 4096;

/// A theme seed from `--theme`: inline JSON (starting with `{`), else a JSON
/// file's path. Returns its compact JSON, the value of the page's `?theme=`.
pub fn read(argument: &str) -> Result<String> {
    let text = if argument.trim_start().starts_with('{') {
        argument.to_owned()
    } else {
        let path = Path::new(argument);
        std::fs::read_to_string(path).with_context(|| format!("Cannot read the theme {}", path.display()))?
    };
    let value: Value = serde_json::from_str(&text).context("The theme isn't JSON")?;
    let text = format(&check(&value).map_err(anyhow::Error::msg)?);
    if text.len() > SEED_LENGTH {
        bail!("The theme is longer than {SEED_LENGTH} characters");
    }
    Ok(text)
}

/// A seed checked whole, as the page's `parseThemeSeed` checks it: an object
/// with `light`, `dark` or both, each with a `background` and only the other
/// keys, every color one the page parses and every family a plain font list.
/// Returns its modes' trimmed values in the contract's key order, or what is
/// wrong.
pub fn check(value: &Value) -> Result<Seed, String> {
    let Some(modes) = value.as_object() else {
        return Err(r#"The theme must be an object with "light", "dark" or both"#.into());
    };
    if let Some(mode) = modes.keys().find(|key| !["light", "dark"].contains(&key.as_str())) {
        return Err(format!(r#"The theme has "{mode}"; it takes only "light" and "dark""#));
    }
    let mut seed = Vec::new();
    for mode in ["light", "dark"] {
        let Some(colors) = modes.get(mode) else { continue };
        let Some(colors) = colors.as_object() else {
            return Err(format!("theme.{mode} must be an object"));
        };
        if let Some(key) = colors.keys().find(|key| !KEYS.contains(&key.as_str())) {
            return Err(format!(r#"theme.{mode} has "{key}"; it takes {}"#, KEYS.join(", ")));
        }
        if !colors.contains_key("background") {
            return Err(format!(r#"theme.{mode} needs a "background""#));
        }
        let mut checked = Vec::new();
        for key in KEYS {
            let Some(text) = colors.get(key) else { continue };
            let at = format!("theme.{mode}.{key}");
            let Some(text) = text.as_str() else {
                return Err(format!("{at} must be a string"));
            };
            if text.chars().count() > VALUE_LENGTH {
                return Err(format!("{at} is longer than {VALUE_LENGTH} characters"));
            }
            if FAMILIES.contains(&key) {
                if !font_list(text) {
                    return Err(format!("{at} isn't a font family list: plain or quoted names, separated by commas"));
                }
            } else if !color(text) {
                return Err(format!("{at} isn't a color: use #rgb, #rrggbb, #rrggbbaa, rgb() or rgba()"));
            }
            checked.push((key, text.trim().to_owned()));
        }
        seed.push((mode, checked));
    }
    if seed.is_empty() {
        return Err(r#"The theme must have "light", "dark" or both"#.into());
    }
    Ok(seed)
}

/// A checked seed: each mode it has, light first, with its values by key.
pub type Seed = Vec<(&'static str, Vec<(&'static str, String)>)>;

/// A seed's compact JSON, in the order `check` gives (host core's `formatThemeSeed`).
fn format(seed: &Seed) -> String {
    let quote = |text: &str| Value::String(text.into()).to_string();
    let modes: Vec<String> = seed
        .iter()
        .map(|(mode, values)| {
            let values: Vec<String> = values
                .iter()
                .map(|(key, value)| format!("{}:{}", quote(key), quote(value)))
                .collect();
            format!("{}:{{{}}}", quote(mode), values.join(","))
        })
        .collect();
    format!("{{{}}}", modes.join(","))
}

/// A color the page's `parseColor` reads: hex, `rgb()`/`rgba()` or `transparent`.
fn color(text: &str) -> bool {
    let text = text.trim().to_ascii_lowercase();
    if Regex::new(r"^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$").unwrap().is_match(&text) || text == "transparent" {
        return true;
    }
    let Some(inner) = Regex::new(r"^rgba?\(\s*([^)]+)\)$").unwrap().captures(&text) else {
        return false;
    };
    let parts: Vec<&str> = Regex::new(r"[\s,/]+")
        .unwrap()
        .split(inner.get(1).map_or("", |inner| inner.as_str()))
        .filter(|part| !part.is_empty())
        .collect();
    (3..=4).contains(&parts.len())
        && parts
            .iter()
            .all(|part| part.strip_suffix('%').unwrap_or(part).parse::<f64>().is_ok_and(f64::is_finite))
}

/// A font family list the page sends as a token (`fontList`): plain and quoted
/// names, no functions, braces or semicolons.
fn font_list(text: &str) -> bool {
    let text = Regex::new(r"\s+").unwrap().replace_all(text.trim(), " ");
    let name = r#"(?:"[^"\\;{}<>]+"|'[^'\\;{}<>]+'|[A-Za-z0-9_ -]+)"#;
    !text.is_empty() && Regex::new(&format!(r"^{name}(?:\s*,\s*{name})*$")).unwrap().is_match(&text)
}

/// `url` with the seed in its `?theme=`, beside a named viewer's `?viewer=`.
pub fn link(url: &str, seed: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}theme={}", super::show::encode(seed))
}

/// `text` with every mention of exactly `url` (not a longer URL it begins,
/// such as a named viewer's) given the seed, as [`link`] gives it.
pub fn relink(text: &str, url: &str, seed: &str) -> String {
    if url.is_empty() {
        return text.to_owned();
    }
    let seeded = link(url, seed);
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(url) {
        let after = &rest[at + url.len()..];
        // A URL goes on past a sentence's full stop only when more of it follows.
        let mut next = after.chars();
        let longer = match next.next() {
            Some('.') => next.next().is_some_and(|then| then.is_ascii_alphanumeric()),
            Some(character) => character.is_ascii_alphanumeric() || "?&=#/%-_~".contains(character),
            None => false,
        };
        out.push_str(&rest[..at]);
        out.push_str(if longer { url } else { &seeded });
        rest = after;
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_seed_is_compact_trimmed_and_in_contract_order() {
        let seed = read(
            r##"{"dark": {"accent": "#d97757", "background": "#1f1e1c"}, "light": {"border": " #e4e2dd ", "background": "#f7f6f3", "sans": "Inter, 'Segoe UI', sans-serif"}}"##,
        )
        .unwrap();
        assert_eq!(
            seed,
            r##"{"light":{"background":"#f7f6f3","border":"#e4e2dd","sans":"Inter, 'Segoe UI', sans-serif"},"dark":{"background":"#1f1e1c","accent":"#d97757"}}"##
        );
        let seed = r##"{"light":{"background":"#fff"}}"##;
        let theme = "theme=%7B%22light%22%3A%7B%22background%22%3A%22%23fff%22%7D%7D";
        assert_eq!(
            link("http://127.0.0.1:1/T/?viewer=side", seed),
            format!("http://127.0.0.1:1/T/?viewer=side&{theme}")
        );
        // Only the shown viewer's URL is given the seed, not another viewer's that begins with it.
        let text =
            "Showing A in the viewer: http://h/T/\nIt shows A at http://h/T/; side shows B at http://h/T/?viewer=side. See http://h/T/.";
        assert_eq!(
            relink(text, "http://h/T/", seed),
            format!(
                "Showing A in the viewer: http://h/T/?{theme}\nIt shows A at http://h/T/?{theme}; side shows B at http://h/T/?viewer=side. See http://h/T/?{theme}."
            )
        );
    }

    #[test]
    fn a_seed_is_read_from_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("theme.json");
        std::fs::write(&file, r#"{"light":{"background":"rgb(247 246 243)"}}"#).unwrap();
        assert_eq!(
            read(file.to_str().unwrap()).unwrap(),
            r#"{"light":{"background":"rgb(247 246 243)"}}"#
        );
        assert!(
            read(directory.path().join("missing.json").to_str().unwrap())
                .unwrap_err()
                .to_string()
                .starts_with("Cannot read the theme")
        );
    }

    #[test]
    fn a_seed_is_refused_unless_every_value_is_a_color_or_a_font_list() {
        for (value, message) in [
            (json!(["#fff"]), "must be an object"),
            (json!({}), r#"must have "light", "dark" or both"#),
            (json!({"sepia": {"background": "#fff"}}), r#""sepia""#),
            (
                json!({"light": {"background": "#fff", "surface": "#eee"}}),
                r#"theme.light has "surface""#,
            ),
            (json!({"dark": {"text": "#fff"}}), r#"theme.dark needs a "background""#),
            (
                json!({"light": {"background": 16777215}}),
                "theme.light.background must be a string",
            ),
            (json!({"light": {"background": "white"}}), "theme.light.background isn't a color"),
            (json!({"light": {"background": "#fff;}body{display:none"}}), "isn't a color"),
            (
                json!({"light": {"background": "#fff", "border": "url(x)"}}),
                "theme.light.border isn't a color",
            ),
            (json!({"light": {"background": "rgb(1, 2)"}}), "isn't a color"),
            (
                json!({"light": {"background": "#fff", "sans": "Inter;}*{color:red"}}),
                "theme.light.sans isn't a font",
            ),
            (json!({"light": {"background": "#fff", "mono": "a".repeat(600)}}), "longer than 512"),
        ] {
            let error = check(&value).unwrap_err();
            assert!(error.contains(message), "{value}: {error}");
        }
        assert!(
            check(&json!({"light": {"background": "rgba(0, 0, 0, 50%)", "focus": "#0969DA", "mono": "ui-monospace, \"SF Mono\""}})).is_ok()
        );
    }
}
