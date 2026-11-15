//! Golden extractions and failure cases. Regenerate goldens with
//! `PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-tetragon-policies`.

use projections_extractor_sdk::repository_files;
use projections_extractor_sdk::testing::{self, Process, golden};
use projections_extractor_tetragon_policies::collect;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn extract(root: &Path, inputs: Value) -> anyhow::Result<Value> {
    let root = root.canonicalize().unwrap();
    let definition = json!({"id":"runtime-policies","extractor":"tetragon-policies","inputs":inputs});
    collect(&testing::context(&root, definition))
}

fn inputs(case: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(fixtures().join(case).join("inputs.json")).unwrap()).unwrap()
}

/// The Engine accepts the extraction: identities, endpoints and domain rules.
fn normalize(extraction: &Value) -> Value {
    let request = json!({"version":0,"operation":"normalize","extraction":extraction});
    let response = projections_engine::handle(request.to_string().as_bytes());
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

fn find<'a>(extraction: &'a Value, kind: &str, label: &str) -> &'a Value {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["kind"] == kind && entity["label"] == label)
        .unwrap_or_else(|| panic!("no {kind} {label}"))
}

fn case(name: &str, side: &str) -> Value {
    let directory = fixtures().join(name);
    let root = if side.is_empty() {
        directory.join("repo")
    } else {
        directory.join(side)
    };
    let extraction = extract(&root, inputs(name)).unwrap();
    let file = if side.is_empty() {
        "expected.json".to_owned()
    } else {
        format!("{side}.expected.json")
    };
    golden(&directory.join(file), &extraction);
    normalize(&extraction);
    extraction
}

