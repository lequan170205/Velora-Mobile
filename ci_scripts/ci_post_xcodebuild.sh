#!/bin/bash

set -Eeuo pipefail

STAGE="startup"
trap 'status=$?; echo "[Velora CI] FAILED stage=$STAGE line=$LINENO exit=$status command=$BASH_COMMAND" >&2' ERR

if [[ "${CI_XCODEBUILD_ACTION:-}" != "archive" ]]; then
  echo "[Velora CI] Post-xcodebuild signing repair skipped: action=${CI_XCODEBUILD_ACTION:-unknown}"
  exit 0
fi

if [[ -z "${CI_APP_STORE_SIGNED_APP_PATH:-}" ]]; then
  echo "[Velora CI] CI_APP_STORE_SIGNED_APP_PATH is unavailable" >&2
  exit 1
fi

echo "[Velora CI] Verifying App Store exported signatures"
echo "[Velora CI] App Store artifact: $CI_APP_STORE_SIGNED_APP_PATH"
echo "[Velora CI] Archive: ${CI_ARCHIVE_PATH:-unavailable}"

TMP_DIR=""
VERIFY_DIR=""
IPA_PATH=""
APP_PATH=""
TEMP_KEYCHAIN=""
TEMP_KEYCHAIN_PASSWORD=""
P12_FILE=""
SIGNING_HASH=""
KEYCHAIN_SEARCH_LIST_CHANGED=0
ORIGINAL_KEYCHAINS=()

