#!/bin/bash
set -Eeuo pipefail

STAGE="startup"
trap 's=$?; echo "[Velora CI] FAILED stage=$STAGE line=$LINENO exit=$s command=$BASH_COMMAND" >&2' ERR

[[ "${CI_XCODEBUILD_ACTION:-}" == "archive" ]] || exit 0
: "${CI_APP_STORE_SIGNED_APP_PATH:?CI_APP_STORE_SIGNED_APP_PATH is required}"
: "${IOS_DISTRIBUTION_P12_BASE64:?IOS_DISTRIBUTION_P12_BASE64 secret is required}"
: "${IOS_DISTRIBUTION_P12_PASSWORD:?IOS_DISTRIBUTION_P12_PASSWORD secret is required}"
: "${IOS_DISTRIBUTION_PROFILE_BASE64:?IOS_DISTRIBUTION_PROFILE_BASE64 secret is required}"
: "${ASC_API_KEY_ID:?ASC_API_KEY_ID secret is required}"
: "${ASC_API_ISSUER_ID:?ASC_API_ISSUER_ID secret is required}"
: "${ASC_API_PRIVATE_KEY_BASE64:?ASC_API_PRIVATE_KEY_BASE64 secret is required}"
: "${ASC_APPLE_ID_USERNAME:?ASC_APPLE_ID_USERNAME secret is required}"

TMP_DIR=""
VERIFY_DIR=""
TEMP_KEYCHAIN=""
KEYCHAIN_PASSWORD=""
P12_FILE=""
PROFILE_FILE=""
IPA_PATH=""
APP_PATH=""
SIGNING_HASH=""
TEAM_ID=""
BUNDLE_ID=""
ASC_KEY_FILE=""
ORIGINAL_KEYCHAINS=()
SEARCH_LIST_CHANGED=0

