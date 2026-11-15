Serves what the Inspector shows (definitions, revisions and pairs, extraction
jobs, comparators, the Explore view, sweeps and their thumbnails, adopting and
saving definitions, and working-tree changes) to an editor extension that starts
it, as JSON-RPC 2.0 over standard input and output: one JSON message per line.
There is no port, token or listener. The Explore view sweeps, opens and adopts
`projections explore`'s candidates. While the working tree defines no
projections it is an explore session, as `projections explore`: the candidates
are listed as trial definitions, and adopting writes their files; otherwise the
Inspector lists only the repository's projections and writing needs --trust.
Standard output carries only protocol messages; diagnostics go to standard
error. It exits when standard input closes, on `exit`, or on a signal.
