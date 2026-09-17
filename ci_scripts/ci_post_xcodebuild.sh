#!/bin/bash

set -Eeuo pipefail

if [[ "${CI_XCODEBUILD_ACTION:-}" != "archive" ]]; then
  echo "[Velora CI] Post-xcodebuild signature verification skipped: action=${CI_XCODEBUILD_ACTION:-unknown}"
  exit 0
fi

if [[ -z "${CI_APP_STORE_SIGNED_APP_PATH:-}" ]]; then
  echo "[Velora CI] CI_APP_STORE_SIGNED_APP_PATH is unavailable; cannot verify exported App Store artifact" >&2
  exit 1
fi

echo "[Velora CI] Verifying App Store exported signatures"
echo "[Velora CI] App Store artifact: $CI_APP_STORE_SIGNED_APP_PATH"
echo "[Velora CI] Archive: ${CI_ARCHIVE_PATH:-unavailable}"

TMP_DIR=""
cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

extract_ipa() {
  local ipa="$1"
  TMP_DIR="$(mktemp -d)"
  /usr/bin/unzip -q "$ipa" -d "$TMP_DIR"
  find "$TMP_DIR/Payload" -maxdepth 2 -type d -name '*.app' -print -quit 2>/dev/null || true
}

find_app() {
  local artifact="$1"
  local app=""
  local ipa=""

  if [[ -d "$artifact" ]]; then
    app="$(find "$artifact" -maxdepth 6 -type d -name '*.app' -print -quit 2>/dev/null || true)"
    if [[ -n "$app" ]]; then
      printf '%s\n' "$app"
      return 0
    fi

    ipa="$(find "$artifact" -maxdepth 4 -type f -name '*.ipa' -print -quit 2>/dev/null || true)"
    if [[ -n "$ipa" ]]; then
      echo "[Velora CI] Found exported IPA: $ipa" >&2
      extract_ipa "$ipa"
      return 0
    fi

    echo "[Velora CI] Contents of App Store export directory:" >&2
    find "$artifact" -maxdepth 3 -print 2>/dev/null | head -80 >&2 || true
    return 1
  fi

  if [[ -f "$artifact" ]]; then
    case "$artifact" in
      *.ipa)
        extract_ipa "$artifact"
        return 0
        ;;
      *)
        TMP_DIR="$(mktemp -d)"
        if /usr/bin/unzip -q "$artifact" -d "$TMP_DIR" 2>/dev/null; then
          app="$(find "$TMP_DIR" -maxdepth 6 -type d -name '*.app' -print -quit 2>/dev/null || true)"
          if [[ -n "$app" ]]; then
            printf '%s\n' "$app"
            return 0
          fi
        fi
        ;;
    esac
  fi

  return 1
}

APP_PATH="$(find_app "$CI_APP_STORE_SIGNED_APP_PATH" || true)"
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "[Velora CI] Could not locate exported .app or .ipa inside CI_APP_STORE_SIGNED_APP_PATH" >&2
  exit 1
fi

echo "[Velora CI] Exported app: $APP_PATH"

print_signature() {
  local path="$1"
  local label="$2"

  if [[ ! -e "$path" ]]; then
    echo "[Velora CI] $label: not present"
    return 0
  fi

  echo "[Velora CI] ----- $label signing -----"
  /usr/bin/codesign -dv --verbose=4 "$path" 2>&1 \
    | /usr/bin/grep -E '^(Executable|Identifier|Format|CodeDirectory|Signature size|Authority|TeamIdentifier|Sealed Resources|Internal requirements)' \
    || true

  if /usr/bin/codesign --verify --strict --verbose=4 "$path" 2>&1; then
    echo "[Velora CI] $label signature: VALID"
  else
    echo "[Velora CI] $label signature: INVALID" >&2
    return 1
  fi
}

FAILED=0
print_signature "$APP_PATH" "app" || FAILED=1

for framework in WebRTC React ReactNativeDependencies hermes; do
  framework_path="$APP_PATH/Frameworks/$framework.framework"
  if [[ -d "$framework_path" ]]; then
    print_signature "$framework_path" "$framework.framework" || FAILED=1
  fi
done

if [[ -n "${CI_ARCHIVE_PATH:-}" && -d "${CI_ARCHIVE_PATH:-}" ]]; then
  ARCHIVE_APP="$(find "$CI_ARCHIVE_PATH/Products/Applications" -maxdepth 1 -type d -name '*.app' -print -quit 2>/dev/null || true)"
  if [[ -n "$ARCHIVE_APP" ]]; then
    echo "[Velora CI] ----- archive app signing -----"
    /usr/bin/codesign -dv --verbose=4 "$ARCHIVE_APP" 2>&1 \
      | /usr/bin/grep -E '^(Executable|Identifier|Authority|TeamIdentifier)' \
      || true
    if /usr/bin/codesign --verify --deep --strict --verbose=4 "$ARCHIVE_APP" 2>&1; then
      echo "[Velora CI] Archive app signature: VALID"
    else
      echo "[Velora CI] Archive app signature: INVALID" >&2
      FAILED=1
    fi
  fi
fi

if [[ "$FAILED" -ne 0 ]]; then
  echo "[Velora CI] Exported App Store artifact has an invalid code signature; stopping before upload." >&2
  exit 1
fi

echo "[Velora CI] App Store artifact signatures verified successfully"
