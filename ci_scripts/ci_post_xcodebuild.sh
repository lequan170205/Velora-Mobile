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
IPA_PATH=""
cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

extract_ipa() {
  local ipa="$1"
  IPA_PATH="$ipa"
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

strict_app_valid() {
  /usr/bin/codesign --verify --deep --strict --verbose=4 "$APP_PATH"
}

extract_entitlements() {
  local code="$1"
  local output="$2"
  : > "$output"
  /usr/bin/codesign -d --entitlements :- "$code" > "$output" 2>/dev/null || true
  if ! /usr/bin/plutil -lint "$output" >/dev/null 2>&1; then
    : > "$output"
  fi
}

resign_preserving_entitlements() {
  local code="$1"
  local identity="$2"
  local requirement="$3"
  local entitlements
  entitlements="$(mktemp "${TMPDIR:-/tmp}/velora-entitlements.XXXXXX.plist")"
  extract_entitlements "$code" "$entitlements"

  local args=(--force --sign "$identity" --requirements "$requirement" --timestamp=none)
  if [[ -s "$entitlements" ]]; then
    args+=(--entitlements "$entitlements")
  fi

  /usr/bin/codesign "${args[@]}" "$code"
  rm -f "$entitlements"
}

repair_unicode_designated_requirement() {
  if [[ -z "$IPA_PATH" || -z "$TMP_DIR" ]]; then
    echo "[Velora CI] Cannot repair signing because the exported artifact is not an IPA" >&2
    return 1
  fi

  local identity team_id requirement_file
  identity="$(/usr/bin/codesign -dv --verbose=4 "$APP_PATH" 2>&1 | /usr/bin/sed -n 's/^Authority=//p' | /usr/bin/head -1)"
  team_id="$(/usr/bin/codesign -dv --verbose=4 "$APP_PATH" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p' | /usr/bin/head -1)"

  if [[ -z "$identity" || -z "$team_id" || "$team_id" == "not set" ]]; then
    echo "[Velora CI] Could not determine Apple Distribution identity/team from exported app" >&2
    return 1
  fi

  if [[ "$identity" != Apple\ Distribution:* ]]; then
    echo "[Velora CI] Refusing signing workaround because exported app is not Apple Distribution signed: $identity" >&2
    return 1
  fi

  echo "[Velora CI] Export uses a valid Apple Distribution certificate but its generated designated requirement is invalid."
  echo "[Velora CI] Applying OU-based designated requirement for TeamIdentifier=$team_id"

  if ! /usr/bin/security find-identity -v -p codesigning | /usr/bin/grep -Fq "$identity"; then
    echo "[Velora CI] Distribution identity is not available with its private key on this runner: $identity" >&2
    return 1
  fi

  requirement_file="$(mktemp "${TMPDIR:-/tmp}/velora-requirement.XXXXXX")"
  cat > "$requirement_file" <<EOF
designated => anchor apple generic
  and certificate leaf[subject.OU] = "$team_id"
  and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */
EOF

  # Sign nested code first. This avoids the parent app seal becoming stale.
  if [[ -d "$APP_PATH/Frameworks" ]]; then
    while IFS= read -r -d '' dylib; do
      /usr/bin/codesign --force --sign "$identity" --requirements "$requirement_file" --timestamp=none "$dylib"
    done < <(find "$APP_PATH/Frameworks" -type f -name '*.dylib' -print0)

    while IFS= read -r -d '' framework; do
      /usr/bin/codesign --force --sign "$identity" --requirements "$requirement_file" --timestamp=none "$framework"
    done < <(find "$APP_PATH/Frameworks" -type d -name '*.framework' -print0)
  fi

  # Preserve extension entitlements, then sign the app itself last.
  if [[ -d "$APP_PATH/PlugIns" ]]; then
    while IFS= read -r -d '' extension; do
      resign_preserving_entitlements "$extension" "$identity" "$requirement_file"
    done < <(find "$APP_PATH/PlugIns" -type d -name '*.appex' -print0)
  fi

  resign_preserving_entitlements "$APP_PATH" "$identity" "$requirement_file"
  rm -f "$requirement_file"

  echo "[Velora CI] Verifying repaired signature"
  /usr/bin/codesign --verify --deep --strict --verbose=4 "$APP_PATH"

  local new_ipa="$IPA_PATH.repacked"
  rm -f "$new_ipa"
  (
    cd "$TMP_DIR"
    /usr/bin/zip -qry "$new_ipa" .
  )
  mv "$new_ipa" "$IPA_PATH"

  echo "[Velora CI] Repacked repaired IPA: $IPA_PATH"
}

if ! strict_app_valid 2>&1; then
  repair_unicode_designated_requirement
fi

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
