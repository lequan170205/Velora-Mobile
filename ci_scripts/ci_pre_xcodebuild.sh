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

echo "[Velora CI] Installing JavaScript dependencies"
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
else
  PNPM=(npm exec --yes --package=pnpm@9.15.0 -- pnpm)
fi
"${PNPM[@]}" install --frozen-lockfile

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

echo "[Velora CI] Syncing Expo native configuration and CocoaPods"
npx expo prebuild --platform ios --no-install
(cd "$REPO_ROOT/ios" && pod install)

SIMDJSON_PBX="$REPO_ROOT/ios/Pods/Pods.xcodeproj/project.pbxproj"
perl -0pi -e 's#\.\./\.\./\.\./node_modules/\.pnpm/\@nozbe\+simdjson#../../../.pnpm/\@nozbe+simdjson#g' "$SIMDJSON_PBX"

cp "$REPO_ROOT/GoogleService-Info.plist" "$REPO_ROOT/ios/veloraDev/GoogleService-Info.plist"

if [[ -n "${CI_BUILD_NUMBER:-}" ]]; then
  echo "[Velora CI] Setting iOS build number to ${CI_BUILD_NUMBER}"
  (cd "$REPO_ROOT/ios" && agvtool new-version -all "$CI_BUILD_NUMBER")
else
  echo "[Velora CI] CI_BUILD_NUMBER is unavailable; keeping project build number"
fi

echo "[Velora CI] Workspace check passed"
