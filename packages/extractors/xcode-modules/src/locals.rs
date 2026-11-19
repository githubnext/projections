//! Local Swift packages a project refers to, read without running their
//! manifests, so a product listed without its package can be attributed.

use crate::packages::{Package, ProductDependency};
use crate::project::{Project, normalize};
use anyhow::Result;
use projections_extractor_sdk::Context;
use projections_extractor_swift_support::manifest::{identity, statics};
use std::collections::{BTreeMap, BTreeSet};

/// Local Swift packages the project refers to, by the products each declares:
/// its local package references and the folders it lists that hold a
/// `Package.swift`. A manifest that can't be read without running it adds no
/// products.
pub(crate) fn local_products(cx: &Context, project: &Project) -> Result<BTreeMap<String, Vec<Package>>> {
    let mut folders: BTreeSet<String> = project
        .references("XCLocalSwiftPackageReference")
        .filter_map(|reference| reference.get("relativePath")?.as_str())
        .map(|path| normalize(&crate::join(&project.source_root, path)))
        .collect();
    folders.extend(
        project
            .paths
            .values()
            .filter(|path| cx.exists(&crate::join(path, "Package.swift")).unwrap_or(false))
            .cloned(),
    );
    let mut products: BTreeMap<String, Vec<Package>> = BTreeMap::new();
    for folder in folders {
        let manifest = crate::join(&folder, "Package.swift");
        if !cx.exists(&manifest)? {
            continue;
        }
        let Ok(read) = statics::read(&cx.read_source(&manifest)?) else {
            continue;
        };
        for product in read.products {
            let package = Package {
                identity: identity(&folder),
                source: "local",
                location: folder.clone(),
                requirement: None,
            };
            products.entry(product.name).or_default().push(package);
        }
    }
    Ok(products)
}

/// Gives each product without a package the one local package that declares it.
pub(crate) fn attribute(dependencies: &mut [ProductDependency], locals: &BTreeMap<String, Vec<Package>>) {
    for dependency in dependencies.iter_mut().filter(|dependency| dependency.package.is_none()) {
        if let Some([only]) = locals.get(&dependency.product).map(Vec::as_slice) {
            dependency.package = Some(only.clone());
        }
    }
}
