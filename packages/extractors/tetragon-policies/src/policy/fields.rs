//! Field names of Tetragon's CRD types that the mapping reads, and the
//! limits and action vocabularies it checks selectors against.

pub(super) const SPEC_FIELDS: &[&str] = &[
    "kprobes",
    "tracepoints",
    "loader",
    "uprobes",
    "lsmhooks",
    "usdts",
    "fentries",
    "podSelector",
    "containerSelector",
    "hostSelector",
    "nodeSelector",
    "lists",
    "enforcers",
    "options",
    "selectorsMacros",
    "state",
];
pub(super) const KPROBE_FIELDS: &[&str] = &[
    "call",
    "return",
    "syscall",
    "message",
    "args",
    "data",
    "returnArg",
    "returnArgAction",
    "selectors",
    "tags",
    "ignore",
];
pub(super) const TRACEPOINT_FIELDS: &[&str] = &["subsystem", "event", "message", "args", "selectors", "tags", "raw"];
pub(super) const UPROBE_FIELDS: &[&str] = &[
    "path",
    "btfPath",
    "symbols",
    "offsets",
    "addrs",
    "refCtrOffsets",
    "message",
    "selectors",
    "args",
    "data",
    "tags",
    "return",
    "returnArg",
    "binaryDigests",
    "ignore",
];
pub(super) const USDT_FIELDS: &[&str] = &["path", "btfPath", "provider", "name", "tags", "message", "args", "selectors"];
pub(super) const LSM_FIELDS: &[&str] = &["hook", "message", "args", "selectors", "tags"];
pub(super) const SELECTOR_FIELDS: &[&str] = &[
    "label",
    "matchPIDs",
    "matchArgs",
    "matchCmdArgs",
    "matchData",
    "matchActions",
    "matchReturnArgs",
    "matchReturnActions",
    "matchBinaries",
    "matchParentBinaries",
    "matchNamespaces",
    "matchNamespaceChanges",
    "matchCapabilities",
    "matchCapabilityChanges",
    "matchWorkloads",
    "matchUserCallers",
    "matchStates",
    "macros",
    "matchCEL",
];
/// Filters that a selector macro appends to, in display order.
pub(super) const FILTERS: &[&str] = &[
    "matchArgs",
    "matchData",
    "matchReturnArgs",
    "matchCmdArgs",
    "matchPIDs",
    "matchNamespaces",
    "matchNamespaceChanges",
    "matchCapabilities",
    "matchCapabilityChanges",
    "matchUserCallers",
    "matchStates",
];
pub(super) const LIST_FIELDS: &[&str] = &["matchActions", "matchReturnActions", "matchBinaries", "matchParentBinaries"];
/// <https://tetragon.io/docs/concepts/tracing-policy/selectors/#limitations>
pub(super) const MAX_SELECTORS: usize = 5;
pub(super) const MAX_ACTIONS: usize = 3;

pub(super) const ENFORCING: &[&str] = &["Sigkill", "Signal", "Override", "NotifyEnforcer"];
pub(super) const RESPONDING: &[&str] = &["GetUrl", "DnsLookup"];
pub(super) const TRACKING: &[&str] = &["TrackSock", "UntrackSock", "Set", "UpdateState", "CleanupEnforcerNotification"];
pub(super) const KNOWN_ACTIONS: &[&str] = &[
    "Post",
    "NoPost",
    "Sigkill",
    "Signal",
    "Override",
    "NotifyEnforcer",
    "GetUrl",
    "DnsLookup",
    "TrackSock",
    "UntrackSock",
    "Set",
    "UpdateState",
    "CleanupEnforcerNotification",
];
