#!/usr/bin/env bash
set -euo pipefail

# Convenience wrapper for server installs.
# Uses the shared installer with HAPPIER_PRODUCT=server.
export HAPPIER_PRODUCT="${HAPPIER_PRODUCT:-server}"

installer_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${installer_dir}/install.sh" ]]; then
  exec bash "${installer_dir}/install.sh" "$@"
fi
if [[ -z "${HAPPIER_INSTALLER_SCRIPT_URL:-}" ]]; then
  echo "Fork server installer source is unconfigured: set HAPPIER_INSTALLER_SCRIPT_URL to the fork install.sh URL." >&2
  exit 1
fi
curl -fsSL "${HAPPIER_INSTALLER_SCRIPT_URL}" | bash -s -- "$@"

