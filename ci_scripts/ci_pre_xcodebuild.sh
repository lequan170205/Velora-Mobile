#!/bin/bash

# Keep this hook intentionally small. ci_post_clone.sh owns dependency setup;
# immediately before xcodebuild we verify generated native state and normalize
# signing so Xcode Cloud can select the correct identity for each distribution.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_FILE="$REPO_ROOT/ios/veloraDev.xcodeproj/project.pbxproj"

required_paths=(
  "$REPO_ROOT/node_modules/expo/package.json"
  "$REPO_ROOT/node_modules/react-native/package.json"
  "$REPO_ROOT/ios/veloraDev.xcworkspace"
  "$REPO_ROOT/ios/Pods/Manifest.lock"
  "$REPO_ROOT/ios/Pods/Target Support Files/Pods-veloraDev/Pods-veloraDev-frameworks.sh"
  "$REPO_ROOT/ios/Pods/Target Support Files/Pods-veloraDev/Pods-veloraDev-resources.sh"
  "$REPO_ROOT/ios/.xcode.env"
  "$REPO_ROOT/GoogleService-Info.plist"
  "$PROJECT_FILE"
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

# The checked-in Xcode project was generated with explicit development signing
# identities. Those settings override Xcode Cloud automatic signing and cause
# App Store exports (including embedded React/WebRTC/Hermes frameworks) to be
# signed with the wrong identity. Remove only the legacy explicit identity
# settings and keep CODE_SIGN_STYLE=Automatic + DEVELOPMENT_TEAM intact.
/usr/bin/sed -i '' \
  -e '/^[[:space:]]*CODE_SIGN_IDENTITY = "Apple Development";[[:space:]]*$/d' \
  -e '/^[[:space:]]*"CODE_SIGN_IDENTITY\[sdk=iphoneos\*\]" = "iPhone Developer";[[:space:]]*$/d' \
  "$PROJECT_FILE"

if /usr/bin/grep -Eq 'CODE_SIGN_IDENTITY = "Apple Development"|CODE_SIGN_IDENTITY\[sdk=iphoneos\*\].*iPhone Developer' "$PROJECT_FILE"; then
  echo "[Velora CI] Explicit development signing identity is still present in the Xcode project" >&2
  exit 1
fi

echo "[Velora CI] Automatic signing normalized for Xcode Cloud distribution"
echo "[Velora CI] Native dependencies validated; starting xcodebuild"
