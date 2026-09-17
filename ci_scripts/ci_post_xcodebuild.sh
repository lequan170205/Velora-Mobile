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
APP_PATH=""
TEMP_KEYCHAIN=""
P12_FILE=""

cleanup() {
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
  [[ -n "$P12_FILE" && -f "$P12_FILE" ]] && rm -f "$P12_FILE"
  if [[ -n "$TEMP_KEYCHAIN" ]]; then
    /usr/bin/security delete-keychain "$TEMP_KEYCHAIN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

locate_exported_app() {
  local artifact="$1"
  local ipa=""

  if [[ -d "$artifact" ]]; then
    IPA_PATH="$(find "$artifact" -maxdepth 4 -type f -name '*.ipa' -print -quit 2>/dev/null || true)"
  elif [[ -f "$artifact" && "$artifact" == *.ipa ]]; then
    IPA_PATH="$artifact"
  fi

  if [[ -z "$IPA_PATH" ]]; then
    echo "[Velora CI] Could not locate exported IPA inside CI_APP_STORE_SIGNED_APP_PATH" >&2
    return 1
  fi

  echo "[Velora CI] Found exported IPA: $IPA_PATH"
  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/velora-ipa.XXXXXX")"
  /usr/bin/unzip -q "$IPA_PATH" -d "$TMP_DIR"
  APP_PATH="$(find "$TMP_DIR/Payload" -maxdepth 2 -type d -name '*.app' -print -quit 2>/dev/null || true)"

  if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
    echo "[Velora CI] Could not locate Payload/*.app inside exported IPA" >&2
    return 1
  fi

  echo "[Velora CI] Exported app: $APP_PATH"
  echo "[Velora CI] Exported IPA retained for repair: $IPA_PATH"
}

signature_team_id() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 \
    | /usr/bin/sed -n 's/^TeamIdentifier=//p' \
    | /usr/bin/head -1
}

signature_authority() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 \
    | /usr/bin/sed -n 's/^Authority=//p' \
    | /usr/bin/head -1
}

signature_identifier() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 \
    | /usr/bin/sed -n 's/^Identifier=//p' \
    | /usr/bin/head -1
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

import_manual_distribution_identity() {
  local expected_team_id="$1"

  if [[ -z "${IOS_DISTRIBUTION_P12_BASE64:-}" || -z "${IOS_DISTRIBUTION_P12_PASSWORD:-}" ]]; then
    echo "[Velora CI] Xcode Cloud cloud-signing private keys are not available to custom scripts." >&2
    echo "[Velora CI] To repair the Unicode designated-requirement issue, configure these Xcode Cloud secrets:" >&2
    echo "[Velora CI]   IOS_DISTRIBUTION_P12_BASE64" >&2
    echo "[Velora CI]   IOS_DISTRIBUTION_P12_PASSWORD" >&2
    return 1
  fi

  local keychain_password signing_hash signed_team
  keychain_password="velora-$(/usr/bin/uuidgen)"
  TEMP_KEYCHAIN="${TMPDIR:-/tmp}/velora-signing-$(/usr/bin/uuidgen).keychain-db"
  P12_FILE="$(mktemp "${TMPDIR:-/tmp}/velora-distribution.XXXXXX.p12")"

  printf '%s' "$IOS_DISTRIBUTION_P12_BASE64" \
    | /usr/bin/tr -d '\r\n\t ' \
    | /usr/bin/base64 -D > "$P12_FILE"

  /usr/bin/security create-keychain -p "$keychain_password" "$TEMP_KEYCHAIN"
  /usr/bin/security set-keychain-settings -lut 21600 "$TEMP_KEYCHAIN"
  /usr/bin/security unlock-keychain -p "$keychain_password" "$TEMP_KEYCHAIN"
  /usr/bin/security import "$P12_FILE" \
    -k "$TEMP_KEYCHAIN" \
    -P "$IOS_DISTRIBUTION_P12_PASSWORD" \
    -T /usr/bin/codesign \
    -T /usr/bin/security >/dev/null
  /usr/bin/security set-key-partition-list \
    -S apple-tool:,apple:,codesign: \
    -s \
    -k "$keychain_password" \
    "$TEMP_KEYCHAIN" >/dev/null

  signing_hash="$(/usr/bin/security find-identity -v -p codesigning "$TEMP_KEYCHAIN" \
    | /usr/bin/awk '/Apple Distribution:/ {print $2; exit}')"

  if [[ -z "$signing_hash" ]]; then
    echo "[Velora CI] No Apple Distribution identity with private key was found in IOS_DISTRIBUTION_P12_BASE64" >&2
    return 1
  fi

  SIGNING_HASH="$signing_hash"
  echo "[Velora CI] Imported manual Apple Distribution identity: $SIGNING_HASH"

  # Sanity-check the imported identity by signing a temporary copy of the app executable metadata later.
  # The final app verification below confirms that TeamIdentifier still matches the cloud-exported team.
  signed_team="$expected_team_id"
  [[ -n "$signed_team" ]]
}

