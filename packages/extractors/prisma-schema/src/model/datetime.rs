//! RFC 3339 date-time normalization for `DateTime` defaults.

/// Normalizes an RFC 3339 date-time as Prisma's DMMF does: an explicit `+HH:MM`
/// offset and fractional seconds of 0, 3, 6 or 9 digits.
pub(super) fn rfc3339(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let digits = |range: std::ops::Range<usize>| -> Option<u32> {
        let text = value.get(range)?;
        text.bytes().all(|b| b.is_ascii_digit()).then(|| text.parse().ok()).flatten()
    };
    let (year, month, day) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    let (hour, minute, second) = (digits(11..13)?, digits(14..16)?, digits(17..19)?);
    if bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || !matches!(bytes.get(10), Some(b'T' | b't' | b' '))
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if !(1..=12).contains(&month) || day == 0 || day > days[month as usize - 1] || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut rest = &value[19..];
    let mut nanos = 0u32;
    if let Some(fraction) = rest.strip_prefix('.') {
        let length = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if length == 0 {
            return None;
        }
        let padded = format!("{:0<9}", &fraction[..length.min(9)]);
        nanos = padded.parse().ok()?;
        rest = &fraction[length..];
    }
    let offset = offset(rest)?;
    let fraction = fraction(nanos);
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}{fraction}{offset}"
    ))
}

/// A UTC offset (`Z` or `±HH:MM`) as `+HH:MM`, with UTC always `+00:00`.
fn offset(rest: &str) -> Option<String> {
    if matches!(rest, "Z" | "z") {
        return Some("+00:00".to_owned());
    }
    let sign = rest.get(0..1)?;
    let (h, m) = (rest.get(1..3)?, rest.get(4..6)?);
    if !matches!(sign, "+" | "-")
        || rest.len() != 6
        || rest.as_bytes()[3] != b':'
        || !h.bytes().chain(m.bytes()).all(|b| b.is_ascii_digit())
        || h.parse::<u32>().ok()? > 23
        || m.parse::<u32>().ok()? > 59
    {
        return None;
    }
    if h == "00" && m == "00" {
        Some("+00:00".to_owned())
    } else {
        Some(rest.to_owned())
    }
}

/// Fractional seconds with 0, 3, 6 or 9 digits, as few as represent `nanos`.
fn fraction(nanos: u32) -> String {
    if nanos == 0 {
        String::new()
    } else if nanos % 1_000_000 == 0 {
        format!(".{:03}", nanos / 1_000_000)
    } else if nanos % 1_000 == 0 {
        format!(".{:06}", nanos / 1_000)
    } else {
        format!(".{nanos:09}")
    }
}