#[test]
fn credentials_pull_request_matches_golden_extractions() {
    let before = case("credentials", "before");
    let after = case("credentials", "after");
    let policy = find(&after, "policy", "protect-credentials");
    assert_eq!(policy["data"]["mode"], "enforce");
    assert_eq!(
        policy["data"]["scope"],
        "pods where `app.kubernetes.io/part-of in (checkout, payments)`"
    );
    assert_eq!(
        find(&before, "policy", "protect-credentials")["data"]["scope"],
        "pods where `app.kubernetes.io/part-of=payments`"
    );
    let guard = find(&after, "selector", "token-read-by-downloader");
    assert_eq!(guard["data"]["effect"], "enforce");
    assert_eq!(guard["data"]["enforcement"], "active");
    assert_eq!(
        guard["data"]["conditions"][0]["display"],
        "`arg0` (`file`) starts with `/var/run/secrets/kubernetes.io/serviceaccount`"
    );
    assert_eq!(guard["evidence"][0]["location"]["line"], 44);
    let applies = |extraction: &Value| {
        extraction["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["kind"] == "applies-to" && r["from"] == policy["id"])
            .unwrap()
            .clone()
    };
    assert_eq!(
        applies(&before)["id"],
        applies(&after)["id"],
        "scope changes rewire one relationship"
    );
    assert_ne!(applies(&before)["to"], applies(&after)["to"]);
    assert_eq!(find(&after, "hook", "security_file_permission")["data"]["category"], "file");
    assert!(
        after["entities"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["label"] != "security_mmap_file")
    );

    let monitor = case("credentials", "monitor");
    assert_eq!(find(&monitor, "policy", "protect-credentials")["data"]["mode"], "monitor");
    let elided = find(&monitor, "selector", "token-read-by-downloader");
    assert_eq!(elided["data"]["effect"], "enforce");
    assert_eq!(elided["data"]["enforcement"], "elided");
}

#[test]
fn library_covers_lists_macros_modes_and_every_hook_family() {
    let extraction = case("library", "");
    let labels = |kind: &str| -> Vec<String> {
        extraction["entities"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["kind"] == kind)
            .map(|e| e["label"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        labels("policy"),
        ["setuid-root", "module-loading", "shell-history", "all-syscalls", "egress"]
    );
    let hooks = labels("hook");
    for hook in [
        "sys_setuid",
        "sys_setreuid",
        "module/module_load",
        "kernel_module_request",
        "do_init_module",
        "/bin/bash:readline",
        "ssl:handshake",
        "tcp_connect",
        "generated:generated_syscalls",
    ] {
        assert!(hooks.contains(&hook.to_owned()), "{hook} in {hooks:?}");
    }
    let to_root = find(&extraction, "selector", "to-root");
    assert_eq!(
        to_root["data"]["conditions"][0]["display"], "`uid` = `0`",
        "macro filters are appended"
    );
    assert_eq!(to_root["data"]["effect"], "observe");

    let monitored = find(&extraction, "policy", "module-loading");
    assert_eq!(monitored["data"]["mode"], "monitor");
    assert_eq!(monitored["data"]["scope"], "host workloads");
    assert_eq!(monitored["data"]["nodes"], "nodes where `nodepool=general`");
    assert_eq!(monitored["data"]["unmodelled"], Value::Null, "spec has no unknown fields");
    let elided: Vec<_> = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "selector" && e["data"]["enforcement"] == "elided")
        .collect();
    assert_eq!(elided.len(), 2, "monitor mode elides the Override and the Sigkill");
    let override_selector = elided.iter().find(|e| e["data"]["actions"][0]["action"] == "Override").unwrap();
    assert_eq!(override_selector["data"]["actions"][0]["display"], "Deny (`Override` returns `-1`)");
    let unknown = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "selector" && e["data"]["actions"][0]["action"] == "Teleport")
        .unwrap();
    assert_eq!(unknown["data"]["effect"], "unknown");
    let probe = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "probe" && e["label"] == "do_init_module")
        .unwrap();
    assert_eq!(probe["data"]["unmodelled"], json!({"futureField":true}));

    let shell = find(&extraction, "policy", "shell-history");
    assert_eq!(shell["data"]["namespace"], "security");
    assert_eq!(
        shell["data"]["scope"],
        "containers where `name in (api, web)` in pods in namespace `security`"
    );
    let everything = find(&extraction, "policy", "all-syscalls");
    assert_eq!(everything["data"]["effect"], "none", "NoPost with TrackSock only tracks");
    let egress = find(&extraction, "policy", "egress");
    assert_eq!(egress["data"]["templated"], true);

    let limitations = extraction["metadata"]["limitations"].as_array().unwrap();
    for expected in ["futureField` is not modelled", "action `Teleport`", "`${…}` placeholders"] {
        assert!(
            limitations.iter().any(|l| l.as_str().unwrap().contains(expected)),
            "{expected} in {limitations:?}"
        );
    }
    assert_eq!(
        extraction["metadata"]["sources"],
        json!(["policies/library.yaml", "policies/listed.yaml"])
    );
}

#[test]
fn extraction_is_deterministic_and_independent_of_file_listing_order() {
    let root = fixtures().join("library/repo").canonicalize().unwrap();
    let definition = json!({"id":"p","extractor":"tetragon-policies","inputs":inputs("library")});
    let mut files = repository_files(&root).unwrap();
    let first = collect(&testing::context(&root, definition.clone()).with_files(files.clone())).unwrap();
    files.reverse();
    let second = collect(&testing::context(&root, definition).with_files(files)).unwrap();
    assert_eq!(first, second);
    assert_eq!(normalize(&first)["digest"], normalize(&second)["digest"]);
}

