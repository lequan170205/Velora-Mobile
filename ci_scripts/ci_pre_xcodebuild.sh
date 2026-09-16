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
done < <(rg -o --no-filename 'node_modules/\.pnpm/[^" ]+/node_modules/[^" ]+' "$REPO_ROOT/ios/Pods" 2>/dev/null | sort -u)

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

SAFE_AREA_ROOT="$(find -L "$REPO_ROOT/node_modules" -path '*/react-native-safe-area-context/package.json' -type f -print -quit 2>/dev/null | sed 's#/package.json$##' || true)"
if [[ -z "$SAFE_AREA_ROOT" ]]; then
  echo "[Velora CI] react-native-safe-area-context sources are not materialized; downloading package 5.6.2"
  SAFE_AREA_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/react-native-safe-area-context/-/react-native-safe-area-context-5.6.2.tgz' \
    --output "$SAFE_AREA_TMP/safe-area.tgz"
  tar -xzf "$SAFE_AREA_TMP/safe-area.tgz" -C "$SAFE_AREA_TMP"
  SAFE_AREA_ROOT="$SAFE_AREA_TMP/package"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/react-native-safe-area-context"
cp -RL "$SAFE_AREA_ROOT" "$REPO_ROOT/ios/Pods/CloudSources/react-native-safe-area-context"

PAGER_ROOT="$(find -L "$REPO_ROOT/node_modules" -path '*/react-native-pager-view/package.json' -type f -print -quit 2>/dev/null | sed 's#/package.json$##' || true)"
if [[ -z "$PAGER_ROOT" ]]; then
  echo "[Velora CI] react-native-pager-view sources are not materialized; downloading package 6.8.0"
  PAGER_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/react-native-pager-view/-/react-native-pager-view-6.8.0.tgz' \
    --output "$PAGER_TMP/pager.tgz"
  tar -xzf "$PAGER_TMP/pager.tgz" -C "$PAGER_TMP"
  PAGER_ROOT="$PAGER_TMP/package"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/react-native-pager-view"
cp -RL "$PAGER_ROOT" "$REPO_ROOT/ios/Pods/CloudSources/react-native-pager-view"

KEYBOARD_ROOT="$(find -L "$REPO_ROOT/node_modules" -path '*/react-native-keyboard-controller/package.json' -type f -print -quit 2>/dev/null | sed 's#/package.json$##' || true)"
if [[ -z "$KEYBOARD_ROOT" ]]; then
  echo "[Velora CI] react-native-keyboard-controller sources are not materialized; downloading package 1.21.7"
  KEYBOARD_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/react-native-keyboard-controller/-/react-native-keyboard-controller-1.21.7.tgz' \
    --output "$KEYBOARD_TMP/keyboard.tgz"
  tar -xzf "$KEYBOARD_TMP/keyboard.tgz" -C "$KEYBOARD_TMP"
  KEYBOARD_ROOT="$KEYBOARD_TMP/package"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/react-native-keyboard-controller"
cp -RL "$KEYBOARD_ROOT" "$REPO_ROOT/ios/Pods/CloudSources/react-native-keyboard-controller"

if [[ ! -f "$REPO_ROOT/ios/Pods/nanopb/pb.h" ]]; then
  echo "[Velora CI] nanopb sources are not materialized; downloading version 0.3.9.10"
  NANOPB_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://github.com/nanopb/nanopb/archive/refs/tags/0.3.9.10.tar.gz' \
    --output "$NANOPB_TMP/nanopb.tgz"
  tar -xzf "$NANOPB_TMP/nanopb.tgz" -C "$NANOPB_TMP"
  mkdir -p "$REPO_ROOT/ios/Pods/nanopb"
  find "$NANOPB_TMP/nanopb-0.3.9.10" -maxdepth 1 -type f -exec cp {} "$REPO_ROOT/ios/Pods/nanopb/" \;
  mkdir -p "$REPO_ROOT/ios/Pods/nanopb/spm_resources"
  cp "$NANOPB_TMP/nanopb-0.3.9.10/spm_resources/PrivacyInfo.xcprivacy" "$REPO_ROOT/ios/Pods/nanopb/spm_resources/"
fi

if [[ ! -f "$REPO_ROOT/ios/Pods/libwebp/src/webp/decode.h" ]]; then
  echo "[Velora CI] libwebp sources are not materialized; downloading version 1.5.0"
  LIBWEBP_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP" "$LIBWEBP_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://github.com/webmproject/libwebp/archive/refs/tags/v1.5.0.tar.gz' \
    --output "$LIBWEBP_TMP/libwebp.tgz"
  tar -xzf "$LIBWEBP_TMP/libwebp.tgz" -C "$LIBWEBP_TMP"
  rm -rf "$REPO_ROOT/ios/Pods/libwebp"
  cp -RL "$LIBWEBP_TMP/libwebp-1.5.0" "$REPO_ROOT/ios/Pods/libwebp"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/libwebp"
