#!/bin/bash
# Double-click this file after extracting the whole ZIP.
set -euo pipefail
package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exit_status=0
/bin/bash "$package_dir/macos/install.sh" "$package_dir" || exit_status=$?
if [[ -t 0 ]]; then
    printf '\nPress Return to close this window. '
    IFS= read -r reply || true
fi
exit "$exit_status"
