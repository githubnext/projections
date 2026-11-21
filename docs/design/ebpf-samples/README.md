# eBPF policy projection samples

These files are the before and after snapshots for the sample pull request in
the
[eBPF policy projection proposal](../ebpf-policy-projection.md#sample-pull-request).
Only `protect-credentials.yaml` changes between the two revisions;
`egress-audit.yaml` stays the same so the coverage view has surrounding context.

The pull request makes three changes:

1. It adds a `Sigkill` selector (`token-read-by-downloader`) to the
   `security_file_permission` probe when `curl` or `wget` tries to read the
   service account token.
2. It broadens the policy's `podSelector` from `payments` to both `payments` and
   `checkout`.
3. It removes the `security_mmap_file` probe.

All four files pass Tetragon's own validation (`pkg/tracingpolicy.FromYAML`,
which checks the CRD schema and its CEL rules) at cilium/tetragon
[`9b905a6`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03).
