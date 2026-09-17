#!/bin/bash

# Keep this hook intentionally small. ci_post_clone.sh owns dependency setup;
# immediately before xcodebuild we only verify that the generated native state
# is complete and consistent.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_paths=(
  "$REPO_ROOT/node_modules/expo/package.json"
  "$REPO_ROOT/node_modules/react-native/package.json"
  "$REPO_ROOT/ios/veloraDev.xcworkspace"
  "$REPO_ROOT/ios/Pods/Manifest.lock"
  "$REPO_ROOT/ios/Pods/Target Support Files/Pods-veloraDev/Pods-veloraDev-frameworks.sh"
  "$REPO_ROOT/ios/Pods/Target Support Files/Pods-veloraDev/Pods-veloraDev-resources.sh"
  "$REPO_ROOT/ios/.xcode.env"
  "$REPO_ROOT/GoogleService-Info.plist"
)

for path in "${required_paths[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "[Velora CI] Missing required build input: $path" >&2
    exit 1
  fi
done

if ! cmp -s "$REPO_ROOT/ios/Podfile.lock" "$REPO_ROOT/ios/Pods/Manifest.lock"; then
  echo "[Velora CI] Pods are out of sync with Podfile.lock" >&2
  exit 1
fi

APNS_ENVIRONMENT="$(/usr/libexec/PlistBuddy -c 'Print :aps-environment' "$REPO_ROOT/ios/veloraDev/veloraDev.entitlements")"
if [[ "$APNS_ENVIRONMENT" != "production" ]]; then
  echo "[Velora CI] Release archive requires production APNs entitlement, found: $APNS_ENVIRONMENT" >&2
  exit 1
fi

echo "[Velora CI] Native dependencies validated; starting xcodebuild"
