#!/bin/bash
# Run as root on an expendable Debian 12+/Ubuntu 24.04 system.
set -euo pipefail
deb=$(realpath "${1:?Usage: linux-smoke.sh package.deb}")
dpkg -i "$deb"
cd /opt/electroplan
test "$(stat -c %U /var/lib/electroplan)" = electroplan
test "$(stat -c %a /etc/electroplan/electroplan.env)" = 640
if [ -d /run/systemd/system ]; then
  systemctl is-active --quiet electroplan
  curl --fail --retry 30 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/api/health
  systemctl stop electroplan
fi
runuser -u electroplan -- /bin/sh -c 'set -a; . /etc/electroplan/electroplan.env; set +a; cd /opt/electroplan; runtime/bin/node dist/server/cli.js backup'
# A second install must preserve configuration and migrate idempotently.
before=$(sha256sum /etc/electroplan/electroplan.env)
dpkg -i "$deb"
test "$before" = "$(sha256sum /etc/electroplan/electroplan.env)"
echo 'Installation, permissions, sauvegarde et réinstallation validées.'
