use super::{Budget, Found};
use std::collections::HashSet;

#[test]
fn an_id_that_exactly_fills_the_remaining_bytes_is_found() {
    let mut found = Found {
        own: HashSet::new(),
        seen: HashSet::new(),
        ids: Vec::new(),
        limit: 10,
        bytes: 5,
    };
    found.add("ab");
    found.add("cde");
    assert_eq!((found.ids.clone(), found.full()), (vec!["ab", "cde"], true));
    // One byte past what remains stops it.
    let mut over = Found {
        bytes: 4,
        ids: Vec::new(),
        seen: HashSet::new(),
        ..found
    };
    over.add("ab");
    over.add("cde");
    assert_eq!((over.ids.clone(), over.full()), (vec!["ab"], true));
}

#[test]
fn a_budget_spends_ids_that_exactly_fit_it() {
    let ids = ["ab".to_owned(), "cde".to_owned()];
    let mut budget = Budget { ids: 2, bytes: 5 };
    assert!(budget.spend(&ids));
    assert_eq!((budget.ids, budget.bytes), (0, 0));
    assert!(!Budget { ids: 1, bytes: 5 }.spend(&ids));
    assert!(!Budget { ids: 2, bytes: 4 }.spend(&ids));
}

#[test]
fn a_budget_spends_bytes_that_exactly_fit_it() {
    let mut budget = Budget { ids: 0, bytes: 5 };
    assert!(budget.spend_bytes(5));
    assert_eq!(budget.bytes, 0);
    assert!(!budget.spend_bytes(1));
}
