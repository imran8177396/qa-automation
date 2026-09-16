#!/bin/sh
# Start the in-repo fixture site for lightweight Jenkins jobs (Linux/macOS agents).
# Does not print credentials. Port comes from QA_FIXTURE_PORT (default 4173).
set -eu

PORT="${QA_FIXTURE_PORT:-4173}"
export PORT

npx tsx scripts/testing/serve-fixture-site.ts &

i=0
while [ "$i" -lt 30 ]; do
  if command -v curl >/dev/null 2>&1; then
    if curl -sf "http://127.0.0.1:${PORT}/index.html" >/dev/null; then
      exit 0
    fi
  else
    if node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/index.html').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
      exit 0
    fi
  fi
  i=$((i + 1))
  sleep 1
done

echo "Fixture did not become ready on port ${PORT}" >&2
exit 1
