#!/usr/bin/env bash
# Installs Playwright's browsers and their system packages for CI: `tools/scripts/install-browsers.sh chromium webkit`, from a
# workspace whose Playwright is installed. A hosted runner's apt index can be stale (it names package versions its
# mirror no longer serves, a 404) and the Ubuntu mirrors sometimes fail to resolve, so on Linux the index is refreshed
# before each try, and the install is retried with backoff.
set -euo pipefail

for attempt in 1 2 3; do
  if { [ "$(uname -s)" != Linux ] || sudo apt-get update -qq; } && npm exec -- playwright install --with-deps "$@"; then
    exit 0
  fi
  if [ "$attempt" = 3 ]; then
    echo "The browsers didn't install after $attempt tries" >&2
    exit 1
  fi
  echo "The browser install failed (try $attempt); retrying in $((attempt * 30)) s" >&2
  sleep $((attempt * 30))
done
