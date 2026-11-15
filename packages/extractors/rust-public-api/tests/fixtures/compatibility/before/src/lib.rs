//! A token-bucket rate limiter.

use std::time::Duration;

/// Requests allowed in a burst unless configured.
pub const DEFAULT_BURST: u32 = 10;

/// Whether a request may proceed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny { retry_after: Duration },
}

/// Limiter settings.
#[derive(Debug, Clone)]
pub struct Config {
    pub rate: u32,
    pub burst: u32,
}

/// A token bucket.
#[derive(Debug)]
pub struct Limiter {
    config: Config,
    tokens: u32,
}

impl Limiter {
    pub fn new(config: Config) -> Self {
        let tokens = config.burst;
        Limiter { config, tokens }
    }

    pub fn check(&mut self, cost: u32) -> Decision {
        if self.tokens >= cost {
            self.tokens -= cost;
            Decision::Allow
        } else {
            Decision::Deny { retry_after: Duration::from_secs(u64::from(cost) / u64::from(self.config.rate.max(1))) }
        }
    }

    pub fn reset(&mut self) {
        self.tokens = self.config.burst;
    }

    pub const fn capacity(&self) -> u32 {
        self.config.burst
    }
}

/// A source of time.
pub trait Clock {
    fn now(&self) -> Duration;
}

/// A limiter with the default burst.
pub fn limiter(rate: u32) -> Limiter {
    Limiter::new(Config { rate, burst: DEFAULT_BURST })
}

pub mod metrics {
    /// Tokens left.
    pub fn snapshot(limiter: &super::Limiter) -> u32 {
        limiter.capacity()
    }
}
