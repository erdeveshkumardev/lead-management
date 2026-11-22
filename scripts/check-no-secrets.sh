#!/usr/bin/env bash
# =============================================================================
#  Stops the build when something that must never be committed is in the repository:
#    - a Kubernetes Secret file, a real .env file, a private key, a kubeconfig
#    - a database connection string that contains a real password
#
#  Run it before pushing:   bash scripts/check-no-secrets.sh
#  (It looks at the files git tracks plus new files that are not ignored.)
#
#  In examples use the placeholders USER / PASSWORD or <user> / <password> - they are allowed.
#  This is a safety net, not a replacement for GitHub secret scanning and push protection.
# =============================================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository: nothing to check." >&2
  exit 0
fi

failed=0
report() { echo "ERROR: $1"; shift; printf '    %s\n' "$@"; failed=1; }

# tracked files plus new files that are not ignored; a file deleted from the working copy does not count
files="$(git ls-files --cached --others --exclude-standard | while IFS= read -r f; do [ -e "$f" ] && printf '%s\n' "$f"; done)"

# ---- files that must not exist in the repository
bad="$(printf '%s\n' "$files" | grep -E '(^|/)k8s/secret\.ya?ml$|(^|/)\.env$|(^|/)\.env\.[^/]+$|\.(pem|key|p12|pfx|kubeconfig)$|(^|/)id_(rsa|ed25519|ecdsa)[^/]*$|(^|/)kubeconfig[^/]*$' \
        | grep -vE '\.env\.example$|\.pub$' || true)"
[ -z "$bad" ] || report "these files must never be committed (credentials belong in the cluster Secret / a local .env):" $bad

# ---- a connection string with a password in it (placeholders are fine)
hits="$(git grep --untracked -nIE 'mongodb(\+srv)?://[^/@:[:space:]"]+:[^@[:space:]"]+@' -- . 2>/dev/null \
        | grep -vE 'mongodb(\+srv)?://(<[^>]*>|USER|user|username):(<[^>]*>|PASSWORD|password)@' || true)"
[ -z "$hits" ] || report "a database connection string with a password is written in a file:" \
                         "$(printf '%s\n' "$hits" | sed -E 's#(mongodb(\+srv)?://[^:/]+:)[^@]+@#\1********@#')"

# ---- private keys pasted into a file
keys="$(git grep --untracked -lIE -e '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----' -- . ':!scripts/check-no-secrets.sh' 2>/dev/null || true)"
[ -z "$keys" ] || report "a private key is stored in:" $keys

if [ "$failed" -ne 0 ]; then
  echo
  echo "Remove the value from the file AND change the credential itself - once pushed, it must be treated as public."
  exit 1
fi
echo "No credentials found in the repository files."
