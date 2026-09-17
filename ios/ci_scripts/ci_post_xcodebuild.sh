#!/bin/sh

set -eu

# Xcode Cloud may invoke non-executable custom scripts through /bin/zsh instead
# of honoring the shebang. Keep this wrapper POSIX-compatible and explicitly
# hand off to bash because the root diagnostic script uses bash features.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec /bin/bash "$REPO_ROOT/ci_scripts/ci_post_xcodebuild.sh"
