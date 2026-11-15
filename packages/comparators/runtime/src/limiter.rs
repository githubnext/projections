use super::{MAX_TABLE_ELEMENTS, MAX_TABLES};
use wasmi::ResourceLimiter;
use wasmi::errors::{MemoryError, TableError};
use wasmi_core::LimiterError;

/// Per-run resource limiter. It records denials so the host reports them even
/// when the module recovers from a failed `memory.grow`.
pub(super) struct Limiter {
    pub(super) max_memory_bytes: usize,
    pub(super) memory_exceeded: bool,
    pub(super) table_exceeded: bool,
}

impl Limiter {
    pub(super) fn new(max_memory_bytes: usize) -> Self {
        Self {
            max_memory_bytes,
            memory_exceeded: false,
            table_exceeded: false,
        }
    }
}

impl ResourceLimiter for Limiter {
    fn memory_growing(&mut self, _current: usize, desired: usize, maximum: Option<usize>) -> Result<bool, LimiterError> {
        if desired > self.max_memory_bytes {
            self.memory_exceeded = true;
            return Err(LimiterError::ResourceLimiterDeniedAllocation);
        }
        Ok(maximum.is_none_or(|maximum| desired <= maximum))
    }

    fn table_growing(&mut self, _current: usize, desired: usize, maximum: Option<usize>) -> Result<bool, LimiterError> {
        if desired > MAX_TABLE_ELEMENTS {
            self.table_exceeded = true;
            return Err(LimiterError::ResourceLimiterDeniedAllocation);
        }
        Ok(maximum.is_none_or(|maximum| desired <= maximum))
    }

    fn memory_grow_failed(&mut self, _error: &MemoryError) -> Result<(), LimiterError> {
        Ok(())
    }

    fn table_grow_failed(&mut self, _error: &TableError) -> Result<(), LimiterError> {
        Ok(())
    }

    fn instances(&self) -> usize {
        1
    }

    fn tables(&self) -> usize {
        MAX_TABLES
    }

    fn memories(&self) -> usize {
        1
    }
}
