#!/bin/bash
# Personal-use macOS build. Apple's packager supplies the native app template.
# A real Apple Development identity signs both the extension and its host app.
# No security settings, certificates, or private keys are changed by this script.

FX_APP_NAME='YouTube FX'
FX_BUNDLE_ID='local.youtubefx.safari'

current_os() { /usr/bin/uname -s; }
user_home_directory() { printf '%s\n' "${HOME:?Home directory is missing}"; }
run_xcrun() { /usr/bin/xcrun "$@"; }
run_xcodebuild() { /usr/bin/xcodebuild "$@"; }
run_security() { /usr/bin/security "$@"; }
run_codesign() { /usr/bin/codesign "$@"; }
run_ditto() { /usr/bin/ditto "$@"; }
run_open() { /usr/bin/open "$@"; }
run_shasum() { /usr/bin/shasum "$@"; }
plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1"; }
scheme_value() { /usr/bin/plutil -extract "project.schemes.$2" raw -o - "$1"; }

fail() { printf '\n%s\n' "$*" >&2; return 1; }

certificate_help() {
    cat <<'TEXT'

One-time Apple signing setup
  1. Open Xcode > Settings > Accounts (or Apple Accounts).
  2. Add your Apple Account and select your team / Personal Team.
  3. Click Manage Certificates, then +, then Apple Development.
  4. Return here and run INSTALL-ON-MAC.command again.

Use a development certificate with its private key on this Mac. A self-signed
certificate or Xcode's "Sign to Run Locally" does not remove Safari's
unsigned-extension restriction. The certificate stays in your Keychain.
This installer never asks for your Apple Account password or exports keys.
TEXT
}

