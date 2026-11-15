//! Canonical order for normalization: every list an extraction normalizes is
//! put in the order [`projections_engine_verified::sort`] proves canonical,
//! so canonical bytes never depend on the order an extractor wrote things in.

use projections_engine_verified::sort;

/// A string as UTF-16 code units: one word of a sort key.
pub(crate) fn word(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// Puts `items` in the canonical order of their keys ([`sort::sort`]): word
/// by word in UTF-16 code unit order, a shorter key first when it is a prefix.
pub(crate) fn canonical_order<T>(items: &mut Vec<T>, key: impl Fn(&T) -> Vec<Vec<u16>>) {
    let keys: Vec<Vec<Vec<u16>>> = items.iter().map(key).collect();
    let order = sort::sort(&keys);
    let mut slots: Vec<Option<T>> = std::mem::take(items).into_iter().map(Some).collect();
    *items = order
        .into_iter()
        .map(|index| slots[index].take().expect("the canonical order is a permutation"))
        .collect();
}
