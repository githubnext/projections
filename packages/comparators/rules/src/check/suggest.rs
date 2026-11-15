/// A "did you mean" hint: the nearest candidate within a small edit
/// distance, or nothing.
pub(super) fn suggestion(name: &str, candidates: impl IntoIterator<Item = String>) -> String {
    fn distance(a: &str, b: &str) -> usize {
        let b: Vec<char> = b.chars().collect();
        let mut row: Vec<usize> = (0..=b.len()).collect();
        for (i, ca) in a.chars().enumerate() {
            let mut previous = row[0];
            row[0] = i + 1;
            for (j, cb) in b.iter().enumerate() {
                let current = row[j + 1];
                row[j + 1] = (previous + usize::from(ca != *cb)).min(row[j] + 1).min(current + 1);
                previous = current;
            }
        }
        row[b.len()]
    }
    candidates
        .into_iter()
        .map(|candidate| (distance(name, &candidate), candidate))
        .filter(|(distance, candidate)| *distance <= 2.max(candidate.len() / 3))
        .min()
        .map(|(_, candidate)| format!("; did you mean `{candidate}`?"))
        .unwrap_or_default()
}
