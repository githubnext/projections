//! What a hook observes (its category) and how portable it is (its stability).
//!
//! Categories are derived from a small table of well-known kernel functions,
//! syscalls, LSM hooks and tracepoints, so they carry `derived` confidence.
//! Anything the table doesn't know is `other`; a probe's own tags never
//! override the table, because tags are free text.

/// Syscall entry points carry architecture and wrapper prefixes; Tetragon adds
/// them for `syscall: true` probes.
const SYSCALL_PREFIXES: &[&str] = &[
    "__x64_sys_",
    "__arm64_sys_",
    "__ia32_sys_",
    "__ia32_compat_sys_",
    "__se_sys_",
    "__do_sys_",
    "__sys_",
    "ksys_",
    "sys_",
];

/// The syscall a kernel function name is the entry point of, if any.
pub fn syscall(name: &str) -> Option<&str> {
    SYSCALL_PREFIXES
        .iter()
        .find_map(|prefix| name.strip_prefix(prefix))
        .filter(|rest| !rest.is_empty())
}

const SYSCALLS: &[(&str, &[&str])] = &[
    (
        "file",
        &[
            "open",
            "openat",
            "openat2",
            "creat",
            "read",
            "readv",
            "pread64",
            "write",
            "writev",
            "pwrite64",
            "close",
            "unlink",
            "unlinkat",
            "rename",
            "renameat",
            "renameat2",
            "truncate",
            "ftruncate",
            "chmod",
            "fchmod",
            "fchmodat",
            "chown",
            "fchown",
            "fchownat",
            "lchown",
            "link",
            "linkat",
            "symlink",
            "symlinkat",
            "mkdir",
            "mkdirat",
            "rmdir",
            "dup",
            "dup2",
            "dup3",
            "sendfile",
            "splice",
            "mmap",
            "mprotect",
            "memfd_create",
        ],
    ),
    (
        "credentials",
        &[
            "setuid",
            "setgid",
            "setreuid",
            "setregid",
            "setresuid",
            "setresgid",
            "setfsuid",
            "setfsgid",
            "setgroups",
            "capset",
        ],
    ),
    (
        "process",
        &[
            "execve",
            "execveat",
            "fork",
            "vfork",
            "clone",
            "clone3",
            "kill",
            "tkill",
            "tgkill",
            "ptrace",
            "exit",
            "exit_group",
            "prctl",
            "process_vm_readv",
            "process_vm_writev",
            "clock_settime",
            "settimeofday",
            "reboot",
        ],
    ),
    (
        "network",
        &[
            "socket",
            "connect",
            "bind",
            "listen",
            "accept",
            "accept4",
            "sendto",
            "sendmsg",
            "recvfrom",
            "recvmsg",
            "socketpair",
            "setsockopt",
        ],
    ),
    ("kernel-modules", &["init_module", "finit_module", "delete_module"]),
    ("bpf", &["bpf", "perf_event_open"]),
    (
        "namespaces",
        &[
            "setns",
            "unshare",
            "mount",
            "umount",
            "umount2",
            "pivot_root",
            "chroot",
            "fsopen",
            "fsmount",
            "move_mount",
            "open_tree",
        ],
    ),
];

/// Kernel functions and LSM hooks (with or without their `security_` prefix),
/// matched by prefix.
const FUNCTIONS: &[(&str, &[&str])] = &[
    (
        "credentials",
        &[
            "commit_creds",
            "prepare_creds",
            "override_creds",
            "cap_capable",
            "capset",
            "task_fix_set",
            "cred_",
        ],
    ),
    (
        "process",
        &[
            "bprm_",
            "wake_up_new_task",
            "task_",
            "ptrace_",
            "sched_process_",
            "do_exit",
            "acct_process",
            "kernel_clone",
        ],
    ),
    (
        "kernel-modules",
        &[
            "kernel_module_",
            "kernel_read_file",
            "kernel_load_data",
            "kernel_post_",
            "do_init_module",
            "free_module",
            "load_module",
        ],
    ),
    ("bpf", &["bpf", "bpf_"]),
    (
        "namespaces",
        &["sb_", "move_mount", "create_new_namespaces", "switch_task_namespaces", "path_mount"],
    ),
    (
        "network",
        &[
            "socket_",
            "sk_",
            "sock_",
            "tcp_",
            "udp_",
            "inet_",
            "ip_",
            "ip6_",
            "unix_",
            "dev_queue_xmit",
            "dev_hard_start_xmit",
            "__dev_queue_xmit",
            "netif_",
            "skb_",
            "xfrm_",
        ],
    ),
    (
        "file",
        &[
            "file_",
            "inode_",
            "path_",
            "mmap_",
            "fd_install",
            "vfs_",
            "do_sys_open",
            "filp_",
            "dentry_",
            "do_truncate",
            "security_file",
            "kernel_write",
            "kernel_read",
        ],
    ),
];

