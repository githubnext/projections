//! Spring Boot, built with Gradle and Maven.

use std::path::Path;

use projections_cli::engine;
use serde_json::{Value, json};

use crate::common::{Scratch, collect, compare, copy, definition, fixtures, items, selected};

/// The Spring Boot application the Gradle build (Spring Boot 4) and the Maven build
/// (Spring Boot 3) of one fixture produce, built and run with the user's JDK.
#[test]
fn native_spring_boot_context_through_gradle_and_maven() {
    if !selected(&["PROJECTIONS_NATIVE_SPRING", "PROJECTIONS_NATIVE_TESTS"]) {
        return;
    }
    let scratch = Scratch::new();
    let fixtures = fixtures("spring-di");
    let revision = |name: &str, after: bool| {
        let root = scratch.0.join(name);
        copy(&fixtures.join("app"), &root, &[]);
        if after {
            copy(&fixtures.join("after"), &root, &[]);
        }
        root
    };
    let collect = |root: &Path, inputs: Value| -> anyhow::Result<Value> {
        let d = definition(
            "spring-di",
            inputs,
            json!({"timeoutMs":300000,"network":true,"environment":["JAVA_HOME","GRADLE_USER_HOME"]}),
        );
        let extraction = collect(root, &d, true)?;
        engine("normalize", json!({"extraction":extraction}))
    };
    let entity = |state: &Value, id: &str| -> Value {
        items(state, "entities")
            .iter()
            .find(|item| item["id"] == id)
            .unwrap_or_else(|| panic!("{id} in {state}"))
            .clone()
    };
    let dependencies = |state: &Value, from: &str| -> Vec<(String, String)> {
        let mut found: Vec<_> = items(state, "relationships")
            .iter()
            .filter(|edge| edge["kind"] == "dependsOn" && edge["from"] == from)
            .map(|edge| {
                (
                    edge["data"]["parameter"].as_str().unwrap().to_owned(),
                    edge["to"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        found.sort();
        found
    };

    let before = revision("before", false);
    let gradle = collect(&before, json!({})).unwrap();
    assert_eq!(gradle["metadata"]["springBoot"].as_str().unwrap().split('.').next(), Some("4"));
    assert_eq!(gradle["metadata"]["mainClass"], "com.example.orders.OrdersApplication");
    assert!(!before.join("runner-ran.txt").exists(), "runners never run");
    assert!(
        !before.join("build").exists() && !before.join(".gradle").exists(),
        "Gradle output stays in scratch"
    );

    // A @Bean factory method registers the contract it returns; the instance is the implementation.
    let gateway = entity(&gradle, "service:paymentGateway:registration");
    assert_eq!(gateway["data"]["registrationKind"], "factory-method");
    assert_eq!(
        entity(&gradle, "service:paymentGateway")["data"]["type"],
        "com.example.orders.payments.PaymentGateway"
    );
    assert_eq!(entity(&gradle, "implementation:paymentGateway")["label"], "StripeGateway");
    assert_eq!(
        entity(&gradle, "service:ordersService:registration")["data"]["registrationKind"],
        "component"
    );
    // Scopes, aliases, @Primary, conditions and scoped proxies.
    let audit = entity(&gradle, "service:auditLog:registration");
    assert_eq!(
        (audit["data"]["scope"].as_str(), audit["data"]["lifetime"].as_str()),
        (Some("prototype"), Some("transient"))
    );
    assert_eq!(entity(&gradle, "service:auditLog")["data"]["aliases"], json!(["auditTrail"]));
    assert_eq!(entity(&gradle, "service:systemClock:registration")["data"]["primary"], true);
    let request = entity(&gradle, "service:requestContext:registration");
    assert_eq!(
        (
            request["data"]["scope"].as_str(),
            request["data"]["lifetime"].as_str(),
            request["data"]["proxied"].as_bool()
        ),
        (Some("request"), Some("scoped"), Some(true))
    );
    assert!(
        entity(&gradle, "service:fraudCheck:registration")["data"]["conditions"][0]
            .as_str()
            .unwrap()
            .contains("orders.fraud-check.enabled")
    );
    assert!(
        !items(&gradle, "entities")
            .iter()
            .any(|item| { item["id"].as_str().unwrap().starts_with("service:scopedTarget.") })
    );

    // The bean factory's own resolution: primary and qualified candidates, collections, Optional and fields.
    assert_eq!(
        dependencies(&gradle, "implementation:ordersService"),
        [
            ("audit", "service:auditLog"),
            ("clock", "service:systemClock"),
            ("fraud", "service:fraudCheck"),
            ("payments", "service:paymentGateway"),
            ("repository", "service:ordersRepository"),
            ("validators", "service:amountValidator"),
            ("validators", "service:stockValidator"),
        ]
        .map(|(a, b)| (a.to_owned(), b.to_owned()))
    );
    assert_eq!(
        dependencies(&gradle, "implementation:reportService"),
        [("clock", "service:utcClock"), ("repository", "service:ordersRepository")].map(|(a, b)| (a.to_owned(), b.to_owned()))
    );
    let fraud = items(&gradle, "relationships")
        .iter()
        .find(|edge| edge["to"] == "service:fraudCheck")
        .unwrap()
        .clone();
    assert_eq!(
        (fraud["data"]["optional"].as_bool(), fraud["confidence"].as_str()),
        (Some(true), Some("authoritative"))
    );
    assert!(
        items(&gradle, "relationships")
            .iter()
            .any(|edge| edge["data"]["injection"] == "field")
    );
    assert!(
        !items(&gradle, "entities")
            .iter()
            .any(|item| item["label"].as_str().unwrap().contains("$$")),
        "generated class names never leak"
    );

    // The same sources on Spring Boot 3 through Maven compose the same application beans.
    let maven = collect(&revision("maven", false), json!({"build":"maven"})).unwrap();
    assert_eq!(maven["metadata"]["springBoot"].as_str().unwrap().split('.').next(), Some("3"));
    let application = |state: &Value| -> std::collections::BTreeSet<String> {
        items(state, "entities")
            .iter()
            .filter(|item| item["kind"] == "registration" && item["data"]["origin"] == "application")
            .map(|item| item["id"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(application(&maven), application(&gradle));
    assert_eq!(
        dependencies(&maven, "implementation:ordersService"),
        dependencies(&gradle, "implementation:ordersService")
    );

    // Add a service, change a lifetime and swap an implementation.
    let after = collect(&revision("after", true), json!({})).unwrap();
    let comparison = compare(&gradle, &after);
    let changed = |status: &str| -> Vec<String> {
        comparison["changes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|change| change["status"] == status)
            .flat_map(|change| {
                change[if status == "removed" { "before" } else { "after" }]
                    .as_array()
                    .unwrap()
                    .clone()
            })
            .map(|id| id.as_str().unwrap().to_owned())
            .collect()
    };
    assert!(changed("added").contains(&"service:notificationService".to_owned()));
    assert!(changed("modified").contains(&"service:auditLog:registration".to_owned()));
    assert_eq!(entity(&after, "service:auditLog:registration")["data"]["lifetime"], "singleton");
    assert!(changed("modified").contains(&"implementation:paymentGateway".to_owned()));
    assert_eq!(entity(&after, "implementation:paymentGateway")["label"], "AdyenGateway");

    // Explicit failures: trust, an unknown main class and a missing build.
    let d = definition("spring-di", json!({}), json!({}));
    assert!(format!("{:#}", collect_untrusted(&before, &d)).contains("--trust"));
    let error = collect(&before, json!({"mainClass":"com.example.Missing"})).unwrap_err();
    assert!(
        format!("{error:#}").contains("com.example.Missing is not on the application's runtime classpath"),
        "{error:#}"
    );
}

fn collect_untrusted(root: &Path, d: &Value) -> anyhow::Error {
    collect(root, d, false).unwrap_err()
}
