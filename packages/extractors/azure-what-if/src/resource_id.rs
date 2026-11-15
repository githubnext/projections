//! ARM resource IDs: their type, names, resource group and parent.

/// A parsed ARM resource ID.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ResourceId {
    /// Lower-cased: ARM IDs are case-insensitive.
    pub(crate) key: String,
    pub(crate) resource_type: String,
    /// The resource's own name segments, `vnet/subnet` for a child.
    pub(crate) names: Vec<String>,
    pub(crate) resource_group: Option<String>,
    pub(crate) parent: Option<String>,
}

/// One `providers/<namespace>/<type>/<name>[/<type>/<name>…]` block: its start segment, namespace and type/name pairs.
type Block<'a> = (usize, &'a str, Vec<(&'a str, &'a str)>);

pub(crate) fn parse_id(id: &str) -> Option<ResourceId> {
    let segments: Vec<&str> = id.trim_end_matches('/').split('/').collect();
    if segments.first() != Some(&"") || !segments.get(1)?.eq_ignore_ascii_case("subscriptions") {
        return None;
    }
    let subscription = *segments.get(2)?;
    if subscription.is_empty() {
        return None;
    }
    let key = |n: usize| segments[..n].join("/").to_lowercase();
    let mut i = 3;
    let mut resource_group = None;
    if segments.get(i).is_some_and(|s| s.eq_ignore_ascii_case("resourceGroups")) {
        resource_group = Some(key(i + 2));
        let name = segments.get(i + 1).filter(|s| !s.is_empty())?;
        i += 2;
        if i == segments.len() {
            return Some(ResourceId {
                key: key(i),
                resource_type: "Microsoft.Resources/resourceGroups".into(),
                names: vec![(*name).into()],
                resource_group: None,
                parent: None,
            });
        }
    }
    let blocks = provider_blocks(&segments, i)?;
    let (start, namespace, pairs) = blocks.last()?;
    let resource_type = std::iter::once(*namespace)
        .chain(pairs.iter().map(|(t, _)| *t))
        .collect::<Vec<_>>()
        .join("/");
    let parent = if pairs.len() > 1 {
        Some(key(segments.len() - 2))
    } else if blocks.len() > 1 {
        Some(key(*start))
    } else {
        resource_group.clone()
    };
    Some(ResourceId {
        key: key(segments.len()),
        resource_type,
        names: pairs.iter().map(|(_, n)| (*n).to_owned()).collect(),
        resource_group,
        parent,
    })
}

/// Provider blocks from segment `i` on, repeated for extension resources.
fn provider_blocks<'a>(segments: &[&'a str], mut i: usize) -> Option<Vec<Block<'a>>> {
    let mut blocks = vec![];
    while i < segments.len() {
        if !segments[i].eq_ignore_ascii_case("providers") {
            return None;
        }
        let start = i;
        let namespace = *segments.get(i + 1)?;
        i += 2;
        let mut pairs = vec![];
        while i + 1 < segments.len() && !segments[i].eq_ignore_ascii_case("providers") {
            if segments[i].is_empty() || segments[i + 1].is_empty() {
                return None;
            }
            pairs.push((segments[i], segments[i + 1]));
            i += 2;
        }
        if pairs.is_empty() || (i < segments.len() && !segments[i].eq_ignore_ascii_case("providers")) {
            return None;
        }
        blocks.push((start, namespace, pairs));
    }
    Some(blocks)
}

pub(crate) fn is_ancestor(ancestor: &str, key: &str) -> bool {
    key.starts_with(ancestor) && key.as_bytes().get(ancestor.len()) == Some(&b'/')
}