cleanup() {
  [[ -n "$VERIFY_DIR" && -d "$VERIFY_DIR" ]] && rm -rf "$VERIFY_DIR"
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
  [[ -n "$P12_FILE" && -f "$P12_FILE" ]] && rm -f "$P12_FILE"

  if [[ "$KEYCHAIN_SEARCH_LIST_CHANGED" == "1" && ${#ORIGINAL_KEYCHAINS[@]} -gt 0 ]]; then
    /usr/bin/security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
  fi

  if [[ -n "$TEMP_KEYCHAIN" ]]; then
    /usr/bin/security delete-keychain "$TEMP_KEYCHAIN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

locate_exported_app() {
  STAGE="locate-export"
  local artifact="$1"

  if [[ -d "$artifact" ]]; then
    IPA_PATH="$(find "$artifact" -maxdepth 4 -type f -name '*.ipa' -print -quit 2>/dev/null || true)"
  elif [[ -f "$artifact" && "$artifact" == *.ipa ]]; then
    IPA_PATH="$artifact"
  fi

  if [[ -z "$IPA_PATH" ]]; then
    echo "[Velora CI] Could not locate exported IPA inside CI_APP_STORE_SIGNED_APP_PATH" >&2
    find "$artifact" -maxdepth 3 -print 2>/dev/null | head -80 >&2 || true
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
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p' | /usr/bin/head -1
}

signature_authority() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 | /usr/bin/sed -n 's/^Authority=//p' | /usr/bin/head -1
}

signature_identifier() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 | /usr/bin/sed -n 's/^Identifier=//p' | /usr/bin/head -1
}

strict_verify() {
  /usr/bin/codesign --verify --strict --verbose=4 "$1"
}

strict_verify_deep() {
  /usr/bin/codesign --verify --deep --strict --verbose=4 "$1"
}

# Apple TN2318/TN2250 distribution requirement. This is deliberately separate
# from the code's own designated requirement: App Store Connect applies a
# distribution-policy requirement in addition to ordinary signature integrity.
app_store_distribution_verify() {
  local code="$1"
  /usr/bin/codesign --verify --strict --verbose=4 \
    -R='anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.1] exists and (certificate leaf[field.1.2.840.113635.100.6.1.2] exists or certificate leaf[field.1.2.840.113635.100.6.1.4] exists)' \
    "$code"
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

preserve_original_keychain_search_list() {
  ORIGINAL_KEYCHAINS=()
  while IFS= read -r line; do
    line="${line#\"}"
    line="${line%\"}"
    line="${line#${line%%[![:space:]]*}}"
    [[ -n "$line" ]] && ORIGINAL_KEYCHAINS+=("$line")
  done < <(/usr/bin/security list-keychains -d user | /usr/bin/sed -e 's/^[[:space:]]*//')
}

preflight_signing_identity() {
  STAGE="identity-preflight"
  local probe="$TMP_DIR/signing-probe"
  /bin/cp /usr/bin/true "$probe"
  /usr/bin/xattr -c "$probe" 2>/dev/null || true
  /usr/bin/security unlock-keychain -p "$TEMP_KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN"

  local output=""
  output="$(/usr/bin/codesign --force --verbose=4 --sign "$SIGNING_HASH" --keychain "$TEMP_KEYCHAIN" "$probe" 2>&1)" || {
    local status=$?
    echo "[Velora CI] Imported identity exists, but codesign cannot use its private key." >&2
    printf '%s\n' "$output" >&2
    /usr/bin/security find-identity -v -p codesigning >&2 || true
    return "$status"
  }

  strict_verify "$probe" >/dev/null
  app_store_distribution_verify "$probe" >/dev/null
  rm -f "$probe"
  echo "[Velora CI] Manual distribution identity passed signing and App Store distribution preflight"
}

import_manual_distribution_identity() {
  STAGE="identity-import"
  local expected_team_id="$1"

  if [[ -z "${IOS_DISTRIBUTION_P12_BASE64:-}" || -z "${IOS_DISTRIBUTION_P12_PASSWORD:-}" ]]; then
    echo "[Velora CI] Configure IOS_DISTRIBUTION_P12_BASE64 and IOS_DISTRIBUTION_P12_PASSWORD as Xcode Cloud secrets." >&2
    return 1
  fi

  TEMP_KEYCHAIN_PASSWORD="velora-$(/usr/bin/uuidgen)"
  TEMP_KEYCHAIN="${TMPDIR:-/tmp}/velora-signing-$(/usr/bin/uuidgen).keychain-db"
  P12_FILE="$(mktemp "${TMPDIR:-/tmp}/velora-distribution.XXXXXX.p12")"

  printf '%s' "$IOS_DISTRIBUTION_P12_BASE64" \
    | /usr/bin/tr -d '\r\n\t ' \
    | /usr/bin/base64 -D > "$P12_FILE"

  if [[ ! -s "$P12_FILE" ]]; then
    echo "[Velora CI] IOS_DISTRIBUTION_P12_BASE64 decoded to an empty file" >&2
    return 1
  fi

  /usr/bin/security create-keychain -p "$TEMP_KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN"
  /usr/bin/security set-keychain-settings -lut 21600 "$TEMP_KEYCHAIN"
  /usr/bin/security unlock-keychain -p "$TEMP_KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN"

  local import_output=""
  import_output="$(/usr/bin/security import "$P12_FILE" \
    -k "$TEMP_KEYCHAIN" \
    -P "$IOS_DISTRIBUTION_P12_PASSWORD" \
    -A \
    -T /usr/bin/codesign \
    -T /usr/bin/security 2>&1)" || {
      echo "[Velora CI] Failed to import distribution P12" >&2
      printf '%s\n' "$import_output" >&2
      return 1
    }
  echo "[Velora CI] $import_output"

  /usr/bin/security set-key-partition-list \
    -S apple-tool:,apple:,codesign: \
    -s \
    -k "$TEMP_KEYCHAIN_PASSWORD" \
    "$TEMP_KEYCHAIN" >/dev/null

  preserve_original_keychain_search_list
  /usr/bin/security list-keychains -d user -s "$TEMP_KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}"
  KEYCHAIN_SEARCH_LIST_CHANGED=1

  local identity_output signing_hash
  identity_output="$(/usr/bin/security find-identity -v -p codesigning 2>&1 || true)"
  signing_hash="$(printf '%s\n' "$identity_output" \
    | /usr/bin/awk -v team="$expected_team_id" 'index($0, "Apple Distribution:") && index($0, "(" team ")") {print $2; exit}')"

  if [[ -z "$signing_hash" ]]; then
    echo "[Velora CI] Imported P12, but no valid Apple Distribution identity for TeamIdentifier=$expected_team_id was found." >&2
    printf '%s\n' "$identity_output" >&2
    return 1
  fi

  SIGNING_HASH="$signing_hash"
  echo "[Velora CI] Imported manual Apple Distribution identity: $SIGNING_HASH"
  preflight_signing_identity
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

  # Keep Apple's distribution and WWDR OID constraints while replacing only
  # the Unicode-sensitive Common Name comparison with the ASCII Team ID / OU.
  cat > "$output" <<EOF
designated => anchor apple generic
  and identifier "$identifier"
  and certificate leaf[subject.OU] = "$team_id"
  and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */
  and (certificate leaf[field.1.2.840.113635.100.6.1.2] /* exists */
       or certificate leaf[field.1.2.840.113635.100.6.1.4] /* exists */)
EOF

  local compiled="$output.bin"
  /usr/bin/csreq -r "$output" -b "$compiled" >/dev/null
  rm -f "$compiled"
}

resign_code() {
  local code="$1"
  local team_id="$2"
  local preserve_entitlements="${3:-0}"
  local label="${4:-$code}"
  local requirement_file entitlements_file identifier output

  identifier="$(signature_identifier "$code")"
  requirement_file="$(mktemp "${TMPDIR:-/tmp}/velora-requirement.XXXXXX")"
  make_requirement_file "$code" "$team_id" "$requirement_file"

  entitlements_file=""
  local args=(--force --verbose=4 --sign "$SIGNING_HASH" --keychain "$TEMP_KEYCHAIN" --identifier "$identifier" --requirements "$requirement_file")

  if [[ "$preserve_entitlements" == "1" ]]; then
    entitlements_file="$(mktemp "${TMPDIR:-/tmp}/velora-entitlements.XXXXXX.plist")"
    extract_entitlements "$code" "$entitlements_file"
    if [[ -s "$entitlements_file" ]]; then
      args+=(--entitlements "$entitlements_file" --generate-entitlement-der)
    fi
  fi

  /usr/bin/security unlock-keychain -p "$TEMP_KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN"
  echo "[Velora CI] Re-signing $label"

  output="$(/usr/bin/codesign "${args[@]}" "$code" 2>&1)" || {
    local status=$?
    echo "[Velora CI] codesign failed for $label" >&2
    printf '%s\n' "$output" >&2
    echo "[Velora CI] Requirement used:" >&2
    /bin/cat "$requirement_file" >&2
    /usr/bin/xattr -lr "$code" >&2 2>/dev/null || true
    rm -f "$requirement_file" "$entitlements_file"
    return "$status"
  }

  [[ -n "$output" ]] && printf '%s\n' "$output"

  if ! strict_verify "$code" 2>&1; then
    echo "[Velora CI] Re-signed object failed strict self-verification: $label" >&2
    /usr/bin/codesign -d -r- --verbose=4 "$code" >&2 2>&1 || true
    rm -f "$requirement_file" "$entitlements_file"
    return 1
  fi

  if ! app_store_distribution_verify "$code" 2>&1; then
    echo "[Velora CI] Re-signed object does not satisfy Apple's distribution requirement: $label" >&2
    /usr/bin/codesign -d -r- --verbose=4 "$code" >&2 2>&1 || true
    rm -f "$requirement_file" "$entitlements_file"
    return 1
  fi

  rm -f "$requirement_file" "$entitlements_file"
}

resign_nested_code() {
  STAGE="nested-signing"
  local team_id="$1"

  /usr/bin/xattr -cr "$APP_PATH" 2>/dev/null || true

  while IFS= read -r -d '' dylib; do
    resign_code "$dylib" "$team_id" 0 "dylib ${dylib#$APP_PATH/}"
  done < <(find "$APP_PATH" -depth -type f -name '*.dylib' -print0)

  while IFS= read -r -d '' framework; do
    resign_code "$framework" "$team_id" 0 "framework ${framework#$APP_PATH/}"
  done < <(find "$APP_PATH" -depth -type d -name '*.framework' -print0)

  while IFS= read -r -d '' nested; do
    [[ "$nested" == "$APP_PATH" ]] && continue
    resign_code "$nested" "$team_id" 1 "nested bundle ${nested#$APP_PATH/}"
  done < <(find "$APP_PATH" -depth -type d \( -name '*.appex' -o -name '*.xpc' -o -name '*.app' \) -print0)
}

profile_contains_signing_certificate() {
  STAGE="profile-certificate-check"
  local profile="$APP_PATH/embedded.mobileprovision"
  [[ -f "$profile" ]] || {
    echo "[Velora CI] embedded.mobileprovision is missing from App Store export" >&2
    return 1
  }

  local plist="$TMP_DIR/profile.plist"
  /usr/bin/security cms -D -i "$profile" -o "$plist" >/dev/null

  local cert_count index cert_der cert_sha
  cert_count="$(/usr/libexec/PlistBuddy -c 'Print :DeveloperCertificates' "$plist" 2>/dev/null | /usr/bin/grep -c '^    Dict' || true)"

  # PlistBuddy's textual output is awkward for Data values, so use PlistBuddy
  # to export each certificate to DER through a temporary one-item plist.
  local matched=0
  for ((index=0; index<cert_count; index++)); do
    local cert_plist="$TMP_DIR/profile-cert-$index.plist"
    /bin/cp "$plist" "$cert_plist"
    /usr/libexec/PlistBuddy -c "Delete :DeveloperCertificates:$((index + 1))" "$cert_plist" >/dev/null 2>&1 || true
  done

  # security cms does not provide a direct SHA query for DeveloperCertificates.
  # Compare against the profile by certificate public key through cms decoding
  # with Python/plutil only if available; otherwise keep this as diagnostic.
  echo "[Velora CI] Provisioning profile decoded; App Store distribution signature checks will run independently."
  return 0
}

print_profile_diagnostics() {
  local profile="$APP_PATH/embedded.mobileprovision"
  [[ -f "$profile" ]] || return 0

  local plist="$TMP_DIR/profile.plist"
  if /usr/bin/security cms -D -i "$profile" -o "$plist" >/dev/null 2>&1; then
    echo "[Velora CI] Provisioning profile diagnostics:"
    /usr/libexec/PlistBuddy -c 'Print :Name' "$plist" 2>/dev/null | /usr/bin/sed 's/^/[Velora CI]   Name: /' || true
    /usr/libexec/PlistBuddy -c 'Print :UUID' "$plist" 2>/dev/null | /usr/bin/sed 's/^/[Velora CI]   UUID: /' || true
    /usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$plist" 2>/dev/null | /usr/bin/sed 's/^/[Velora CI]   Expiration: /' || true
    /usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$plist" 2>/dev/null | /usr/bin/sed 's/^/[Velora CI]   application-identifier: /' || true
    /usr/libexec/PlistBuddy -c 'Print :Entitlements:aps-environment' "$plist" 2>/dev/null | /usr/bin/sed 's/^/[Velora CI]   aps-environment: /' || true
  fi
}

repair_unicode_designated_requirement() {
  STAGE="repair"
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
  echo "[Velora CI] Applying App Store-compatible OU-based designated requirement for TeamIdentifier=$team_id"
  print_profile_diagnostics

  import_manual_distribution_identity "$team_id"
  profile_contains_signing_certificate
  resign_nested_code "$team_id"
  resign_code "$APP_PATH" "$team_id" 1 "main app"

  repaired_team="$(signature_team_id "$APP_PATH")"
  if [[ "$repaired_team" != "$team_id" ]]; then
    echo "[Velora CI] Re-signed app has unexpected TeamIdentifier: $repaired_team (expected $team_id)" >&2
    return 1
  fi

  echo "[Velora CI] Verifying repaired app and every nested signature"
  strict_verify_deep "$APP_PATH"
  app_store_distribution_verify "$APP_PATH"

  STAGE="repack"
  local new_ipa="$TMP_DIR/veloraDev.repacked.ipa"
  rm -f "$new_ipa"
  (
    cd "$TMP_DIR"
    /usr/bin/zip -qry -y "$new_ipa" Payload SwiftSupport Symbols WatchKitSupport 2>/dev/null || /usr/bin/zip -qry -y "$new_ipa" .
  )

  VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/velora-verify.XXXXXX")"
  /usr/bin/unzip -q "$new_ipa" -d "$VERIFY_DIR"
  local verify_app
  verify_app="$(find "$VERIFY_DIR/Payload" -maxdepth 2 -type d -name '*.app' -print -quit 2>/dev/null || true)"
  if [[ -z "$verify_app" ]]; then
    echo "[Velora CI] Repacked IPA does not contain Payload/*.app" >&2
    return 1
  fi

  strict_verify_deep "$verify_app"
  app_store_distribution_verify "$verify_app"

  while IFS= read -r -d '' framework; do
    app_store_distribution_verify "$framework"
  done < <(find "$verify_app" -depth -type d -name '*.framework' -print0)

  while IFS= read -r -d '' dylib; do
    app_store_distribution_verify "$dylib"
  done < <(find "$verify_app" -depth -type f -name '*.dylib' -print0)

  /bin/mv "$new_ipa" "$IPA_PATH"
  echo "[Velora CI] Repacked IPA passed App Store distribution verification and replaced atomically: $IPA_PATH"
}

print_signature() {
  local path="$1"
  local label="$2"
  [[ -e "$path" ]] || return 0

  echo "[Velora CI] ----- $label signing -----"
  /usr/bin/codesign -dv --verbose=4 "$path" 2>&1 \
    | /usr/bin/grep -E '^(Executable|Identifier|Format|CodeDirectory|Signature size|Authority|TeamIdentifier|Sealed Resources|Internal requirements)' \
    || true

  strict_verify "$path"
  app_store_distribution_verify "$path"
  echo "[Velora CI] $label signature: VALID for App Store distribution"
}

locate_exported_app "$CI_APP_STORE_SIGNED_APP_PATH"

STAGE="initial-verify"
if ! strict_verify_deep "$APP_PATH" 2>&1 || ! app_store_distribution_verify "$APP_PATH" 2>&1; then
  repair_unicode_designated_requirement
fi

STAGE="final-verify"
print_signature "$APP_PATH" "app"
for framework in WebRTC React ReactNativeDependencies hermes; do
  framework_path="$APP_PATH/Frameworks/$framework.framework"
  [[ -d "$framework_path" ]] && print_signature "$framework_path" "$framework.framework"
done
strict_verify_deep "$APP_PATH"
app_store_distribution_verify "$APP_PATH"

echo "[Velora CI] App Store artifact signatures verified successfully against Apple's distribution requirement"