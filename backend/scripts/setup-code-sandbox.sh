#!/usr/bin/env bash
# Provisions the unprivileged OS user that candidate-submitted code runs as.
#
# Why: backend/src/utils/codeExecutor.ts spawns candidate Python/JS/Java/C/C++
# submissions directly on this host. Without a dedicated low-privilege user,
# that code runs as whatever account the backend runs as - which can read
# backend/.env, SSH keys, and everything else on the box. See:
#   - codeExecutor.ts: buildSandboxEnv(), SANDBOX_UID/SANDBOX_GID
#   - .env.example: CODE_EXEC_UID / CODE_EXEC_GID
#
# Run this once on each server as root, then set CODE_EXEC_UID/CODE_EXEC_GID
# in backend/.env to the values it prints, and restart the backend.
#
# The backend process itself must run as root or hold CAP_SETUID/CAP_SETGID
# to be able to drop into this user when spawning candidate code.

set -euo pipefail

SANDBOX_USER="${1:-codesandbox}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (needed to create a system user and lock down file permissions)." >&2
  exit 1
fi

if ! id "$SANDBOX_USER" &>/dev/null; then
  # --system: no login shell, no password, no home directory login use
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SANDBOX_USER"
  echo "Created system user '$SANDBOX_USER'"
else
  echo "User '$SANDBOX_USER' already exists, reusing it"
fi

SANDBOX_UID=$(id -u "$SANDBOX_USER")
SANDBOX_GID=$(id -g "$SANDBOX_USER")

# Lock down every .env file in this repo so the sandbox user (and anyone
# other than the backend's own service account) cannot read secrets by
# absolute path, regardless of what candidate code does.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
find "$REPO_ROOT" -maxdepth 3 -iname ".env" -o -iname ".env.*" ! -iname "*.example" 2>/dev/null | while read -r envfile; do
  chmod 600 "$envfile"
  echo "chmod 600 $envfile"
done

# Make sure the code-execution temp dir exists and isn't group/world writable
# beyond what's needed (codeExecutor.ts chowns each per-run subdirectory to
# the sandbox user at execution time).
mkdir -p /tmp/code_execution
chmod 700 /tmp/code_execution

cat <<EOF

Done. Add these to backend/.env and restart the backend:

  CODE_EXEC_UID=$SANDBOX_UID
  CODE_EXEC_GID=$SANDBOX_GID

Verify no secrets are readable by the sandbox user, e.g.:

  sudo -u $SANDBOX_USER cat "$REPO_ROOT/backend/.env"   # must be "Permission denied"
EOF
