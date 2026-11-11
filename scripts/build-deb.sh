#!/bin/bash
# Run on Debian 12+/Ubuntu 24.04 amd64. Produces a fully offline runtime package.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v dpkg-deb >/dev/null
command -v node >/dev/null
test "$(node -p 'process.platform+":"+process.arch')" = linux:x64 || { echo 'Build on Linux amd64.' >&2; exit 1; }
test "$(node -p 'process.versions.node.split(".")[0]')" = 22 || { echo 'Node 22 required.' >&2; exit 1; }
version=$(node -p "require('./package.json').version")
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/DEBIAN" "$stage/opt/electroplan" "$stage/lib/systemd/system" artifacts
mkdir -p "$stage/usr/share/doc/electroplan"
[ ! -f README.md ] || cp README.md "$stage/usr/share/doc/electroplan/"
[ ! -d docs ] || cp -a docs "$stage/usr/share/doc/electroplan/"
npm ci
npm run check
npm run build
npm test
cp -a dist prisma package.json package-lock.json "$stage/opt/electroplan/"
# Prisma CLI is needed at installation/start for migrations. Ship locked dependencies including it.
cp -a node_modules "$stage/opt/electroplan/"
mkdir -p "$stage/opt/electroplan/runtime/bin"
cp "$(command -v node)" "$stage/opt/electroplan/runtime/bin/node"
cp packaging/electroplan.service "$stage/lib/systemd/system/"
chmod 0644 "$stage/lib/systemd/system/electroplan.service"
cp packaging/debian/* "$stage/DEBIAN/"
sed -i "s/Version: VERSION/Version: $version/" "$stage/DEBIAN/control"
chmod 0755 "$stage/DEBIAN/"{preinst,postinst,prerm,postrm}
dpkg-deb --root-owner-group --build "$stage" "artifacts/electroplan_${version}_amd64.deb"
(cd artifacts && sha256sum "electroplan_${version}_amd64.deb" > "electroplan_${version}_amd64.deb.sha256")
