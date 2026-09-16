#!/bin/bash

set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/ci_scripts/ci_post_clone.sh"
