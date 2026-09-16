#!/bin/bash

# Keep the generated native project deterministic immediately before Xcode
# Cloud invokes xcodebuild. This also makes the hook safe to run manually.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# CocoaPods recorded pnpm virtual paths, while Xcode Cloud can materialize the
# same packages only as direct node_modules links. Recreate the recorded paths
# whenever the corresponding direct package is available.
while IFS= read -r virtual_path; do
  virtual_path="${virtual_path%%\"*}"
  package_tail="${virtual_path##*/node_modules/}"
  package_first="${package_tail%%/*}"
  if [[ "$package_first" == @* ]]; then
    package_second="${package_tail#*/}"
    package_path="$package_first/${package_second%%/*}"
  else
    package_path="$package_first"
  fi
  virtual_base="${virtual_path%/$package_tail}"
  recorded_path="$REPO_ROOT/node_modules/$virtual_base/node_modules/$package_path"
  direct_path="$REPO_ROOT/node_modules/$package_path"
  if [[ -n "$package_path" && -e "$direct_path" && ! -e "$recorded_path" ]]; then
    mkdir -p "$(dirname "$recorded_path")"
    ln -s "$direct_path" "$recorded_path"
  fi
done < <(rg -o 'node_modules/\.pnpm/[^" ]+/node_modules/[^" ]+' "$REPO_ROOT/ios/Pods" 2>/dev/null | sed 's/:.*//' | sort -u)

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
SIMDJSON_HEADER="$(find -L "$REPO_ROOT/node_modules" -path '*/@nozbe/simdjson/src/simdjson.h' -type f -print -quit 2>/dev/null || true)"
SIMDJSON_CPP="$(find -L "$REPO_ROOT/node_modules" -path '*/@nozbe/simdjson/src/simdjson.cpp' -type f -print -quit 2>/dev/null || true)"
if [[ -z "$SIMDJSON_HEADER" || -z "$SIMDJSON_CPP" ]]; then
  echo "[Velora CI] simdjson sources are not materialized; downloading package 3.9.4"
  SIMDJSON_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/@nozbe/simdjson/-/simdjson-3.9.4.tgz' \
    --output "$SIMDJSON_TMP/simdjson.tgz"
  tar -xzf "$SIMDJSON_TMP/simdjson.tgz" -C "$SIMDJSON_TMP"
  SIMDJSON_HEADER="$SIMDJSON_TMP/package/src/simdjson.h"
  SIMDJSON_CPP="$SIMDJSON_TMP/package/src/simdjson.cpp"
fi
mkdir -p "$REPO_ROOT/ios/Pods/CloudSources/simdjson/src"
cp "$SIMDJSON_HEADER" "$REPO_ROOT/ios/Pods/CloudSources/simdjson/src/simdjson.h"
cp "$SIMDJSON_CPP" "$REPO_ROOT/ios/Pods/CloudSources/simdjson/src/simdjson.cpp"

WEBRTC_HEADER="$(find -L "$REPO_ROOT/node_modules" -path '*/react-native-webrtc/ios/RCTWebRTC/WebRTCModule.h' -type f -print -quit 2>/dev/null || true)"
if [[ -z "$WEBRTC_HEADER" ]]; then
  echo "[Velora CI] react-native-webrtc sources are not materialized; downloading package 124.0.7"
  WEBRTC_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/react-native-webrtc/-/react-native-webrtc-124.0.7.tgz' \
    --output "$WEBRTC_TMP/webrtc.tgz"
  tar -xzf "$WEBRTC_TMP/webrtc.tgz" -C "$WEBRTC_TMP"
  WEBRTC_HEADER="$WEBRTC_TMP/package/ios/RCTWebRTC/WebRTCModule.h"
  WEBRTC_SOURCE="$WEBRTC_TMP/package/ios/RCTWebRTC"
