//! Selector filters (`matchArgs`, `matchPIDs`, …) as conditions with display text.

use super::values::{flag, scalar, scalars};
use crate::terms::Terms;
use anyhow::Result;
use serde_json::{Map, Value, json};

fn operator_phrase(operator: &str) -> &str {
    match operator {
        "Equal" => "=",
        "NotEqual" => "≠",
        "Prefix" => "starts with",
        "NotPrefix" => "doesn't start with",
        "Postfix" => "ends with",
        "NotPostfix" => "doesn't end with",
        "GreaterThan" | "GT" => ">",
        "LessThan" | "LT" => "<",
        "Mask" => "has any bits of",
        "InMap" => "in",
        "NotInMap" => "not in",
        "InRange" => "in range",
        "NotInRange" => "not in range",
        "SubString" => "contains",
        "SubStringIgnCase" => "contains, ignoring case,",
        "FileType" => "is of type",
        "NotFileType" => "isn't of type",
        "SAddr" => "source address in",
        "NotSAddr" => "source address not in",
        "DAddr" => "destination address in",
        "NotDAddr" => "destination address not in",
        "SPort" => "source port in",
        "NotSPort" => "source port not in",
        "SPortPriv" => "source port is privileged",
        "NotSportPriv" | "NotSPortPriv" => "source port isn't privileged",
        "DPort" => "destination port in",
        "NotDPort" => "destination port not in",
        "DPortPriv" => "destination port is privileged",
        "NotDPortPriv" => "destination port isn't privileged",
        "Protocol" => "protocol in",
        "Family" => "family in",
        "State" => "state in",
        "CapabilitiesGained" => "gains",
        "In" => "in",
        "NotIn" => "not in",
        other => other,
    }
}

/// The name the policy gives an argument: its label, or its position and type.
fn argument_name(source: &[Value], index: &Value, prefix: &str) -> Terms {
    let position = index.as_u64().unwrap_or(0);
    let declared = source.iter().find(|arg| arg["index"].as_u64() == Some(position));
    let name = format!("{prefix}{position}");
    match declared {
        Some(arg) if arg["label"].as_str().is_some_and(|label| !label.is_empty()) => Terms::new().code(arg["label"].as_str().unwrap()),
        Some(arg) if arg["type"].is_string() => Terms::new().code(&name).text(" (").code(arg["type"].as_str().unwrap()).text(")"),
        _ => Terms::new().code(&name),
    }
}

/// `subject phrase a, b or c`.
fn test(subject: Terms, phrase: &str, values: &[String]) -> Terms {
    let terms = subject.text(" ").text(phrase);
    if values.is_empty() {
        terms
    } else {
        terms.text(" ").alternatives(values, " or ")
    }
}

pub(super) fn condition(
    field: &str,
    filter: &Map<String, Value>,
    path: &str,
    args: &[Value],
    data_args: &[Value],
    item: &Map<String, Value>,
) -> Result<Value> {
    let values = scalars(filter.get("values"), &format!("{path}.values"))?;
    let operator = filter.get("operator").and_then(Value::as_str).unwrap_or_default();
    let phrase = operator_phrase(operator);
    let index = filter.get("index").cloned().unwrap_or(json!(0));
    let mut condition = json!({"filter":field,"operator":operator,"values":values});
    let terms = match field {
        "matchArgs" => {
            condition["index"] = index.clone();
            test(argument_name(args, &index, "arg"), phrase, &values)
        }
        "matchData" => {
            condition["index"] = index.clone();
            test(argument_name(data_args, &index, "data"), phrase, &values)
        }
        "matchReturnArgs" => {
            let subject = match item
                .get("returnArg")
                .and_then(|arg| arg["label"].as_str())
                .filter(|label| !label.is_empty())
            {
                Some(label) => Terms::new().code(label),
                None => Terms::new().text("the return value"),
            };
            test(subject, phrase, &values)
        }
        "matchCmdArgs" => {
            condition["index"] = index.clone();
            let argv = format!("argv[{}]", index.as_u64().unwrap_or(0) + 1);
            test(Terms::new().code(&argv), phrase, &values)
        }
        "matchPIDs" => {
            let mut terms = test(Terms::new().text("PID"), phrase, &values);
            if flag(filter.get("isNamespacePID"), false, &format!("{path}.isNamespacePID"))? {
                terms = terms.text(" (namespace PIDs)");
            }
            if flag(filter.get("followForks"), false, &format!("{path}.followForks"))? {
                condition["followForks"] = json!(true);
                terms = terms.text(", and their children");
            }
            terms
        }
        "matchNamespaces" => {
            let namespace = filter.get("namespace").and_then(Value::as_str).unwrap_or_default();
            condition["namespace"] = json!(namespace);
            test(Terms::new().code(namespace).text(" namespace"), phrase, &values)
        }
        "matchNamespaceChanges" => Terms::new()
            .text(&format!("changes {phrase} the "))
            .alternatives(&values, " or ")
            .text(" namespaces"),
        "matchCapabilities" | "matchCapabilityChanges" => {
            let kind = filter.get("type").and_then(Value::as_str).unwrap_or("Effective");
            condition["type"] = json!(kind);
            let changes = if field == "matchCapabilityChanges" { "changes to " } else { "" };
            test(Terms::new().text(&format!("{changes}{kind} capabilities")), phrase, &values)
        }
        "matchStates" => {
            let name = filter.get("name").and_then(Value::as_str).unwrap_or_default();
            let value = filter.get("value").map(|v| scalar(v, "value")).transpose()?.unwrap_or_default();
            condition["name"] = json!(name);
            condition["value"] = json!(value);
            let phrase = if operator == "NotEqual" { "≠" } else { "=" };
            test(Terms::new().text("state ").code(name), phrase, &[value])
        }
        "matchUserCallers" => {
            let symbol = filter.get("symbol").and_then(Value::as_str);
            let depth = filter.get("depth").map(|v| scalar(v, "depth")).transpose()?.unwrap_or_default();
            condition["symbol"] = json!(symbol.unwrap_or("an address range"));
            condition["depth"] = json!(depth);
            let caller = match symbol {
                Some(symbol) => Terms::new().text("called from ").code(symbol),
                None => Terms::new().text("called from an address range"),
            };
            caller.text(" (depth ").code(&depth).text(")")
        }
        _ => test(Terms::new().code(field), phrase, &values),
    };
    condition["display"] = json!(terms.prose());
    Ok(condition)
}
