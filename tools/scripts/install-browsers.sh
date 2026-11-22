#!/usr/bin/env bash
# Installs Playwright's browsers and their system packages for CI: `tools/scripts/install-browsers.sh chromium webkit`, from a
# workspace whose Playwright is installed. A hosted runner's apt index can be stale (it names package versions its
# mirror no longer serves, a 404) and the Ubuntu mirrors sometimes fail to resolve, so on Linux the index is refreshed
# before each try, and the install is retried with backoff.
#
# A mirror can also serve at a trickle: the runner's Azure mirror has sent the usual 140 MB at 50 kB/s, taking 45
# minutes that the job's limit then lacked, where it usually takes seconds. apt has no lowest speed, so on Linux each
# try's system packages have `LIMIT_SECONDS` (several times the slowest healthy install), and a try that runs out drops
# the mirror it downloaded from, so the next try uses the runner's next one.
set -euo pipefail

LIMIT_SECONDS=${INSTALL_BROWSERS_LIMIT_SECONDS:-480}
MIRRORS=/etc/apt/apt-mirrors.txt
linux=$([ "$(uname -s)" = Linux ] && echo 1 || true)
windows=$(uname -s | grep -qE '^(MINGW|MSYS|CYGWIN)' && echo 1 || true)
log=$(mktemp)
trap 'rm -f "$log"' EXIT

if [ -n "$linux" ]; then
  # A connection that stalls outright is dropped and retried rather than waited on.
  printf 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\n' |
    sudo tee /etc/apt/apt.conf.d/99projections-ci-timeouts >/dev/null
fi

# The host most of the last try's packages came from, as apt printed them (`Get:12 http://host/ubuntu …`).
busiest_mirror() {
  grep -oE '^Get:[0-9]+ https?://[^/ ]+' "$log" | sed -E 's|.*//||' | sort | uniq -c | sort -rn | awk 'NR == 1 {print $2}'
}

# Drops `host` from the runner's mirror list, while another mirror remains to use instead.
drop_mirror() {
  local host=$1
  [ -n "$host" ] && [ -f "$MIRRORS" ] || return 0
  if [ "$(grep -cv "//$host/" "$MIRRORS")" -gt 0 ]; then
    echo "Dropping the mirror $host, which didn't finish in $LIMIT_SECONDS s" >&2
    sudo sed -i "\|//$host/|d" "$MIRRORS"
  fi
}

for attempt in 1 2 3; do
  if [ -n "$linux" ]; then
    # A try cut short may have left dpkg mid-way; finish what it unpacked before the next.
    sudo dpkg --configure -a || true
    status=0
    sudo apt-get update -qq || status=$?
    if [ "$status" = 0 ]; then
      # As root, Playwright runs apt-get itself, in `timeout`'s process group, which a timeout ends whole: apt-get
      # started through sudo outlived the signal, and a killed sudo left it running with dpkg's lock.
      sudo env "PATH=$PATH" timeout --kill-after=15 "$LIMIT_SECONDS" npm exec -- playwright install-deps "$@" 2>&1 |
        tee "$log" || status=$?
    fi
    [ "$status" = 0 ] && npm exec -- playwright install "$@" && exit 0
    [ "$status" = 124 ] && drop_mirror "$(busiest_mirror)"
  elif [ "$windows" ]; then
    # On Windows, --with-deps enables the Media Foundation feature, which takes three minutes and only plays media.
    npm exec -- playwright install "$@" && exit 0
  elif npm exec -- playwright install --with-deps "$@"; then
    exit 0
  fi
  if [ "$attempt" = 3 ]; then
    echo "The browsers didn't install after $attempt tries" >&2
    exit 1
  fi
  echo "The browser install failed (try $attempt); retrying in $((attempt * 30)) s" >&2
  sleep $((attempt * 30))
done
