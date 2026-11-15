use super::pnpm::{pnpm_package, pnpm_target, relative};
use super::yarn_berry::berry_descriptor;
use super::yarn_classic::descriptor_name;
use super::*;

#[test]
fn pnpm_keys_name_package_versions_without_peer_suffixes_across_lockfile_formats() {
    for (key, major, name, version) in [
        ("is-number@7.0.0", 9, "is-number", "7.0.0"),
        ("@scope/pkg@2.0.0(peer@1.0.0)", 9, "@scope/pkg", "2.0.0"),
        ("/is-number@6.0.0(react@18.2.0)", 6, "is-number", "6.0.0"),
        ("/is-number/6.0.0", 5, "is-number", "6.0.0"),
        ("/@scope/pkg/1.0.0_react@16.0.0", 5, "@scope/pkg", "1.0.0"),
    ] {
        assert_eq!(pnpm_package(key, major), Some((name.to_owned(), version.to_owned())), "{key}");
    }
}

#[test]
fn pnpm_references_name_a_version_of_the_key_or_an_aliased_package() {
    let keys: BTreeMap<String, usize> = [
        ("is-number@6.0.0", 0),
        ("react-dom@18.2.0(react@18.2.0)", 1),
        ("/is-number@6.0.0", 2),
        ("/is-number/6.0.0", 3),
    ]
    .map(|(key, index)| (key.to_owned(), index))
    .into();
    let target = |major, key, reference| pnpm_target(&keys, major, key, reference);
    assert_eq!(target(9, "is-number", "6.0.0"), Some(Target::Package(0)));
    assert_eq!(target(9, "number-check", "is-number@6.0.0"), Some(Target::Package(0)));
    assert_eq!(target(9, "react-dom", "18.2.0(react@18.2.0)"), Some(Target::Package(1)));
    assert_eq!(target(6, "is-number", "6.0.0"), Some(Target::Package(2)));
    assert_eq!(target(6, "number-check", "/is-number@6.0.0"), Some(Target::Package(2)));
    assert_eq!(target(5, "is-number", "6.0.0"), Some(Target::Package(3)));
    assert_eq!(target(9, "shared", "link:../shared"), None);
    assert_eq!(relative("packages/api", "../shared"), "packages/shared");
    assert_eq!(relative(".", "packages/api"), "packages/api");
}

#[test]
fn yarn_descriptors_name_the_real_package_of_an_alias() {
    assert_eq!(descriptor_name("is-number@^6.0.0"), Some("is-number"));
    assert_eq!(descriptor_name("@scope/pkg@^1"), Some("@scope/pkg"));
    assert_eq!(descriptor_name("number-check@npm:is-number@^6.0.0"), Some("is-number"));
    assert_eq!(berry_descriptor("a", "^1.0.0"), "a@npm:^1.0.0");
    assert_eq!(berry_descriptor("a", "workspace:*"), "a@workspace:*");
}

#[test]
fn npm_dependencies_resolve_from_the_nearest_node_modules() {
    let lock = npm(r#"{"lockfileVersion":3,"packages":{
            "":{},
            "node_modules/a":{"version":"1.0.0","dependencies":{"b":"^1"}},
            "node_modules/a/node_modules/b":{"version":"1.2.0","dependencies":{"c":"^1"}},
            "node_modules/b":{"version":"2.0.0"},
            "node_modules/c":{"version":"1.0.0"},
            "node_modules/w":{"link":true,"resolved":"packages/w"}
        }}"#)
    .unwrap();
    let names: Vec<_> = lock.packages.iter().map(|p| format!("{}@{}", p.name, p.version)).collect();
    assert_eq!(names, ["a@1.0.0", "b@1.2.0", "b@2.0.0", "c@1.0.0"]);
    assert_eq!(lock.packages[0].dependencies[0].target, Some(Target::Package(1)));
    assert_eq!(lock.packages[1].dependencies[0].target, Some(Target::Package(3)));
    assert_eq!(lock.resolve("", "b", "^2", false), Some(Target::Package(2)));
    assert_eq!(
        lock.resolve("packages/x", "w", "*", true),
        Some(Target::Workspace("packages/w".into()))
    );
}

#[test]
fn unsupported_lockfile_versions_fail() {
    assert!(npm(r#"{"lockfileVersion":1,"dependencies":{}}"#).is_err());
    assert!(pnpm("lockfileVersion: '4.0'\n").is_err());
    assert!(yarn_classic("foo@^1:\n  version \"1.0.0\"\n").is_err());
    assert!(yarn_berry("foo@npm:^1:\n  version: 1.0.0\n").is_err());
}