struct Scratch(PathBuf);
impl Scratch {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target/tetragon-policies-tests")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
    fn error(&self, policy: &str, inputs: Value) -> String {
        fs::write(self.0.join("policy.yaml"), policy).unwrap();
        format!("{:#}", extract(&self.0, inputs).unwrap_err())
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const HEADER: &str = "apiVersion: cilium.io/v1alpha1\nkind: TracingPolicy\nmetadata:\n  name: p\nspec:\n";

#[test]
fn rejects_malformed_and_contradictory_policies() {
    let scratch = Scratch::new("errors");
    let selector = "      - matchActions: [{action: Post}]\n";
    for (policy, expected) in [
        (format!("{HEADER}  kprobes: [\n"), "Invalid YAML in policy.yaml"),
        (format!("{HEADER}  kprobes: []\n  kprobes: []\n"), "Duplicate YAML key"),
        (format!("{HEADER}  kprobes: []\n---\n{HEADER}  kprobes: []\n"), "TracingPolicy p is declared more than once"),
        (format!("{HEADER}  kprobes:\n    - call: list:missing\n"), "undefined list missing"),
        (
            format!("{HEADER}  kprobes:\n    - call: f\n      selectors:\n        - macros: [nope]\n"),
            "undefined selector macro nope",
        ),
        (
            format!("{HEADER}  kprobes:\n    - call: f\n      selectors:\n{}", selector.replace("      ", "        ").repeat(6)),
            "at most 5",
        ),
        (
            format!("{HEADER}  kprobes:\n    - call: f\n      selectors:\n        - matchActions: [{{action: Post}}, {{action: Post}}, {{action: Post}}, {{action: Post}}]\n"),
            "at most 3",
        ),
        (format!("{HEADER}  options: [{{name: policy-mode, value: audit}}]\n"), "policy-mode \"audit\""),
        (
            "apiVersion: cilium.io/v1alpha1\nkind: TracingPolicyNamespaced\nmetadata:\n  name: p\n  namespace: n\nspec:\n  hostSelector: {}\n".to_owned(),
            "hostSelector must be null in a TracingPolicyNamespaced",
        ),
        (format!("{HEADER}  kprobes:\n    - syscall: true\n"), "call must be a nonempty string"),
        (
            format!("{HEADER}  kprobes:\n    - call: f\n      selectors:\n        - label: a\n        - label: a\n"),
            "two selectors labelled a",
        ),
        (
            format!("{HEADER}  kprobes:\n    - call: {{{{ .Values.call }}}}\n"),
            "looks like a template",
        ),
    ] {
        let message = scratch.error(&policy, json!({}));
        assert!(message.contains(expected), "{policy}\n=> {message}");
    }
}

#[test]
fn declared_inputs_the_revision_lacks_are_missing_not_errors() {
    let scratch = Scratch::new("missing");
    fs::write(scratch.0.join("policy.yaml"), format!("{HEADER}  kprobes:\n    - call: f\n")).unwrap();
    let root = scratch.0.canonicalize().unwrap();
    let run = |inputs: Value| {
        let cx = testing::context(
            &root,
            json!({"id":"runtime-policies","extractor":"tetragon-policies","inputs":inputs}),
        );
        cx.finish(collect(&cx).unwrap())
    };
    // None of the policies exist yet: an empty extraction naming what's missing.
    let absent = run(json!({
        "paths": ["deploy/tetragon/*.yaml"],
        "agentValuesPath": "deploy/tetragon-values.yaml",
        "kernelProfilesPath": "deploy/kernels/profiles.yaml",
        "workloadPaths": ["deploy/apps/*.yaml"],
        "crdPath": "deploy/crds.yaml",
    }));
    assert_eq!(absent["entities"], json!([]));
    assert_eq!(
        absent["missingInputs"],
        json!([
            "deploy/apps/*.yaml",
            "deploy/crds.yaml",
            "deploy/kernels/profiles.yaml",
            "deploy/tetragon-values.yaml",
            "deploy/tetragon/*.yaml"
        ])
    );
    normalize(&absent);
    // Some present: they are extracted, the missing ones are named.
    let partial = run(json!({"paths": ["*.yaml", "deploy/tetragon/*.yaml"]}));
    find(&partial, "policy", "p");
    assert_eq!(partial["missingInputs"], json!(["deploy/tetragon/*.yaml"]));
    let rendered = run(json!({"renderedManifestsPath": "rendered.yaml"}));
    assert_eq!(rendered["entities"], json!([]));
    assert_eq!(rendered["missingInputs"], json!(["rendered.yaml"]));
}

#[test]
fn repositories_without_policies_extract_nothing() {
    let scratch = Scratch::new("empty");
    fs::write(scratch.0.join("values.yaml"), "replicas: 1\n").unwrap();
    let extraction = extract(&scratch.0, json!({})).unwrap();
    assert_eq!(extraction["entities"], json!([]));
    assert_eq!(extraction["metadata"]["policies"], 0);
    normalize(&extraction);
}

fn findings(entity: &Value) -> Vec<String> {
    entity["data"]["findings"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|finding| finding["message"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn deployment_enrichment_checks_crds_agent_kernels_and_workloads() {
    let before = case("deployment", "before");
    assert_eq!(find(&before, "agent", "Tetragon agent")["data"]["policyFilter"], true);
    assert!(findings(find(&before, "policy", "protect-credentials")).is_empty());
    let extraction = case("deployment", "after");
    let invalid = find(&extraction, "policy", "shell-guard");
    assert_eq!(
        invalid["data"]["invalid"],
        json!([
            "spec.kprobes[0].selectors[0].matchActions[0].action: \"Explode\" is not one of Post, NoPost, Sigkill, Signal, Override, GetUrl, DnsLookup, TrackSock, UntrackSock, NotifyEnforcer",
            "spec.options[0].name: \"Policy_Mode\" doesn't match ^[a-z][a-z-]*$"
        ])
    );
    assert_eq!(find(&extraction, "policy", "protect-credentials")["data"]["invalid"], Value::Null);

    let agent = find(&extraction, "agent", "Tetragon agent");
    assert_eq!(agent["data"]["policyFilter"], false);
    assert_eq!(agent["data"]["persistentEnforcement"], true);
    for (policy, filtered) in [
        ("protect-credentials", true),
        ("egress-audit", true),
        ("shell-guard", true),
        ("block-modules", false),
    ] {
        assert_eq!(
            findings(find(&extraction, "policy", policy))
                .iter()
                .any(|finding| finding.contains("policy filter is off")),
            filtered,
            "{policy}"
        );
    }

    assert_eq!(
        findings(find(&extraction, "hook", "kernel_module_request")),
        ["Unavailable on `legacy`: BPF LSM is not enabled (`CONFIG_BPF_LSM`)."]
    );
    assert_eq!(
        findings(find(&extraction, "hook", "tcp_connect")),
        ["Unavailable on `general`: `tcp_connect` is not a kernel symbol there."]
    );
    assert!(
        findings(find(&extraction, "hook", "sys_finit_module")).is_empty(),
        "matched as __x64_sys_finit_module"
    );
    assert_eq!(
        findings(find(&extraction, "selector", "deny-read")),
        ["`Override` can't run on `legacy`: `security_kernel_read_file` doesn't allow error injection there."]
    );
    assert!(
        findings(find(&extraction, "selector", "not-kmod")).is_empty(),
        "LSM overrides need only BPF LSM"
    );

    let covers: Vec<(String, String)> = extraction["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["kind"] == "covers")
        .map(|r| {
            let label = |id: &Value| {
                extraction["entities"].as_array().unwrap().iter().find(|e| e["id"] == *id).unwrap()["label"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            };
            (label(&r["from"]), label(&r["to"]))
        })
        .collect();
    let mut expected = vec![
        ("protect-credentials", "checkout-web"),
        ("egress-audit", "checkout-web"),
        ("protect-credentials", "payments-api"),
        ("shell-guard", "payments-api"),
        ("protect-credentials", "settlement"),
        ("shell-guard", "settlement"),
    ]
    .into_iter()
    .map(|(a, b)| (a.to_owned(), b.to_owned()))
    .collect::<Vec<_>>();
    let mut actual = covers.clone();
    expected.sort();
    actual.sort();
    assert_eq!(actual, expected);
    let web = find(&extraction, "workload", "checkout-web");
    assert_eq!(
        web["data"]["containers"],
        json!([{"name":"web","repo":"registry.local:5000/checkout/web"}])
    );
    let api = find(&extraction, "workload", "payments-api");
    assert_eq!(api["data"]["containers"][1]["repo"], "envoyproxy/envoy");
}

fn rendering(tool: &'static str, manifest: &'static str) -> (Process, std::sync::Arc<std::sync::Mutex<Vec<Vec<String>>>>) {
    let root = fixtures().join("credentials/after").canonicalize().unwrap();
    let calls = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
    let recorded = calls.clone();
    let mut host = Process::new(&root);
    host.runner = Some(std::sync::Arc::new(move |argv: &[String], _cwd: &Path| {
        recorded.lock().unwrap().push(argv.to_vec());
        assert_eq!(argv[0], tool);
        Ok(projections_extractor_sdk::Output {
            stdout: manifest.to_owned(),
            stderr: String::new(),
        })
    }));
    (host, calls)
}

const RENDERED: &str = "# Source: chart/templates/policy.yaml\napiVersion: cilium.io/v1alpha1\nkind: TracingPolicy\nmetadata:\n  name: rendered\nspec:\n  kprobes:\n    - call: sys_ptrace\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n";

#[test]
fn helm_and_kustomize_render_with_the_users_tools_only_with_trust() {
    let root = fixtures().join("credentials/after").canonicalize().unwrap();
    let files = repository_files(&root).unwrap();
    let helm = json!({"id":"p","extractor":"tetragon-policies","inputs":{
        "helm":{"chart":"deploy/tetragon","releaseName":"guard","namespace":"security","values":["deploy/tetragon/egress-audit.yaml"]}}});
    let (host, calls) = rendering("helm", RENDERED);
    let error = format!(
        "{:#}",
        collect(&host.context(&root, Value::clone(&helm)).with_files(files.to_vec())).unwrap_err()
    );
    assert!(error.contains("pass --trust"), "{error}");
    assert!(calls.lock().unwrap().is_empty(), "nothing runs without trust");
    assert!(projections_extractor_tetragon_policies::requires_trust(&helm["inputs"]));
    assert!(!projections_extractor_tetragon_policies::requires_trust(&json!({"paths":["x"]})));

    let (mut host, calls) = rendering("helm", RENDERED);
    host.trusted = true;
    let extraction = collect(&host.context(&root, Value::clone(&helm)).with_files(files.to_vec())).unwrap();
    assert_eq!(
        calls.lock().unwrap()[0],
        [
            "helm",
            "template",
            "guard",
            "deploy/tetragon",
            "--skip-tests",
            "--namespace",
            "security",
            "--values",
            "deploy/tetragon/egress-audit.yaml"
        ]
    );
    assert_eq!(extraction["metadata"]["sources"], json!(["helm template deploy/tetragon"]));
    assert_eq!(
        find(&extraction, "policy", "rendered")["data"]["path"],
        "helm template deploy/tetragon"
    );
    normalize(&extraction);

    let kustomize = json!({"id":"p","extractor":"tetragon-policies","inputs":{
        "kustomize":{"path":"deploy/tetragon"},"paths":["deploy/tetragon/egress-audit.yaml"]}});
    let (mut host, calls) = rendering("kustomize", RENDERED);
    host.trusted = true;
    let extraction = collect(&host.context(&root, Value::clone(&kustomize)).with_files(files.to_vec())).unwrap();
    assert_eq!(calls.lock().unwrap()[0], ["kustomize", "build", "deploy/tetragon"]);
    assert_eq!(
        extraction["metadata"]["sources"],
        json!(["kustomize build deploy/tetragon", "deploy/tetragon/egress-audit.yaml"])
    );

    let escape = json!({"id":"p","extractor":"tetragon-policies","inputs":{"helm":{"chart":"../outside"}}});
    let (mut host, _) = rendering("helm", RENDERED);
    host.trusted = true;
    let error = format!(
        "{:#}",
        collect(&host.context(&root, Value::clone(&escape)).with_files(files.to_vec())).unwrap_err()
    );
    assert!(error.contains("must stay within the repository"), "{error}");
}

#[test]
fn enrichment_inputs_fail_explicitly() {
    let scratch = Scratch::new("enrichment");
    fs::write(scratch.0.join("crd.yaml"), "kind: ConfigMap\n").unwrap();
    fs::write(scratch.0.join("values.yaml"), "tetragon:\n  enablePolicyFilter: maybe\n").unwrap();
    fs::write(scratch.0.join("kernels.yaml"), "profiles:\n  - name: a\n    kernel: latest\n").unwrap();
    for (inputs, expected) in [
        (json!({"crdPath":"crd.yaml"}), "names no CustomResourceDefinition"),
        (
            json!({"agentValuesPath":"values.yaml"}),
            "tetragon.enablePolicyFilter must be true or false",
        ),
        (json!({"kernelProfilesPath":"kernels.yaml"}), "\"latest\" is not a version"),
    ] {
        let message = scratch.error(&format!("{HEADER}  kprobes: []\n"), inputs.clone());
        assert!(message.contains(expected), "{inputs} => {message}");
    }
}

/// Opt-in: checks the fixtures against Tetragon's own published CRDs. Set
/// `PROJECTIONS_TETRAGON_CRDS` to a directory holding
/// `cilium.io_tracingpolicies.yaml` and `cilium.io_tracingpoliciesnamespaced.yaml`
/// (`pkg/k8s/apis/cilium.io/client/crds/v1alpha1` in cilium/tetragon).
#[test]
fn fixtures_validate_against_tetragons_published_crds() {
    let Ok(directory) = std::env::var("PROJECTIONS_TETRAGON_CRDS") else {
        return;
    };
    let scratch = Scratch::new("published-crds");
    let mut invalid: Vec<(String, Value)> = vec![];
    for case in ["credentials/before", "credentials/after", "credentials/monitor", "library/repo"] {
        let root = scratch.0.join(case);
        for name in ["cilium.io_tracingpolicies.yaml", "cilium.io_tracingpoliciesnamespaced.yaml"] {
            fs::create_dir_all(root.join("crds")).unwrap();
            fs::copy(Path::new(&directory).join(name), root.join("crds").join(name)).unwrap();
        }
        let source = fixtures().join(case);
        for file in repository_files(&source).unwrap() {
            let target = root.join("policies").join(&file);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::copy(source.join(&file), target).unwrap();
        }
        let extraction = extract(
            &root,
            json!({"paths":["policies/**/*.yaml"],"namespace":"security","crdPath":["crds/cilium.io_tracingpolicies.yaml","crds/cilium.io_tracingpoliciesnamespaced.yaml"]}),
        )
        .unwrap();
        invalid.extend(
            extraction["entities"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["kind"] == "policy" && !e["data"]["invalid"].is_null())
                .map(|e| (e["label"].as_str().unwrap().to_owned(), e["data"]["invalid"].clone())),
        );
    }
    // Only the deliberate version-skew field and action fail Tetragon's own schema.
    assert_eq!(
        invalid,
        [(
            "module-loading".to_owned(),
            json!([
                "spec.kprobes[0].futureField: is not a field the CRD defines",
                "spec.kprobes[0].selectors[1].matchActions[0].action: \"Teleport\" is not one of Post, Sigkill, Override, GetUrl, DnsLookup, NoPost, Signal, TrackSock, UntrackSock, NotifyEnforcer, CleanupEnforcerNotification, Set, UpdateState"
            ])
        )]
    );
}
