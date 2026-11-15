//! Installed packages collected while parsing a lockfile.

use super::{Dependency, Installed, Target};
use std::collections::BTreeMap;

/// Installed packages collected while parsing: one per name and version, with
/// the raw dependencies of every place it was installed, resolved afterwards.
#[derive(Default)]
pub(super) struct Builder {
    index: BTreeMap<(String, String), usize>,
    packages: Vec<(String, String)>,
    raw: Vec<BTreeMap<(&'static str, String), Option<String>>>,
}

impl Builder {
    pub(super) fn add(&mut self, name: &str, version: &str) -> usize {
        let key = (name.to_owned(), version.to_owned());
        if let Some(index) = self.index.get(&key) {
            return *index;
        }
        self.packages.push(key.clone());
        self.raw.push(BTreeMap::new());
        self.index.insert(key, self.packages.len() - 1);
        self.packages.len() - 1
    }

    /// Records a dependency; the first place a package was installed decides.
    pub(super) fn depend(&mut self, package: usize, kind: &'static str, key: &str, range: Option<&str>) {
        self.raw[package]
            .entry((kind, key.to_owned()))
            .or_insert_with(|| range.map(str::to_owned));
    }

    /// Resolves every recorded dependency with `resolve(package, kind, key,
    /// range)` and renumbers packages in name and version order.
    pub(super) fn finish(self, resolve: impl Fn(usize, &str, Option<&str>) -> Option<Target>) -> (Vec<Installed>, Vec<usize>) {
        let mut order: Vec<usize> = (0..self.packages.len()).collect();
        order.sort_by(|a, b| self.packages[*a].cmp(&self.packages[*b]));
        let mut position = vec![0; order.len()];
        for (new, old) in order.iter().enumerate() {
            position[*old] = new;
        }
        let renumber = |target: Target| match target {
            Target::Package(old) => Target::Package(position[old]),
            other => other,
        };
        let packages = order
            .iter()
            .map(|old| {
                let (name, version) = self.packages[*old].clone();
                let dependencies = self.raw[*old]
                    .iter()
                    .map(|((kind, key), range)| Dependency {
                        kind,
                        key: key.clone(),
                        range: range.clone(),
                        target: resolve(*old, key, range.as_deref()).map(renumber),
                    })
                    .collect();
                Installed {
                    name,
                    version,
                    dependencies,
                }
            })
            .collect();
        (packages, position)
    }
}
