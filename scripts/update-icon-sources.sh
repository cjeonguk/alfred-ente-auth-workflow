#!/bin/zsh
# Pin the issuer icon sources in src/ente-auth.js to the latest ente-io/ente main
# and the simple-icons submodule commit it references.
set -euo pipefail

script="${0:A:h:h}/src/ente-auth.js"
ente=$(gh api repos/ente-io/ente/commits/main --jq .sha)
simple=$(gh api "repos/ente-io/ente/contents/mobile/apps/auth/assets/simple-icons?ref=$ente" --jq .sha)

sed -i '' \
  -e "s/^const ENTE_COMMIT = '[0-9a-f]*'/const ENTE_COMMIT = '$ente'/" \
  -e "s/^const SIMPLE_ICONS_COMMIT = '[0-9a-f]*'/const SIMPLE_ICONS_COMMIT = '$simple'/" \
  "$script"
echo "ENTE_COMMIT=$ente"
echo "SIMPLE_ICONS_COMMIT=$simple"
