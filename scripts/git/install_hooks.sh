#!/bin/sh
#
# Install this repository's git hooks.
#
# Git does not track .git/hooks, so hooks cannot travel with a clone. This
# script copies them into place and is the one command a fresh clone needs:
#
#   ./scripts/git/install_hooks.sh
#
# Run it again after pulling a change to the hooks themselves — copies do not
# update on their own.

set -eu

repository_root=$(git rev-parse --show-toplevel)
source_directory="$repository_root/scripts/git/hooks"
target_directory="$repository_root/.git/hooks"

if [ ! -d "$source_directory" ]; then
	echo "No hooks to install: $source_directory does not exist." >&2
	exit 1
fi

mkdir -p "$target_directory"

for hook in "$source_directory"/*; do
	[ -f "$hook" ] || continue
	name=$(basename "$hook")
	cp "$hook" "$target_directory/$name"
	chmod +x "$target_directory/$name"
	echo "installed $name"
done

if ! command -v gitleaks >/dev/null 2>&1; then
	echo
	echo "Warning: gitleaks is not installed, and the pre-commit hook needs it."
	echo "         brew install gitleaks"
fi
