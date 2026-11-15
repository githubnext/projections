//! A token-bucket rate limiter.

use std::rc::Rc;
use std::time::Duration;

/// Requests allowed in a burst unless configured.
pub const DEFAULT_BURST: u32 = 20;

/// Whether a request may proceed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny { retry_after: Duration },
    Throttle(u32),
}

/// Limiter settings.
#[derive(Debug, Clone)]
pub struct Config {
    pub rate: u32,
    pub burst: u32,
    pub window: Duration,
}

/// A token bucket.
#[derive(Debug)]
pub struct Limiter {
    config: Config,
    tokens: u32,
    history: Rc<Vec<u32>>,
}

impl Limiter {
    pub fn new(config: Config) -> Self {
        let tokens = config.burst;
        Limiter { config, tokens, history: Rc::new(Vec::new()) }
    }

    pub fn check(&mut self, cost: u32, key: &str) -> Decision {
        let _ = (key, &self.history);
        if self.tokens >= cost {
            self.tokens -= cost;
            Decision::Allow
        } else if cost > self.config.burst {
            Decision::Throttle(cost)
        } else {
            Decision::Deny { retry_after: self.config.window }
        }
    }

    pub fn capacity(&self) -> u32 {
        self.config.burst
    }

    pub fn remaining(&self) -> u32 {
        self.tokens
    }
}

/// A source of time.
pub trait Clock {
    fn now(&self) -> Duration;

    fn tick(&mut self);

    fn elapsed(&self, since: Duration) -> Duration {
        self.now().saturating_sub(since)
    }
}

/// Counters for one limiter.
#[non_exhaustive]
#[derive(Debug, Default)]
pub struct Stats {
    pub allowed: u64,
    pub denied: u64,
}

/// A limiter with the default burst.
pub fn limiter(rate: u32) -> Limiter {
    Limiter::new(Config { rate, burst: DEFAULT_BURST, window: Duration::from_secs(1) })
}

pub mod metrics {
    /// Tokens left.
    pub fn snapshot(limiter: &super::Limiter) -> u32 {
        limiter.remaining()
    }
}