select_identity() {
    local output line choice count
    output="$(run_security find-identity -v -p codesigning)" || return 1
    identity_hashes=()
    identity_names=()
    while IFS= read -r line; do
        if [[ "$line" =~ ([[:xdigit:]]{40})[[:space:]]+\"(Apple\ Development:|Mac\ Developer:) ]]; then
            identity_hashes+=("${BASH_REMATCH[1]}")
            identity_names+=("${line#*\"}")
        fi
    done <<< "$output"
    count=${#identity_hashes[@]}
    if (( count == 0 )); then
        certificate_help
        fail 'No valid Apple Development signing identity was found. Finish the setup above, then retry.'
        return 1
    fi
    if (( count == 1 )); then
        selected_identity="${identity_hashes[0]}"
        printf 'Using %s\n' "${identity_names[0]%\"*}"
        return 0
    fi
    printf '\nChoose the development certificate for this installation:\n'
    for (( choice=0; choice<count; choice++ )); do
        printf '  %s. %s\n' "$((choice+1))" "${identity_names[choice]%\"*}"
    done
    if [[ ! -t 0 ]]; then
        fail 'Several certificates are available. Double-click INSTALL-ON-MAC.command to choose one interactively.'
        return 1
    fi
    while true; do
        printf 'Certificate number: '
        IFS= read -r choice || return 1
        if [[ "$choice" =~ ^[1-9][0-9]*$ ]] && (( ${#choice} < 5 )) && (( 10#$choice <= count )); then
            selected_identity="${identity_hashes[10#$choice-1]}"
            return 0
        fi
        printf 'Enter a number from 1 to %s.\n' "$count"
    done
}

check_xcode() {
    local packager
    # Do not change the system-wide xcode-select setting.
    if ! run_xcrun --find xcodebuild >/dev/null 2>&1 || ! run_xcodebuild -version >/dev/null 2>&1; then
        if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
            export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
        fi
    fi
    if ! run_xcodebuild -version >/dev/null 2>&1; then
        fail 'Install the full Xcode app from the Mac App Store, open it once, finish its first-run setup, then retry. Command Line Tools alone are insufficient.'
        return 1
    fi
    packager=''
    if run_xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
        packager='safari-web-extension-packager'
    elif run_xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
        packager='safari-web-extension-converter'
    fi
    if [[ -z "$packager" ]]; then
        fail 'This Xcode installation has no Safari web-extension packager. Update Xcode, open it once, and retry.'
        return 1
    fi
    selected_packager="$packager"
}

stage_extension() {
    local source_dir="$1" destination="$2" hashes="$3" line relative
    mkdir -p "$destination"
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" ]] && continue
        if [[ ! "$line" =~ ^[[:xdigit:]]{64}\ \ (.+)$ ]]; then
            fail 'The extension checksum list is invalid.'; return 1
        fi
        relative="${BASH_REMATCH[1]}"
        case "$relative" in
            /*|..|../*|*/../*|*/..|*\\*) fail 'Unsafe resource path in the package.'; return 1 ;;
        esac
        if [[ ! -f "$source_dir/$relative" || -L "$source_dir/$relative" ]]; then
            fail "Missing or linked extension resource: $relative"; return 1
        fi
        mkdir -p "$destination/$(dirname "$relative")"
        cp "$source_dir/$relative" "$destination/$relative"
    done < "$hashes"
    (cd "$destination" && run_shasum -a 256 -c "$hashes") > "$build_dir/checksums.log" 2>&1 || {
        fail "The extension files did not pass their integrity check. Extract a fresh copy of the whole ZIP. Details: $build_dir/checksums.log"
        return 1
    }
}

find_project() {
    local path found=''
    while IFS= read -r -d '' path; do
        if [[ -n "$found" ]]; then
            fail 'The packager produced more than one Xcode project. See the build folder.'; return 1
        fi
        found="$path"
    done < <(find "$1" -type d -name '*.xcodeproj' -prune -print0)
    [[ -n "$found" ]] || { fail 'The packager did not produce an Xcode project.'; return 1; }
    selected_project="$found"
}

select_scheme() {
    local list_file="$1" index=0 value fallback=''
    while value="$(scheme_value "$list_file" "$index" 2>/dev/null)"; do
        if [[ "$value" == "$FX_APP_NAME" || "$value" == "$FX_APP_NAME (macOS)" ]]; then
            selected_scheme="$value"; return 0
        fi
        case "$value" in
            *Extension*|*extension*|*iOS*|*Tests*) ;;
            *) [[ -n "$fallback" ]] || fallback="$value" ;;
        esac
        index=$((index+1))
    done
    [[ -n "$fallback" ]] || { fail 'No macOS application scheme was found.'; return 1; }
    selected_scheme="$fallback"
}

find_built_app() {
    local path found=''
    for path in "$1"/*.app; do
        [[ -d "$path" ]] || continue
        [[ "$(plist_value "$path/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || true)" == "$FX_BUNDLE_ID" ]] || continue
        if [[ -n "$found" ]]; then fail 'More than one matching app was built.'; return 1; fi
        found="$path"
    done
    [[ -n "$found" ]] || { fail 'The build produced no matching YouTube FX app.'; return 1; }
    built_app="$found"
}

verify_signature() {
    run_codesign --verify --deep --strict -R 'anchor apple generic' "$1"
}

sign_app() {
    local app="$1" entitlements="$2" nested extension='' count=0 point
    if [[ -d "$app/Contents/Frameworks" ]]; then
        while IFS= read -r -d '' nested; do
            run_codesign --force --sign "$selected_identity" --timestamp=none "$nested" || return 1
        done < <(find "$app/Contents/Frameworks" -depth \( -name '*.dylib' -o -name '*.framework' \) -print0)
    fi
    for nested in "$app/Contents/PlugIns/"*.appex; do
        [[ -d "$nested" ]] || continue
        point="$(plist_value "$nested/Contents/Info.plist" NSExtension:NSExtensionPointIdentifier)" || return 1
        [[ "$point" == 'com.apple.Safari.web-extension' ]] || { fail 'Unexpected native extension type.'; return 1; }
        count=$((count+1))
        extension="$nested"
    done
    (( count == 1 )) || { fail 'Expected one embedded Safari web extension.'; return 1; }
    # Sign inside out; --deep is used only for verification, never for signing.
    run_codesign --force --sign "$selected_identity" --timestamp=none --entitlements "$entitlements" "$extension" || return 1
    run_codesign --verify --strict -R 'anchor apple generic' "$extension" || return 1
    run_codesign --force --sign "$selected_identity" --timestamp=none --entitlements "$entitlements" "$app" || return 1
    verify_signature "$app" || return 1
    run_codesign --display --verbose=4 "$app" > "$build_dir/signature.log" 2>&1 || return 1
}

install_app() {
    local app="$1" apps_dir="$2" backup_root="$3" target staging previous=''
    mkdir -p "$apps_dir"
    target="$apps_dir/$FX_APP_NAME.app"
    if [[ -L "$target" ]]; then fail "Installation path is a symbolic link: $target"; return 1; fi
    if [[ -e "$target" ]]; then
        [[ -d "$target" && "$(plist_value "$target/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || true)" == "$FX_BUNDLE_ID" ]] || {
            fail "A different item already exists at $target. Move it aside, then retry."; return 1
        }
    fi
    staging="$(mktemp -d "$apps_dir/YouTubeFX-install.XXXXXX")" || return 1
    if ! run_ditto "$app" "$staging/$FX_APP_NAME.app" || ! verify_signature "$staging/$FX_APP_NAME.app"; then
        fail "Copy verification failed; the existing app is untouched. Build: $build_dir"; return 1
    fi
    if [[ -e "$target" ]]; then
        mkdir -p "$backup_root"
        previous="$(mktemp -d "$backup_root/Previous.XXXXXX")" || return 1
        mv "$target" "$previous/$FX_APP_NAME.app" || return 1
    fi
    if ! mv "$staging/$FX_APP_NAME.app" "$target"; then
        [[ -z "$previous" ]] || mv "$previous/$FX_APP_NAME.app" "$target"
        fail 'Could not install the new app. Any previous app was restored.'; return 1
    fi
    rmdir "$staging"
    installed_app="$target"
    if [[ -n "$previous" ]]; then printf 'Previous app saved in: %s\n' "$previous"; fi
}

main() {
    set -euo pipefail
    local package_dir="${1:?Package directory required}" user_home resource_dir hashes source_dir cache_root project_root
    if [[ "$(current_os)" != Darwin ]]; then fail 'Run this installer on the Mac where you use Safari.'; return 1; fi
    user_home="$(user_home_directory)"
    resource_dir="$package_dir/macos"
    hashes="$resource_dir/extension-files.sha256"
    source_dir="$package_dir"
    [[ ! -f "$package_dir/extension/manifest.json" ]] || source_dir="$package_dir/extension"
    [[ -f "$source_dir/manifest.json" && -f "$hashes" && -f "$resource_dir/local-use.entitlements" ]] || {
        fail 'Extract the whole ZIP before running INSTALL-ON-MAC.command. Keep macos and the extension files together.'; return 1
    }
    printf 'YouTube FX 1.5.0 — signed personal installation\n\n'
    printf 'Checking Xcode and the local Apple signing certificate…\n'
    check_xcode
    select_identity
    cache_root="$user_home/Library/Caches/YouTubeFX"
    mkdir -p "$cache_root"
    build_dir="$(mktemp -d "$cache_root/Build.XXXXXX")"
    project_root="$build_dir/Project"
    mkdir -p "$project_root"
    printf '\nPreparing the v1.5.0 extension…\n'
    stage_extension "$source_dir" "$build_dir/Extension" "$hashes"
    printf 'Creating the macOS app with Apple’s %s…\n' "$selected_packager"
    if ! run_xcrun "$selected_packager" "$build_dir/Extension" --project-location "$project_root" \
        --app-name "$FX_APP_NAME" --bundle-identifier "$FX_BUNDLE_ID" --swift --macos-only \
        --copy-resources --no-open --no-prompt > "$build_dir/packager.log" 2>&1; then
        fail "Apple's packager failed. Details: $build_dir/packager.log"; return 1
    fi
    find_project "$project_root"
    run_xcodebuild -list -json -project "$selected_project" > "$build_dir/schemes.json" 2> "$build_dir/schemes.log" || {
        fail "Could not read the Xcode schemes. Details: $build_dir/schemes.log"; return 1
    }
    select_scheme "$build_dir/schemes.json"
    printf 'Building the app. The first build may take a few minutes…\n'
    if ! run_xcodebuild -project "$selected_project" -scheme "$selected_scheme" -configuration Release \
        -destination 'platform=macOS' -derivedDataPath "$build_dir/DerivedData" \
        'CODE_SIGNING_ALLOWED=NO' 'CODE_SIGNING_REQUIRED=NO' 'CODE_SIGN_IDENTITY=' \
        'MACOSX_DEPLOYMENT_TARGET=15.0' build > "$build_dir/build.log" 2>&1; then
        fail "Xcode could not build the app. Details: $build_dir/build.log"; return 1
    fi
    find_built_app "$build_dir/DerivedData/Build/Products/Release"
    printf 'Signing and verifying both the extension and its Mac app…\n'
    if ! sign_app "$built_app" "$resource_dir/local-use.entitlements"; then
        fail "Signing failed. The existing installation is untouched. Build folder: $build_dir"; return 1
    fi
    printf 'Installing in your Applications folder…\n'
    install_app "$built_app" "$user_home/Applications" "$user_home/Library/Application Support/YouTubeFX/Backups"
    printf '\nInstalled: %s\n' "$installed_app"
    printf 'Build and signing log folder: %s\n' "$build_dir"
    cat <<'TEXT'

Finish in Safari
  1. Open the YouTube FX app (it opens now).
  2. Turn off and remove the old Temporary YouTube FX extension.
  3. In Safari > Settings > Extensions, enable the installed YouTube FX.
     Allow youtube.com, and music.youtube.com if you use YouTube Music.
  4. Reload EVERY YouTube tab. Re-enter your effect settings if needed.
  5. Quit and reopen Safari to confirm it stays enabled. The installed copy
     should work with "Allow unsigned extensions" turned OFF.

Keep YouTube FX.app in your Applications folder; the app need not stay open.
This local development signature can expire or be revoked. Re-run this
installer with a valid certificate if that happens. It is not a notarized
app for distribution to other Macs.
TEXT
    if ! run_open "$installed_app"; then
        printf '\nThe app is installed. Open it manually in Finder > Home > Applications.\n'
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