cleanup() {
  [[ -n "$VERIFY_DIR" && -d "$VERIFY_DIR" ]] && rm -rf "$VERIFY_DIR"
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
  [[ -n "$P12_FILE" && -f "$P12_FILE" ]] && rm -f "$P12_FILE"
  [[ -n "$PROFILE_FILE" && -f "$PROFILE_FILE" ]] && rm -f "$PROFILE_FILE"
  [[ -n "$ASC_KEY_FILE" && -f "$ASC_KEY_FILE" ]] && rm -f "$ASC_KEY_FILE"
  if [[ "$SEARCH_LIST_CHANGED" == "1" && ${#ORIGINAL_KEYCHAINS[@]} -gt 0 ]]; then
    /usr/bin/security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
  fi
  [[ -n "$TEMP_KEYCHAIN" ]] && /usr/bin/security delete-keychain "$TEMP_KEYCHAIN" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log() { echo "[Velora CI] $*"; }

find_ipa() {
  STAGE="locate-ipa"
  if [[ -f "$CI_APP_STORE_SIGNED_APP_PATH" && "$CI_APP_STORE_SIGNED_APP_PATH" == *.ipa ]]; then
    IPA_PATH="$CI_APP_STORE_SIGNED_APP_PATH"
  else
    IPA_PATH="$(find "$CI_APP_STORE_SIGNED_APP_PATH" -maxdepth 4 -type f -name '*.ipa' -print -quit 2>/dev/null || true)"
  fi
  [[ -n "$IPA_PATH" ]] || { echo "[Velora CI] App Store IPA not found" >&2; return 1; }
  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/velora-manual-sign.XXXXXX")"
  /usr/bin/unzip -q "$IPA_PATH" -d "$TMP_DIR"
  APP_PATH="$(find "$TMP_DIR/Payload" -maxdepth 2 -type d -name '*.app' -print -quit)"
  [[ -d "$APP_PATH" ]] || { echo "[Velora CI] Payload/*.app not found" >&2; return 1; }
  BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
  log "IPA: $IPA_PATH"
  log "App: $APP_PATH"
  log "Bundle ID: $BUNDLE_ID"
}

decode_manual_profile() {
  STAGE="profile-decode"
  PROFILE_FILE="$(mktemp "${TMPDIR:-/tmp}/velora-appstore.XXXXXX.mobileprovision")"
  printf '%s' "$IOS_DISTRIBUTION_PROFILE_BASE64" | /usr/bin/tr -d '\r\n\t ' | /usr/bin/base64 -D > "$PROFILE_FILE"
  [[ -s "$PROFILE_FILE" ]] || { echo "[Velora CI] IOS_DISTRIBUTION_PROFILE_BASE64 decoded to an empty file" >&2; return 1; }

  local plist="$TMP_DIR/manual-profile.plist"
  /usr/bin/security cms -D -i "$PROFILE_FILE" -o "$plist" >/dev/null

  local python_bin
  python_bin="$(command -v python3 || /usr/bin/xcrun --find python3)"
  "$python_bin" - "$plist" "$BUNDLE_ID" <<'PY'
import datetime, plistlib, sys
path, bundle = sys.argv[1:]
with open(path, 'rb') as f:
    p = plistlib.load(f)
team = (p.get('TeamIdentifier') or p.get('ApplicationIdentifierPrefix') or [''])[0]
ent = p.get('Entitlements') or {}
appid = ent.get('application-identifier', '')
expiry = p.get('ExpirationDate')
get_task_allow = ent.get('get-task-allow')
provisions_all = p.get('ProvisionsAllDevices', False)
provisioned_devices = p.get('ProvisionedDevices')
name = p.get('Name', '<unknown>')
expected = f'{team}.{bundle}'
print(f'[Velora CI] Manual profile: {name}')
print(f'[Velora CI] Manual profile Team ID: {team}')
print(f'[Velora CI] Manual profile application-identifier: {appid}')
print(f'[Velora CI] Manual profile expiration: {expiry}')
print(f'[Velora CI] Manual profile DeveloperCertificates: {len(p.get("DeveloperCertificates") or [])}')
if not team or appid != expected:
    print(f'[Velora CI] Profile does not match bundle ID {bundle}; expected {expected}', file=sys.stderr)
    sys.exit(10)
if expiry and expiry.replace(tzinfo=datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
    print('[Velora CI] Manual provisioning profile is expired', file=sys.stderr)
    sys.exit(11)
if get_task_allow is True or provisioned_devices or provisions_all:
    print('[Velora CI] Profile is not an App Store Connect distribution profile', file=sys.stderr)
    sys.exit(12)
if len(p.get('DeveloperCertificates') or []) != 1:
    print('[Velora CI] Expected exactly one distribution certificate in App Store profile', file=sys.stderr)
    sys.exit(13)
PY
  TEAM_ID="$($python_bin - "$plist" <<'PY'
import plistlib,sys
with open(sys.argv[1],'rb') as f:p=plistlib.load(f)
print((p.get('TeamIdentifier') or p.get('ApplicationIdentifierPrefix') or [''])[0])
PY
)"
  [[ -n "$TEAM_ID" ]] || { echo "[Velora CI] Could not derive Team ID from profile" >&2; return 1; }
}

import_identity() {
  STAGE="identity-import"
  P12_FILE="$(mktemp "${TMPDIR:-/tmp}/velora-distribution.XXXXXX.p12")"
  printf '%s' "$IOS_DISTRIBUTION_P12_BASE64" | /usr/bin/tr -d '\r\n\t ' | /usr/bin/base64 -D > "$P12_FILE"
  [[ -s "$P12_FILE" ]] || { echo "[Velora CI] P12 secret decoded to an empty file" >&2; return 1; }

  KEYCHAIN_PASSWORD="velora-$(/usr/bin/uuidgen)"
  TEMP_KEYCHAIN="${TMPDIR:-/tmp}/velora-signing-$(/usr/bin/uuidgen).keychain-db"
  /usr/bin/security create-keychain -p "$KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN"
  /usr/bin/security set-keychain-settings -lut 21600 "$TEMP_KEYCHAIN"
  /usr/bin/security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN"
  /usr/bin/security import "$P12_FILE" -k "$TEMP_KEYCHAIN" -P "$IOS_DISTRIBUTION_P12_PASSWORD" -A -T /usr/bin/codesign -T /usr/bin/security
  /usr/bin/security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN" >/dev/null

  while IFS= read -r line; do
    line="${line#\"}"; line="${line%\"}"; line="${line#${line%%[![:space:]]*}}"
    [[ -n "$line" ]] && ORIGINAL_KEYCHAINS+=("$line")
  done < <(/usr/bin/security list-keychains -d user | /usr/bin/sed -e 's/^[[:space:]]*//')
  /usr/bin/security list-keychains -d user -s "$TEMP_KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}"
  SEARCH_LIST_CHANGED=1

  local ids
  ids="$(/usr/bin/security find-identity -v -p codesigning 2>&1 || true)"
  SIGNING_HASH="$(printf '%s\n' "$ids" | /usr/bin/awk -v team="$TEAM_ID" 'index($0,"Apple Distribution:") && index($0,"(" team ")") {print $2; exit}')"
  [[ -n "$SIGNING_HASH" ]] || { echo "[Velora CI] No Apple Distribution identity found for Team ID $TEAM_ID" >&2; printf '%s\n' "$ids" >&2; return 1; }
  log "Manual Apple Distribution identity: $SIGNING_HASH"
}

verify_profile_authorizes_identity() {
  STAGE="profile-certificate-match"
  local plist="$TMP_DIR/manual-profile.plist"
  local python_bin="$(command -v python3 || /usr/bin/xcrun --find python3)"
  "$python_bin" - "$plist" "$SIGNING_HASH" <<'PY'
import hashlib, plistlib, sys
path, expected = sys.argv[1], sys.argv[2].upper()
with open(path,'rb') as f:p=plistlib.load(f)
hashes=[hashlib.sha1(bytes(x)).hexdigest().upper() for x in (p.get('DeveloperCertificates') or [])]
for h in hashes: print(f'[Velora CI] Manual profile certificate SHA1: {h}')
if expected not in hashes:
    print(f'[Velora CI] Manual profile does not authorize certificate {expected}', file=sys.stderr)
    sys.exit(20)
print(f'[Velora CI] Manual profile authorizes certificate {expected}')
PY
}

signature_identifier() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 | /usr/bin/sed -n 's/^Identifier=//p' | /usr/bin/head -1
}

make_requirement() {
  local code="$1" output="$2" id
  id="$(signature_identifier "$code")"
  [[ -n "$id" ]] || { echo "[Velora CI] Cannot determine signing identifier for $code" >&2; return 1; }
  cat > "$output" <<EOF
designated => anchor apple generic
  and identifier "$id"
  and certificate leaf[subject.OU] = "$TEAM_ID"
  and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */
  and (certificate leaf[field.1.2.840.113635.100.6.1.2] /* exists */
       or certificate leaf[field.1.2.840.113635.100.6.1.4] /* exists */)
EOF
  /usr/bin/csreq -r "$output" -b "$output.bin" >/dev/null
  rm -f "$output.bin"
}

app_store_verify() {
  /usr/bin/codesign --verify --strict --verbose=4 \
    -R='anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.1] exists and (certificate leaf[field.1.2.840.113635.100.6.1.2] exists or certificate leaf[field.1.2.840.113635.100.6.1.4] exists)' "$1"
}

extract_entitlements() {
  local code="$1" out="$2"
  : > "$out"
  /usr/bin/codesign -d --entitlements :- "$code" > "$out" 2>/dev/null || true
  /usr/bin/plutil -lint "$out" >/dev/null 2>&1 || : > "$out"
}

sign_one() {
  local code="$1" preserve="${2:-0}" label="${3:-$1}"
  local req ent="" out="" id
  req="$(mktemp "${TMPDIR:-/tmp}/velora-req.XXXXXX")"
  make_requirement "$code" "$req"
  id="$(signature_identifier "$code")"
  local args=(--force --verbose=4 --sign "$SIGNING_HASH" --keychain "$TEMP_KEYCHAIN" --identifier "$id" --requirements "$req")
  if [[ "$preserve" == "1" ]]; then
    ent="$(mktemp "${TMPDIR:-/tmp}/velora-ent.XXXXXX.plist")"
    extract_entitlements "$code" "$ent"
    [[ ! -s "$ent" ]] || args+=(--entitlements "$ent" --generate-entitlement-der)
  fi
  /usr/bin/security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN"
  log "Signing $label"
  if ! out="$(/usr/bin/codesign "${args[@]}" "$code" 2>&1)"; then
    printf '%s\n' "$out" >&2
    echo "[Velora CI] Requirement:" >&2; cat "$req" >&2
    return 1
  fi
  [[ -z "$out" ]] || printf '%s\n' "$out"
  /usr/bin/codesign --verify --strict --verbose=4 "$code"
  app_store_verify "$code"
  rm -f "$req" "$ent"
}

validate_app_entitlements_against_profile() {
  STAGE="entitlements-validation"
  local app_ent="$TMP_DIR/app-entitlements.plist" profile_plist="$TMP_DIR/manual-profile.plist"
  extract_entitlements "$APP_PATH" "$app_ent"
  [[ -s "$app_ent" ]] || { echo "[Velora CI] Could not extract app entitlements before resign" >&2; return 1; }
  local python_bin="$(command -v python3 || /usr/bin/xcrun --find python3)"
  "$python_bin" - "$app_ent" "$profile_plist" "$TEAM_ID" "$BUNDLE_ID" <<'PY'
import plistlib,sys
app_path,profile_path,team,bundle=sys.argv[1:]
with open(app_path,'rb') as f: app=plistlib.load(f)
with open(profile_path,'rb') as f: profile=plistlib.load(f)
pent=profile.get('Entitlements') or {}
expected=f'{team}.{bundle}'
for key,want in [('application-identifier',expected),('com.apple.developer.team-identifier',team)]:
    got=app.get(key)
    if got is not None and got != want:
        print(f'[Velora CI] App entitlement {key}={got!r}, expected {want!r}',file=sys.stderr);sys.exit(30)
aps=app.get('aps-environment')
if aps is not None and aps != pent.get('aps-environment'):
    print(f'[Velora CI] aps-environment mismatch: app={aps!r}, profile={pent.get("aps-environment")!r}',file=sys.stderr);sys.exit(31)
if app.get('get-task-allow') is True:
    print('[Velora CI] App has get-task-allow=true; not valid for App Store',file=sys.stderr);sys.exit(32)
print('[Velora CI] App entitlements are compatible with manual App Store profile')
PY
}

resign_all() {
  STAGE="resign"
  validate_app_entitlements_against_profile
  /bin/cp "$PROFILE_FILE" "$APP_PATH/embedded.mobileprovision"
  /usr/bin/xattr -cr "$APP_PATH" 2>/dev/null || true

  while IFS= read -r -d '' dylib; do sign_one "$dylib" 0 "dylib ${dylib#$APP_PATH/}"; done < <(find "$APP_PATH" -depth -type f -name '*.dylib' -print0)
  while IFS= read -r -d '' fw; do sign_one "$fw" 0 "framework ${fw#$APP_PATH/}"; done < <(find "$APP_PATH" -depth -type d -name '*.framework' -print0)
  while IFS= read -r -d '' nested; do
    [[ "$nested" == "$APP_PATH" ]] || sign_one "$nested" 1 "nested bundle ${nested#$APP_PATH/}"
  done < <(find "$APP_PATH" -depth -type d \( -name '*.appex' -o -name '*.xpc' -o -name '*.app' \) -print0)
  sign_one "$APP_PATH" 1 "main app"
  /usr/bin/codesign --verify --deep --strict --verbose=4 "$APP_PATH"
  app_store_verify "$APP_PATH"
}

repack_and_verify() {
  STAGE="repack"
  local new_ipa="$TMP_DIR/velora-manual-signed.ipa"
  (cd "$TMP_DIR" && /usr/bin/zip -qry -y "$new_ipa" .)
  VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/velora-final-verify.XXXXXX")"
  /usr/bin/unzip -q "$new_ipa" -d "$VERIFY_DIR"
  local app
  app="$(find "$VERIFY_DIR/Payload" -maxdepth 2 -type d -name '*.app' -print -quit)"
  [[ -d "$app" ]] || { echo "[Velora CI] Repacked IPA has no app" >&2; return 1; }
  /usr/bin/codesign --verify --deep --strict --verbose=4 "$app"
  app_store_verify "$app"
  /usr/bin/security cms -D -i "$app/embedded.mobileprovision" -o "$VERIFY_DIR/profile.plist" >/dev/null
  /bin/mv "$new_ipa" "$IPA_PATH"
  log "Final IPA uses matching manual certificate + App Store profile and passed all local distribution checks"
}

prepare_app_store_connect_key() {
  STAGE="asc-auth"
  local key_dir="$HOME/.appstoreconnect/private_keys"
  /bin/mkdir -p "$key_dir"
  /bin/chmod 700 "$HOME/.appstoreconnect" "$key_dir" 2>/dev/null || true
  ASC_KEY_FILE="$key_dir/AuthKey_${ASC_API_KEY_ID}.p8"
  printf '%s' "$ASC_API_PRIVATE_KEY_BASE64" | /usr/bin/tr -d '\r\n\t ' | /usr/bin/base64 -D > "$ASC_KEY_FILE"
  [[ -s "$ASC_KEY_FILE" ]] || { echo "[Velora CI] ASC_API_PRIVATE_KEY_BASE64 decoded to an empty file" >&2; return 1; }
  /bin/chmod 600 "$ASC_KEY_FILE"
  /usr/bin/grep -q 'BEGIN PRIVATE KEY' "$ASC_KEY_FILE" || { echo "[Velora CI] App Store Connect API key is not a valid .p8 private key" >&2; return 1; }
  log "App Store Connect API key prepared for key ID $ASC_API_KEY_ID"
}

validate_with_app_store_connect() {
  STAGE="app-store-validate"
  log "Validating the manually signed IPA with App Store Connect"
  local output=""
  if ! output="$(/usr/bin/xcrun altool --validate-app \
      -f "$IPA_PATH" \
      -t ios \
      -u "$ASC_APPLE_ID_USERNAME" \
      --apiKey "$ASC_API_KEY_ID" \
      --apiIssuer "$ASC_API_ISSUER_ID" \
      --output-format json 2>&1)"; then
    printf '%s\n' "$output" >&2
    echo "[Velora CI] App Store Connect validation rejected the exact manually signed IPA. It was NOT uploaded." >&2
    return 1
  fi
  printf '%s\n' "$output"
  log "App Store Connect validation accepted the exact manually signed IPA"
}

upload_to_app_store_connect() {
  STAGE="app-store-upload"
  log "Uploading the exact validated IPA directly to App Store Connect"
  local output=""
  if ! output="$(/usr/bin/xcrun altool --upload-app \
      -f "$IPA_PATH" \
      -t ios \
      -u "$ASC_APPLE_ID_USERNAME" \
      --apiKey "$ASC_API_KEY_ID" \
      --apiIssuer "$ASC_API_ISSUER_ID" \
      --output-format json 2>&1)"; then
    printf '%s\n' "$output" >&2
    echo "[Velora CI] Direct App Store Connect upload failed." >&2
    return 1
  fi
  printf '%s\n' "$output"
  log "Direct App Store Connect upload completed successfully"
}

find_ipa
decode_manual_profile
import_identity
verify_profile_authorizes_identity
resign_all
repack_and_verify
prepare_app_store_connect_key
validate_with_app_store_connect
upload_to_app_store_connect
log "Manual App Store signing, server validation, and direct upload completed successfully"