const TRACEPOINT_SUBSYSTEMS: &[(&str, &[&str])] = &[
    ("process", &["sched", "task", "signal", "oom"]),
    ("network", &["net", "sock", "tcp", "udp", "skb", "napi", "inet_sock"]),
    ("kernel-modules", &["module"]),
    ("bpf", &["bpf", "bpf_trace"]),
    ("file", &["filelock", "writeback", "fs"]),
    ("credentials", &["cred"]),
];

fn find(table: &[(&'static str, &[&str])], test: impl Fn(&str) -> bool) -> Option<&'static str> {
    table
        .iter()
        .find(|(_, names)| names.iter().any(|name| test(name)))
        .map(|(category, _)| *category)
}

/// The category of a kernel function (kprobe, fentry) or LSM hook.
pub fn function_category(name: &str) -> &'static str {
    if let Some(call) = syscall(name)
        && let Some(category) = find(SYSCALLS, |known| known == call.trim_end_matches("16"))
    {
        return category;
    }
    let bare = name.strip_prefix("security_").unwrap_or(name);
    find(FUNCTIONS, |known| bare.starts_with(known) || name.starts_with(known)).unwrap_or("other")
}

/// The category of a tracepoint.
pub fn tracepoint_category(subsystem: &str, event: &str) -> &'static str {
    if subsystem == "syscalls" {
        let call = event
            .strip_prefix("sys_enter_")
            .or_else(|| event.strip_prefix("sys_exit_"))
            .unwrap_or(event);
        return find(SYSCALLS, |known| known == call).unwrap_or("other");
    }
    find(TRACEPOINT_SUBSYSTEMS, |known| known == subsystem).unwrap_or("other")
}

/// How portable a hook is across kernels.
///
/// - `stable`: tracepoints and LSM hooks, which kernels keep as interfaces;
/// - `syscall`: syscall entry points, stable ABI though the symbol differs by
///   architecture;
/// - `kernel-internal`: other kernel functions, which may be renamed, inlined
///   or removed between versions;
/// - `user`: functions in user-space binaries;
/// - `generated`: generated from the running kernel when the policy loads.
pub fn function_stability(name: &str) -> &'static str {
    if syscall(name).is_some() { "syscall" } else { "kernel-internal" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorizes_well_known_hooks() {
        for (name, category) in [
            ("security_file_permission", "file"),
            ("security_mmap_file", "file"),
            ("fd_install", "file"),
            ("sys_write", "file"),
            ("__x64_sys_openat", "file"),
            ("commit_creds", "credentials"),
            ("__sys_setuid", "credentials"),
            ("__ia32_sys_setuid16", "credentials"),
            ("security_bprm_check", "process"),
            ("bprm_check_security", "process"),
            ("sys_ptrace", "process"),
            ("tcp_connect", "network"),
            ("security_socket_connect", "network"),
            ("socket_connect", "network"),
            ("do_init_module", "kernel-modules"),
            ("security_kernel_module_request", "kernel-modules"),
            ("sys_bpf", "bpf"),
            ("security_bpf_prog", "bpf"),
            ("sys_mount", "namespaces"),
            ("file_open", "file"),
            ("totally_unknown", "other"),
        ] {
            assert_eq!(function_category(name), category, "{name}");
        }
        assert_eq!(tracepoint_category("syscalls", "sys_enter_openat"), "file");
        assert_eq!(tracepoint_category("sched", "sched_process_exec"), "process");
        assert_eq!(tracepoint_category("raw_syscalls", "sys_enter"), "other");
        assert_eq!(function_stability("sys_write"), "syscall");
        assert_eq!(function_stability("security_file_permission"), "kernel-internal");
    }
}
