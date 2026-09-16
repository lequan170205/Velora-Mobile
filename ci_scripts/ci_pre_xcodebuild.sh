#!/bin/bash

# Keep the generated native project deterministic immediately before Xcode
# Cloud invokes xcodebuild. This also makes the hook safe to run manually.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -d "$REPO_ROOT/ios/veloraDev.xcworkspace" ]]; then
  echo "[Velora CI] Expected workspace was not generated: ios/veloraDev.xcworkspace" >&2
  exit 1
fi

if [[ -n "${GOOGLE_SERVICE_INFO_PLIST_BASE64:-}" ]]; then
  echo "[Velora CI] Restoring GoogleService-Info.plist from CI secret"
  if base64 --decode >/dev/null 2>&1 <<<""; then
    printf '%s' "$GOOGLE_SERVICE_INFO_PLIST_BASE64" | base64 --decode > "$REPO_ROOT/GoogleService-Info.plist"
  else
    printf '%s' "$GOOGLE_SERVICE_INFO_PLIST_BASE64" | base64 -D > "$REPO_ROOT/GoogleService-Info.plist"
  fi
fi

if [[ ! -f "$REPO_ROOT/GoogleService-Info.plist" ]]; then
  echo "[Velora CI] Missing GoogleService-Info.plist" >&2
  exit 1
fi

# Xcode Cloud may resolve pnpm dependencies without creating the optional
# package symlink that CocoaPods recorded for simdjson. Materialize the small
# native source pair at a stable path before xcodebuild reads the Pods project.
SIMDJSON_HEADER="$(find "$REPO_ROOT/node_modules" -path '*/@nozbe/simdjson/src/simdjson.h' -type f -print -quit 2>/dev/null || true)"
SIMDJSON_CPP="$(find "$REPO_ROOT/node_modules" -path '*/@nozbe/simdjson/src/simdjson.cpp' -type f -print -quit 2>/dev/null || true)"
if [[ -z "$SIMDJSON_HEADER" || -z "$SIMDJSON_CPP" ]]; then
  echo "[Velora CI] Could not locate simdjson native sources" >&2
  exit 1
fi
mkdir -p "$REPO_ROOT/ios/Pods/CloudSources/simdjson/src"
cp "$SIMDJSON_HEADER" "$REPO_ROOT/ios/Pods/CloudSources/simdjson/src/simdjson.h"
cp "$SIMDJSON_CPP" "$REPO_ROOT/ios/Pods/CloudSources/simdjson/src/simdjson.cpp"

cp "$REPO_ROOT/GoogleService-Info.plist" "$REPO_ROOT/ios/veloraDev/GoogleService-Info.plist"

if [[ -n "${CI_BUILD_NUMBER:-}" ]]; then
  echo "[Velora CI] Setting iOS build number to ${CI_BUILD_NUMBER}"
  (cd "$REPO_ROOT/ios" && agvtool new-version -all "$CI_BUILD_NUMBER")
else
  echo "[Velora CI] CI_BUILD_NUMBER is unavailable; keeping project build number"
fi

echo "[Velora CI] Workspace check passed"