cp -RL "$REPO_ROOT/ios/Pods/libwebp" "$REPO_ROOT/ios/Pods/CloudSources/libwebp"

if [[ ! -f "$REPO_ROOT/ios/Pods/libdav1d/dav1d/include/dav1d.h" ]]; then
  echo "[Velora CI] libdav1d sources are not materialized; downloading version 1.2.0"
  LIBDAV1D_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP" "$LIBWEBP_TMP" "$LIBDAV1D_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://github.com/SDWebImage/libdav1d-Xcode/archive/refs/tags/1.2.0.tar.gz' \
    --output "$LIBDAV1D_TMP/libdav1d.tgz"
  tar -xzf "$LIBDAV1D_TMP/libdav1d.tgz" -C "$LIBDAV1D_TMP"
  git clone --quiet --depth 1 --branch 1.2.0 \
    'https://github.com/videolan/dav1d.git' \
    "$LIBDAV1D_TMP/libdav1d-Xcode-1.2.0/dav1d"
  rm -rf "$REPO_ROOT/ios/Pods/libdav1d"
  cp -RL "$LIBDAV1D_TMP/libdav1d-Xcode-1.2.0" "$REPO_ROOT/ios/Pods/libdav1d"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/libdav1d"
cp -RL "$REPO_ROOT/ios/Pods/libdav1d" "$REPO_ROOT/ios/Pods/CloudSources/libdav1d"
if [[ ! -f "$REPO_ROOT/ios/Pods/CloudSources/libdav1d/dav1d/include/dav1d/version.h" ]]; then
  rm -f "$REPO_ROOT/ios/Pods/CloudSources/libdav1d/dav1d/include/dav1d/version.h"
  mkdir -p "$REPO_ROOT/ios/Pods/CloudSources/libdav1d/dav1d/include/dav1d"
  cat > "$REPO_ROOT/ios/Pods/CloudSources/libdav1d/dav1d/include/dav1d/version.h" <<'EOF'
#ifndef DAV1D_VERSION_H
#define DAV1D_VERSION_H
#define DAV1D_API_VERSION_MAJOR 6
#define DAV1D_API_VERSION_MINOR 9
#define DAV1D_API_VERSION_PATCH 0
#endif
EOF
fi

if [[ ! -f "$REPO_ROOT/ios/Pods/libavif/include/avif/avif.h" || ! -f "$REPO_ROOT/ios/Pods/libavif/include/avif/internal.h" ]]; then
  echo "[Velora CI] libavif sources are not materialized; downloading version 1.0.0"
  LIBAVIF_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP" "$LIBWEBP_TMP" "$LIBDAV1D_TMP" "$LIBAVIF_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://github.com/AOMediaCodec/libavif/archive/refs/tags/v1.0.0.tar.gz' \
    --output "$LIBAVIF_TMP/libavif.tgz"
  tar -xzf "$LIBAVIF_TMP/libavif.tgz" -C "$LIBAVIF_TMP"
  rm -rf "$REPO_ROOT/ios/Pods/libavif"
  cp -RL "$LIBAVIF_TMP/libavif-1.0.0" "$REPO_ROOT/ios/Pods/libavif"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/libavif"
cp -RL "$REPO_ROOT/ios/Pods/libavif" "$REPO_ROOT/ios/Pods/CloudSources/libavif"

EXPO_DEV_LAUNCHER_ROOT="$(find -L "$REPO_ROOT/node_modules" -path '*/expo-dev-launcher/package.json' -type f -print -quit 2>/dev/null | sed 's#/package.json$##' || true)"
if [[ -z "$EXPO_DEV_LAUNCHER_ROOT" ]]; then
  echo "[Velora CI] expo-dev-launcher sources are not materialized; downloading version 6.0.21"
  EXPO_DEV_LAUNCHER_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP" "$LIBWEBP_TMP" "$LIBDAV1D_TMP" "$LIBAVIF_TMP" "$EXPO_DEV_LAUNCHER_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/expo-dev-launcher/-/expo-dev-launcher-6.0.21.tgz' \
    --output "$EXPO_DEV_LAUNCHER_TMP/expo-dev-launcher.tgz"
  tar -xzf "$EXPO_DEV_LAUNCHER_TMP/expo-dev-launcher.tgz" -C "$EXPO_DEV_LAUNCHER_TMP"
  EXPO_DEV_LAUNCHER_ROOT="$EXPO_DEV_LAUNCHER_TMP/package"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/expo-dev-launcher"
