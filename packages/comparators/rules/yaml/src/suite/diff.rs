/// A line diff of `expected` and `actual`: `-` lines only expected, `+` lines
/// only actual, with up to three lines of context around each difference.
pub fn diff(expected: &str, actual: &str) -> String {
    const CONTEXT: usize = 3;
    const MAX_LINES: usize = 200;
    let old: Vec<&str> = expected.lines().collect();
    let new: Vec<&str> = actual.lines().collect();
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let (a, b) = (&old[prefix..old.len() - suffix], &new[prefix..new.len() - suffix]);
    // Each line: ' ', '-' or '+'.
    let mut edits: Vec<(char, &str)> = old[..prefix].iter().map(|line| (' ', *line)).collect();
    if a.len().saturating_mul(b.len()) <= 4_000_000 {
        let mut lengths = vec![vec![0u32; b.len() + 1]; a.len() + 1];
        for i in (0..a.len()).rev() {
            for j in (0..b.len()).rev() {
                lengths[i][j] = if a[i] == b[j] {
                    lengths[i + 1][j + 1] + 1
                } else {
                    lengths[i + 1][j].max(lengths[i][j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < a.len() || j < b.len() {
            if i < a.len() && j < b.len() && a[i] == b[j] {
                edits.push((' ', a[i]));
                i += 1;
                j += 1;
            } else if i < a.len() && (j == b.len() || lengths[i + 1][j] >= lengths[i][j + 1]) {
                edits.push(('-', a[i]));
                i += 1;
            } else {
                edits.push(('+', b[j]));
                j += 1;
            }
        }
    } else {
        edits.extend(a.iter().map(|line| ('-', *line)));
        edits.extend(b.iter().map(|line| ('+', *line)));
    }
    edits.extend(old[old.len() - suffix..].iter().map(|line| (' ', *line)));
    let changed: Vec<usize> = edits
        .iter()
        .enumerate()
        .filter(|(_, (mark, _))| *mark != ' ')
        .map(|(index, _)| index)
        .collect();
    let mut lines = vec!["--- expected".to_owned(), "+++ actual".to_owned()];
    let mut shown_until = 0;
    let mut omitted = 0;
    for &index in &changed {
        let start = index.saturating_sub(CONTEXT).max(shown_until);
        let end = (index + CONTEXT + 1).min(edits.len());
        if start > shown_until {
            lines.push("…".to_owned());
        }
        for (mark, line) in &edits[start..end.max(start)] {
            if lines.len() >= MAX_LINES {
                omitted += 1;
                continue;
            }
            lines.push(format!("{mark}{line}"));
        }
        shown_until = end.max(shown_until);
    }
    if shown_until < edits.len() && !changed.is_empty() {
        lines.push("…".to_owned());
    }
    if omitted > 0 {
        lines.push(format!("… {omitted} more lines"));
    }
    lines.join("\n")
}
