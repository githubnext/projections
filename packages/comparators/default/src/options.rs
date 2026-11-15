#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrderBy {
    /// Incoming relationships in the after extraction, or before for removals.
    Dependents,
    /// A numeric `data` field, read from the after side or before for removals.
    Data(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Options {
    /// Steps are sorted within each phase by the largest value of their members.
    pub order: Option<(OrderBy, bool)>,
}
