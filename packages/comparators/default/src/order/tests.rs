use super::*;

#[test]
fn ordered_ids_compare_by_utf16_code_units() {
    let emoji = Ordered("\u{1f600}".to_owned());
    let private = Ordered("\u{e000}".to_owned());
    assert!(emoji < private);
    assert_eq!(emoji.partial_cmp(&private), Some(std::cmp::Ordering::Less));
    assert_eq!(private.partial_cmp(&emoji), Some(std::cmp::Ordering::Greater));
    assert_eq!(emoji.partial_cmp(&emoji.clone()), Some(std::cmp::Ordering::Equal));
}