cp -RL "$EXPO_DEV_LAUNCHER_ROOT" "$REPO_ROOT/ios/Pods/CloudSources/expo-dev-launcher"

if [[ ! -f "$REPO_ROOT/ios/Pods/ZXingObjC/ZXingObjC/ZXingObjC.h" ]]; then
  echo "[Velora CI] ZXingObjC sources are not materialized; downloading version 3.6.9"
  ZXING_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP" "$LIBWEBP_TMP" "$LIBDAV1D_TMP" "$LIBAVIF_TMP" "$EXPO_DEV_LAUNCHER_TMP" "$ZXING_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://github.com/zxingify/zxingify-objc/archive/refs/tags/3.6.9.tar.gz' \
    --output "$ZXING_TMP/zxing.tgz"
  tar -xzf "$ZXING_TMP/zxing.tgz" -C "$ZXING_TMP"
  rm -rf "$REPO_ROOT/ios/Pods/ZXingObjC"
  cp -RL "$ZXING_TMP/zxingify-objc-3.6.9" "$REPO_ROOT/ios/Pods/ZXingObjC"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/ZXingObjC"
cp -RL "$REPO_ROOT/ios/Pods/ZXingObjC" "$REPO_ROOT/ios/Pods/CloudSources/ZXingObjC"

if [[ ! -f "$REPO_ROOT/ios/Pods/WatermelonDB/native/ios/WatermelonDB/WatermelonDB.h" ]]; then
  echo "[Velora CI] WatermelonDB sources are not materialized; downloading version 0.28.0"
  WATERMELON_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP" "$LIBWEBP_TMP" "$LIBDAV1D_TMP" "$LIBAVIF_TMP" "$EXPO_DEV_LAUNCHER_TMP" "$ZXING_TMP" "$WATERMELON_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://registry.npmjs.org/@nozbe/watermelondb/-/watermelondb-0.28.0.tgz' \
    --output "$WATERMELON_TMP/watermelondb.tgz"
  tar -xzf "$WATERMELON_TMP/watermelondb.tgz" -C "$WATERMELON_TMP"
  rm -rf "$REPO_ROOT/ios/Pods/WatermelonDB"
  cp -RL "$WATERMELON_TMP/package" "$REPO_ROOT/ios/Pods/WatermelonDB"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/WatermelonDB"
cp -RL "$REPO_ROOT/ios/Pods/WatermelonDB" "$REPO_ROOT/ios/Pods/CloudSources/WatermelonDB"

if [[ ! -f "$REPO_ROOT/ios/Pods/SDWebImageWebPCoder/SDWebImageWebPCoder/Classes/SDWebImageWebPCoder.h" ]]; then
  echo "[Velora CI] SDWebImageWebPCoder sources are not materialized; downloading version 0.14.6"
  SDWEBP_CODER_TMP="$(mktemp -d)"
  trap 'rm -rf "$SIMDJSON_TMP" "$WEBRTC_TMP" "$RN_TMP" "$SKIA_TMP" "$SAFE_AREA_TMP" "$PAGER_TMP" "$KEYBOARD_TMP" "$NANOPB_TMP" "$LIBWEBP_TMP" "$LIBDAV1D_TMP" "$LIBAVIF_TMP" "$EXPO_DEV_LAUNCHER_TMP" "$ZXING_TMP" "$WATERMELON_TMP" "$SDWEBP_CODER_TMP"' EXIT
  curl --fail --silent --show-error --location \
    'https://github.com/SDWebImage/SDWebImageWebPCoder/archive/refs/tags/0.14.6.tar.gz' \
    --output "$SDWEBP_CODER_TMP/webp-coder.tgz"
  tar -xzf "$SDWEBP_CODER_TMP/webp-coder.tgz" -C "$SDWEBP_CODER_TMP"
  rm -rf "$REPO_ROOT/ios/Pods/SDWebImageWebPCoder"
  cp -RL "$SDWEBP_CODER_TMP/SDWebImageWebPCoder-0.14.6" "$REPO_ROOT/ios/Pods/SDWebImageWebPCoder"
fi
rm -rf "$REPO_ROOT/ios/Pods/CloudSources/SDWebImageWebPCoder"
cp -RL "$REPO_ROOT/ios/Pods/SDWebImageWebPCoder" "$REPO_ROOT/ios/Pods/CloudSources/SDWebImageWebPCoder"

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
