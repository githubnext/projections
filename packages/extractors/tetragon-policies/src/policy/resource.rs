//! One `TracingPolicy` or `TracingPolicyNamespaced` resource: its identity,
//! mode, lists, macros, scope and probes, and the policy entity itself.

use super::declarations::{lists, macros, mode, options, states};
use super::fields::SPEC_FIELDS;
use super::values::{code, evidence, flag, list, locate, object, scalars, text, unmodelled};
use super::{Document, ENGINE, Mode, Model, Policy, Probe, Summary};
use crate::scope::{Workloads, selector_terms};
use crate::terms::Terms;
use anyhow::{Result, ensure};
use projections_extractor_sdk::key;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

pub fn add(model: &mut Model, document: &Document, default_namespace: Option<&str>) -> Result<()> {
    let value = document.value;
    let kind = value["kind"].as_str().unwrap_or_default();
    let api = value["apiVersion"].as_str().unwrap_or_default();
    let metadata = object(&value["metadata"], &format!("{kind} metadata"))?;
    let name = text(metadata.get("name"), &format!("{kind} metadata.name"))?;
    let label = format!("{kind} {name}");
    if api != "cilium.io/v1alpha1" {
        model.limitations.insert(format!(
            "{} uses `apiVersion` {}; it is read as `cilium.io/v1alpha1`.",
            code(&label),
            code(api)
        ));
    }
    let namespaced = kind == "TracingPolicyNamespaced";
    let namespace = if namespaced {
        Some(
            metadata
                .get("namespace")
                .and_then(Value::as_str)
                .or(default_namespace)
                .unwrap_or_default()
                .to_owned(),
        )
    } else {
        None
    };
    let policy = match &namespace {
        Some(namespace) => key(&["policy", ENGINE, kind, namespace, name]),
        None => key(&["policy", ENGINE, kind, name]),
    };
    ensure!(
        model.identities.insert(policy.clone()),
        "{label}{} is declared more than once (again in {})",
        namespace
            .as_deref()
            .filter(|namespace| !namespace.is_empty())
            .map(|namespace| format!(" in namespace {namespace}"))
            .unwrap_or_default(),
        document.source
    );
    let spec = object(&value["spec"], &format!("{label} spec"))?;
    let spec_unmodelled = unmodelled(spec, SPEC_FIELDS, &format!("{label} spec"), &mut model.limitations);

    let options = options(spec, &label)?;
    let (mode, mode_source) = mode(&options, &label)?;
    let lists = lists(spec, &label)?;
    let macros = macros(spec, &label)?;
    let states = states(spec)?;

    let workloads = Workloads::from(spec, &format!("{label} spec"), namespace.clone())?;
    let nodes = crate::scope::selector(spec.get("nodeSelector"), &format!("{label} spec.nodeSelector"))?;
    let nodes_terms = match &nodes {
        Some(requirements) if !requirements.is_empty() => Terms::new().text("nodes where ").extend(selector_terms(requirements)),
        _ => Terms::new().text("all nodes"),
    };
    let nodes_text = nodes_terms.prose();

    let context = Policy {
        policy: &policy,
        name,
        mode,
        lists,
        macros,
        document,
        namespace: namespace.clone(),
    };
    let mut enforcers = vec![];
    for (index, enforcer) in list(spec.get("enforcers"), "spec.enforcers")?.iter().enumerate() {
        for call in scalars(enforcer.get("calls"), &format!("{label} spec.enforcers[{index}].calls"))? {
            enforcers.extend(context.expand(&call)?.into_iter().map(|(target, _)| target));
        }
    }

    let mut summary = Summary::default();
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for (family, field) in [
        ("kprobe", "kprobes"),
        ("fentry", "fentries"),
        ("tracepoint", "tracepoints"),
        ("lsm", "lsmhooks"),
        ("uprobe", "uprobes"),
        ("usdt", "usdts"),
    ] {
        for (index, item) in list(spec.get(field), &format!("spec.{field}"))?.iter().enumerate() {
            let path = format!("{label} spec.{field}[{index}]");
            let item = object(item, &path)?;
            for probe in context.probes(family, item, &path, &mut model.limitations)? {
                let ordinal = seen.entry(probe.hook.clone()).or_default();
                *ordinal += 1;
                context.emit(model, probe, *ordinal, item, &path, &mut summary)?;
            }
        }
    }
    if flag(spec.get("loader"), false) {
        let probe = Probe {
            hook: key(&["hook", "loader"]),
            hook_data: json!({"hookType":"loader","target":"loader","stability":"stable","category":"process"}),
            hook_label: "loader".into(),
            data: json!({"hookType":"loader","target":"loader"}),
            line: locate(document, r"^\s*loader:\s*true"),
        };
        context.emit(model, probe, 1, &Map::new(), &format!("{label} spec.loader"), &mut summary)?;
    }

    let subject = key(&["subject", "workloads", &workloads.text()]);
    model
        .subjects
        .entry(subject.clone())
        .or_insert_with(|| json!({"id":subject,"kind":"subject","label":workloads.text(),"data":workloads.data()}));
    model.relationships.push(json!({
        "id":format!("applies-to:{policy}"),"kind":"applies-to","from":policy,"to":subject,
        "confidence":"authoritative"
    }));
    let mut data = json!({
        "engine":ENGINE,"resource":kind,"name":name,"namespace":namespace,"path":document.source,
        "mode":if mode == Mode::Enforce {"enforce"} else {"monitor"},"modeSource":mode_source,
        "scope":workloads.terms().prose(),"nodes":nodes_text,
        "nodeSelector":crate::scope::selector_json(&nodes),
        "probes":summary.probes,"selectors":summary.selectors,"enforcing":summary.enforcing,
        "effect":summary.effect(),
    });
    let extra = options
        .iter()
        .filter(|(option, _)| option.as_str() != "policy-mode")
        .map(|(option, value)| (option.clone(), Value::String(value.clone())))
        .collect::<Map<_, _>>();
    if !extra.is_empty() {
        data["options"] = Value::Object(extra);
    }
    if !enforcers.is_empty() {
        data["enforcers"] = json!(enforcers);
    }
    if !states.is_empty() {
        data["states"] = json!(states);
    }
    if document.templated {
        data["templated"] = json!(true);
        model
            .limitations
            .insert(format!("{} contains `${{…}}` placeholders, read as literal text.", code(&label)));
    }
    if let Some(extra) = spec_unmodelled {
        data["unmodelled"] = extra;
    }
    if !document.invalid.is_empty() {
        data["invalid"] = json!(document.invalid);
    }
    if namespace.as_deref() == Some("") {
        model.limitations.insert(format!(
            "{} names no namespace; its namespace comes from where it is applied.",
            code(&label)
        ));
    }
    model.entities.push(json!({
        "id":policy,"kind":"policy","label":name,"confidence":"authoritative","data":data,
        "evidence":evidence(document, locate(document, r"^\s*kind:")),
    }));
    model.scopes.push((policy, workloads));
    Ok(())
}
