#!/bin/zsh
# Symlink src/ into Alfred's workflows folder for development.
set -euo pipefail

src="${0:A:h:h}/src"
sync=$(defaults read com.runningwithcrayons.Alfred-Preferences syncfolder 2>/dev/null || true)
prefs="${${sync:-$HOME/Library/Application Support/Alfred}/#\~/$HOME}/Alfred.alfredpreferences"
dest="$prefs/workflows/user.workflow.ente-auth-dev"

if [[ -e "$dest" && ! -L "$dest" ]]; then
  echo "error: $dest exists and is not a symlink" >&2
  exit 1
fi
ln -sfn "$src" "$dest"
echo "linked $dest -> $src"