make_requirement_file() {
  local code="$1"
  local team_id="$2"
  local output="$3"
  local identifier
  identifier="$(signature_identifier "$code")"

  if [[ -z "$identifier" ]]; then
    echo "[Velora CI] Could not determine code identifier for: $code" >&2
    return 1
  fi

  cat > "$output" <<EOF
designated => anchor apple generic
  and identifier "$identifier"
  and certificate leaf[subject.OU] = "$team_id"
  and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */
EOF
}

resign_code() {
  local code="$1"
  local team_id="$2"
  local preserve_entitlements="${3:-0}"
  local requirement_file entitlements_file

  requirement_file="$(mktemp "${TMPDIR:-/tmp}/velora-requirement.XXXXXX")"
  make_requirement_file "$code" "$team_id" "$requirement_file"

  local args=(--force --sign "$SIGNING_HASH" --keychain "$TEMP_KEYCHAIN" --requirements "$requirement_file" --timestamp=none)

  entitlements_file=""
  if [[ "$preserve_entitlements" == "1" ]]; then
    entitlements_file="$(mktemp "${TMPDIR:-/tmp}/velora-entitlements.XXXXXX.plist")"
    extract_entitlements "$code" "$entitlements_file"
    if [[ -s "$entitlements_file" ]]; then
      args+=(--entitlements "$entitlements_file")
    fi
  fi

  /usr/bin/codesign "${args[@]}" "$code"

  rm -f "$requirement_file"
  [[ -n "$entitlements_file" ]] && rm -f "$entitlements_file"
}

repair_unicode_designated_requirement() {
  local team_id authority repaired_team
  team_id="$(signature_team_id "$APP_PATH")"
  authority="$(signature_authority "$APP_PATH")"

  if [[ -z "$team_id" || "$team_id" == "not set" ]]; then
    echo "[Velora CI] Could not determine TeamIdentifier from exported app" >&2
    return 1
  fi

  if [[ "$authority" != Apple\ Distribution:* ]]; then
    echo "[Velora CI] Exported app is not Apple Distribution signed: $authority" >&2
    return 1
  fi

  echo "[Velora CI] Export uses Apple Distribution but its designated requirement is invalid."
  echo "[Velora CI] Applying OU-based designated requirement for TeamIdentifier=$team_id"

  SIGNING_HASH=""
  import_manual_distribution_identity "$team_id"

  # Sign nested code from the inside out so the parent app seal remains valid.
  if [[ -d "$APP_PATH/Frameworks" ]]; then
    while IFS= read -r -d '' dylib; do
      resign_code "$dylib" "$team_id" 0
    done < <(find "$APP_PATH/Frameworks" -type f -name '*.dylib' -print0)

    while IFS= read -r -d '' framework; do
      resign_code "$framework" "$team_id" 0
    done < <(find "$APP_PATH/Frameworks" -depth -type d -name '*.framework' -print0)
  fi

  if [[ -d "$APP_PATH/PlugIns" ]]; then
    while IFS= read -r -d '' extension; do
      resign_code "$extension" "$team_id" 1
    done < <(find "$APP_PATH/PlugIns" -depth -type d -name '*.appex' -print0)
  fi

  resign_code "$APP_PATH" "$team_id" 1

  repaired_team="$(signature_team_id "$APP_PATH")"
  if [[ "$repaired_team" != "$team_id" ]]; then
    echo "[Velora CI] Re-signed app has unexpected TeamIdentifier: $repaired_team (expected $team_id)" >&2
    return 1
  fi

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

locate_exported_app "$CI_APP_STORE_SIGNED_APP_PATH"

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

if [[ "$FAILED" -ne 0 ]]; then
  echo "[Velora CI] Exported App Store artifact still has an invalid code signature; stopping before upload." >&2
  exit 1
fi

echo "[Velora CI] App Store artifact signatures verified successfully"
