#!/bin/sh

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec /bin/bash "$REPO_ROOT/ci_scripts/ci_manual_appstore_resign.sh"
