# eBPF policy projection samples

The before and after revisions of the sample pull request in the
[eBPF policy projection proposal](../ebpf-policy-projection.md#sample-pull-request).
`protect-credentials.yaml` changes; `egress-audit.yaml` is identical in both and
gives the coverage view context.

The pull request:

1. adds a `Sigkill` selector (`token-read-by-downloader`) to the
   `security_file_permission` probe, for `curl` and `wget` reading the service
   account token;
2. broadens the policy's `podSelector` from `payments` to `payments` and
   `checkout`;
3. drops the `security_mmap_file` probe.

All four files pass Tetragon's own validation (`pkg/tracingpolicy.FromYAML`: the
CRD schema and its CEL rules) at cilium/tetragon
[`9b905a6`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03).
