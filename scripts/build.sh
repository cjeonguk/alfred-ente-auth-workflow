#!/bin/zsh
# Package src/ into dist/ente-auth.alfredworkflow.
set -euo pipefail

root="${0:A:h:h}"
out="$root/dist/ente-auth.alfredworkflow"
mkdir -p "$root/dist"
rm -f "$out"
(cd "$root/src" && zip -qr "$out" . -x '.*' 'prefs.plist')
echo "built $out"
