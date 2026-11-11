#!/bin/bash
set -eu
probe_script=$(realpath "$(dirname "$0")/package-probe.mjs")
cd /opt/electroplan
set -a
. /etc/electroplan/electroplan.env
set +a
runuser -u electroplan -- runtime/bin/node dist/server/index.js >/tmp/electroplan-probe.log 2>&1 &
probe_pid=$!
trap 'kill -TERM "$probe_pid" 2>/dev/null || true; wait "$probe_pid" 2>/dev/null || true' EXIT
runtime/bin/node "$probe_script" || { cat /tmp/electroplan-probe.log; exit 1; }