else
  WEBRTC_SOURCE="$(dirname "$WEBRTC_HEADER")"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/react-native-webrtc"
mkdir -p "$REPO_ROOT/ios/Pods/CloudSources/react-native-webrtc/ios"
cp -RL "$WEBRTC_SOURCE" "$REPO_ROOT/ios/Pods/CloudSources/react-native-webrtc/ios/"

REACT_NATIVE_ROOT="$(find -L "$REPO_ROOT/node_modules" -path '*/react-native/package.json' -type f -print -quit 2>/dev/null | sed 's#/package.json$##' || true)"
if [[ -z "$REACT_NATIVE_ROOT" ]]; then
  echo "[Velora CI] React Native sources are not materialized; downloading package 0.81.5"
  RN_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/react-native/-/react-native-0.81.5.tgz' \
    --output "$RN_TMP/react-native.tgz"
  tar -xzf "$RN_TMP/react-native.tgz" -C "$RN_TMP"
  REACT_NATIVE_ROOT="$RN_TMP/package"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/react-native"
cp -RL "$REACT_NATIVE_ROOT" "$REPO_ROOT/ios/Pods/CloudSources/react-native"

SKIA_ROOT="$(find -L "$REPO_ROOT/node_modules" -path '*/@shopify/react-native-skia/package.json' -type f -print -quit 2>/dev/null | sed 's#/package.json$##' || true)"
if [[ -z "$SKIA_ROOT" ]]; then
  echo "[Velora CI] React Native Skia sources are not materialized; downloading package 2.2.12"
  SKIA_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/@shopify/react-native-skia/-/react-native-skia-2.2.12.tgz' \
    --output "$SKIA_TMP/skia.tgz"
  tar -xzf "$SKIA_TMP/skia.tgz" -C "$SKIA_TMP"
  SKIA_ROOT="$SKIA_TMP/package"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/react-native-skia"
cp -RL "$SKIA_ROOT" "$REPO_ROOT/ios/Pods/CloudSources/react-native-skia"
SKIA_PNPM_PATH="$REPO_ROOT/node_modules/.pnpm/@shopify+react-native-skia@2.2.12_react-native-reanimated@4.1.7_react-native-worklets@0.5.1_@_zce5y6vf7xfwsgjhvc7fpoxxe4/node_modules/@shopify/react-native-skia"
mkdir -p "$(dirname "$SKIA_PNPM_PATH")"
ln -sfn "$REPO_ROOT/ios/Pods/CloudSources/react-native-skia" "$SKIA_PNPM_PATH"

if [[ ! -d "$REPO_ROOT/ios/Pods/JitsiWebRTC/WebRTC.xcframework/ios-arm64" ]]; then
  echo "[Velora CI] JitsiWebRTC binary is not present; downloading version 124.0.2"
  JITSI_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$JITSI_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://github.com/jitsi/webrtc/releases/download/v124.0.2/WebRTC.xcframework.zip' \
    --output "$JITSI_TMP/WebRTC.xcframework.zip"
  rm -rf "$REPO_ROOT/ios/Pods/JitsiWebRTC"
  mkdir -p "$REPO_ROOT/ios/Pods/JitsiWebRTC"
  unzip -q "$JITSI_TMP/WebRTC.xcframework.zip" -d "$REPO_ROOT/ios/Pods/JitsiWebRTC"
fi

cp "$REPO_ROOT/GoogleService-Info.plist" "$REPO_ROOT/ios/veloraDev/GoogleService-Info.plist"

if [[ -n "${CI_BUILD_NUMBER:-}" ]]; then
  echo "[Velora CI] Setting iOS build number to ${CI_BUILD_NUMBER}"
  (cd "$REPO_ROOT/ios" && agvtool new-version -all "$CI_BUILD_NUMBER")
else
  echo "[Velora CI] CI_BUILD_NUMBER is unavailable; keeping project build number"
fi

echo "[Velora CI] Workspace check passed"
