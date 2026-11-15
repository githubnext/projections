Thanks for helping make GitHub safe for everyone.

# Security

GitHub takes the security of our software products and services seriously,
including all of the open source code repositories managed through our GitHub
organizations, such as [GitHub](https://github.com/GitHub).

Even though
[open source repositories are outside the scope of our bug bounty program](https://bounty.github.com/scope)
and therefore not eligible for bounty rewards, we will ensure that your finding
gets passed along to the appropriate maintainers for remediation.

## Reporting security issues

If you believe you have found a security vulnerability in any GitHub-owned
repository, please report it to us through coordinated disclosure.

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, please send an email to opensource-security[@]github.com.

Please include as much of the information listed below as you can to help us
better understand and resolve the issue:

- The type of issue (e.g., buffer overflow, SQL injection, or cross-site
  scripting)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

This information will help us triage your report more quickly.

For Projections, also name the affected release, package and platform, and give
a minimal synthetic reproduction with expected and observed behavior and
sanitized diagnostics. Don't send real tokens or private artifacts, and don't
post credentials, private repository data, signed download URLs or exploit
details anywhere public. Projections is pre-1.0 and makes no response-time or
support commitment; see the [support policy](docs/guides/support.md).

## Policy

See
[GitHub's Safe Harbor Policy](https://docs.github.com/en/site-policy/security-policies/github-bug-bounty-program-legal-safe-harbor#1-safe-harbor-terms).

## Execution and data boundaries

Artifacts and repository-authored configuration are untrusted input. Integrity
hashes establish bytes, not producer trust or authorization. Anything that
displays CI artifacts consumes them and never runs repository extractors.

Local extractors can execute repository code only under their explicit trust
policy. A trusted local process is not an operating-system sandbox: extractors,
including the built-in ones that run builds or application startup code, have no
network or filesystem sandbox, so trust is the control. Optional container
restrictions and their tested scope are documented in
[runner coverage](docs/maintainers/runner-coverage.md). Local PR acquisition
never grants execution trust to a head revision or forwards acquisition
credentials to extractors.

## Dependency vulnerabilities

Every pull request runs GitHub's dependency review, which fails on a new or
upgraded dependency with a known high or critical advisory. Dependabot alerts
and security update pull requests cover npm and Cargo dependencies that are
already locked, and a weekly OSV scan of the root lockfiles catches advisories
published since. See
[Vulnerabilities in dependencies](CONTRIBUTING.md#vulnerabilities-in-dependencies).
Report a vulnerability in Projections itself by email, as above.

Dependency and toolchain updates need the applicable native, browser and packed
consumer checks. Advisory databases don't cover external language tools, prove
sandboxing or establish that a deployment is secure.
