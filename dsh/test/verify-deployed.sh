#!/usr/bin/env bash
# Verify the code the browser actually received, not just the file on disk.
#
# The Dynamic Cordis Package is built from a cordis_define tool call, and the
# session transcript is the only durable record of the text it was handed. This
# pulls the newest such call back out and runs every suite against that exact
# text, so transcription drift between the workspace file and the deployed
# Package cannot hide. It has already caught two real incidents, including a
# dropped buildAnims() call that left every animation lookup undefined.
#
# This is deliberately NOT part of `npm test`: it needs a live DSH session with
# a petfox Package defined in it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST="$REPO/test"
# Override for a session in another workspace:
#   DSH_SESSIONS=~/.dsh/sessions/--home-you-proj-- ./test/verify-deployed.sh
SESSIONS="${DSH_SESSIONS:-$HOME/.dsh/sessions/--home-zerobyte-pet--}"
WORK="${VERIFY_WORKDIR:-$REPO/.verify}"
# Only define calls whose package name matches this are considered.
FILTER="${FOX_PACKAGE_FILTER:-Folio}"
OUT="$WORK/deployed.client.js"

if [ ! -d "$SESSIONS" ]; then
  echo "no session directory at $SESSIONS" >&2
  echo "set DSH_SESSIONS to the workspace's session directory" >&2
  exit 2
fi

mkdir -p "$WORK"
TRANSCRIPT="$(find "$SESSIONS" -name 'session.v3.jsonl.zstd' -printf '%T@ %p\n' | sort -rn | head -1 | cut -d' ' -f2-)"
echo "transcript: $TRANSCRIPT"

zstd -d -c "$TRANSCRIPT" > "$WORK/session.jsonl"

python3 - "$WORK/session.jsonl" "$OUT" "$FILTER" <<'PY'
import json, sys

src, out, wanted = sys.argv[1], sys.argv[2], sys.argv[3]
last = None
with open(src) as fh:
    for line in fh:
        if 'cordis_define' not in line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if rec.get('type') != 'tool/call':
            continue
        data = rec.get('data', {})
        if data.get('name') != 'cordis_define':
            continue
        try:
            args = json.loads(data.get('arguments') or '{}')
        except Exception:
            continue
        code = args.get('code') or {}
        if 'client' not in code:
            continue
        # A later define for any other client plugin would otherwise win, and the
        # fox suites would be run against unrelated code.
        if wanted.lower() not in str(args.get('name', '')).lower():
            continue
        last = (rec.get('seq'), args)

if last is None:
    sys.exit('no cordis_define call for %r carrying client code found in the transcript' % wanted)

seq, args = last
open(out, 'w').write(args['code']['client'])
print(f"extracted seq={seq} name={args.get('name')!r} -> {out}")
PY

echo
echo "### suites against the deployed artifact ###"
for suite in simulate-engine simulate-idle simulate-render-styles simulate-interactions; do
  printf '%-26s ' "$suite"
  FOX_CLIENT="$OUT" node "$TEST/$suite.mjs" | tail -1
done
