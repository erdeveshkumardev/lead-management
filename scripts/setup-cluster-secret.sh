#!/usr/bin/env bash
# =============================================================================
#  Creates or updates the Kubernetes Secret "leadcrm-secret" WITHOUT writing any
#  credential to a file, to the screen or to the shell history.
#
#  Run it on the server where kubectl is configured (the VPS):
#      bash scripts/setup-cluster-secret.sh
#
#  What it does
#    - asks for the MongoDB connection string (input is hidden)
#    - SECRET_KEY       : a new random key is created on the first run with this version
#                         (everybody signs in again once); kept on later runs
#    - ENCRYPTION_KEYS  : created once, then ALWAYS kept. Stored API keys and 2FA seeds are
#                         encrypted with it and cannot be read without it.
#    - optional: first platform administrator, platform e-mail relay
#  Other keys that already exist in the Secret are preserved.
#  When an earlier version of the application is running, it first makes a database
#  backup (or asks you to confirm that one exists): the upgrade cannot be undone without one.
#
#  Options:
#    --rotate-session-key          create a new SECRET_KEY (signs everybody out)
#    --rotate-encryption-key       step 1 of 2: add a new data-encryption key in front of the current one
#    --drop-old-encryption-keys    step 2 of 2: keep only the newest key (after the stored data was
#                                  re-encrypted - the full procedure is in SECURITY.md, "Rotating keys")
#    --namespace NAME              default: leadcrm
#
#  Optional environment variables (backup before an upgrade):
#    BACKUP_DIR=~/leadcrm-backups   MONGO_TOOLS_IMAGE=mongo:7
# =============================================================================
set -Eeuo pipefail

NAMESPACE="leadcrm"
SECRET="leadcrm-secret"
ROTATE_SESSION_KEY="no"
ROTATE_ENCRYPTION_KEY="no"
DROP_OLD_ENCRYPTION_KEYS="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --rotate-session-key) ROTATE_SESSION_KEY="yes" ;;
    --rotate-encryption-key) ROTATE_ENCRYPTION_KEY="yes" ;;
    --drop-old-encryption-keys) DROP_OLD_ENCRYPTION_KEYS="yes" ;;
    --namespace) shift; NAMESPACE="${1:?--namespace needs a value}" ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$ROTATE_ENCRYPTION_KEY" = "yes" ] && [ "$DROP_OLD_ENCRYPTION_KEYS" = "yes" ]; then
  echo "Use --rotate-encryption-key and --drop-old-encryption-keys in two separate runs (see SECURITY.md)." >&2
  exit 2
fi

for tool in kubectl openssl base64; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: '$tool' is required but not installed." >&2; exit 1; }
done

# Never echo commands (set -x) in this script: it handles credentials.
set +x

existing() {  # value of one key of the current Secret, or nothing
  local path="${1//./\\.}"
  kubectl -n "$NAMESPACE" get secret "$SECRET" -o "jsonpath={.data.$path}" 2>/dev/null | base64 -d 2>/dev/null || true
}

random_urlsafe() {  # $1 = number of random bytes
  openssl rand -base64 "$1" | tr -d '\n' | tr '+/' '-_'
}

kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"

echo "Namespace: $NAMESPACE   Secret: $SECRET"
echo

# ---------------------------------------------------------------- upgrade of an existing installation
CURRENT_DB="$(existing MONGODB_URL)"
UPGRADE="no"
if [ -n "$CURRENT_DB" ] && [ -z "$(existing ENCRYPTION_KEYS)" ]; then
  UPGRADE="yes"
  cat <<'EOF'
An earlier version of the application is installed here. The next release (bash deploy.sh) upgrades the stored data:
  - passwords that were stored in readable form become one-way hashes
  - marketplace and gateway keys are encrypted
The earlier version cannot read upgraded data, so going back afterwards means restoring a backup.

A DATABASE BACKUP IS NEEDED NOW, before you continue.

EOF
  BACKUP_OK="no"
  if command -v docker >/dev/null 2>&1; then
    read -r -p "Make the backup now, on this server (uses Docker and the official 'mongo' image)? [Y/n] " answer
    if [[ ! "$answer" =~ ^[Nn] ]]; then
      BACKUP_DIR="${BACKUP_DIR:-$HOME/leadcrm-backups}"
      BACKUP_FILE="leadcrm-before-upgrade-$(date -u +%Y%m%d-%H%M%S).gz"
      echo "Backing up the database the site uses today (this can take a few minutes) ..."
      # The connection string reaches the container through its environment, not through a command line of
      # this server. "sh -c" keeps the container's start script from switching to a user that cannot write
      # to the backup folder. Anything that looks like a password in the tool's messages is masked.
      if mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR" \
         && MONGO_URI="$CURRENT_DB" docker run --rm -e MONGO_URI -v "$BACKUP_DIR:/backup" "${MONGO_TOOLS_IMAGE:-mongo:7}" \
              sh -c 'mongodump --quiet --uri "$MONGO_URI" --gzip --archive="/backup/$1"' sh "$BACKUP_FILE" 2>&1 \
              | sed -E 's#(mongodb(\+srv)?://[^:/@[:space:]]+:)[^@[:space:]]+@#\1********@#g' \
         && [ -s "$BACKUP_DIR/$BACKUP_FILE" ]; then
        chmod 600 "$BACKUP_DIR/$BACKUP_FILE" 2>/dev/null || true
        BACKUP_OK="yes"
        echo "Backup written: $BACKUP_DIR/$BACKUP_FILE ($(du -h "$BACKUP_DIR/$BACKUP_FILE" 2>/dev/null | cut -f1))"
        echo "It contains all customer data: keep it private and delete it once the new version has run for a few days."
        echo "(How to restore it: SECURITY.md, \"If something goes wrong\".)"
      else
        rm -f "$BACKUP_DIR/$BACKUP_FILE" 2>/dev/null || true
        echo "The automatic backup did not work (see the message above)." >&2
      fi
    fi
  fi
  if [ "$BACKUP_OK" != "yes" ]; then
    cat <<'EOF'

Make the backup yourself - with the MongoDB tools:
    mongodump --uri "<connection string>" --gzip --archive=leadcrm-before-upgrade.gz
or with a snapshot / export in the MongoDB Atlas console. Keep it until the new version has run for a few days.

EOF
    read -r -p 'Type "backup done" to continue: ' answer
    if [ "$answer" != "backup done" ]; then
      echo "Stopped - nothing was changed. Run this script again when the backup exists." >&2
      exit 1
    fi
  fi
  echo
fi

# ---------------------------------------------------------------- database
if [ -n "$CURRENT_DB" ]; then
  echo "A MongoDB connection string is already stored."
  echo "Press Enter to keep it, or paste a new one (for example after replacing the database user or its password)."
  if [ "$UPGRADE" = "yes" ]; then
    cat <<'EOF'

NOTE: earlier versions of this project kept the connection string in the file k8s/secret.yaml. If that file
      was ever pushed to a git repository, the database password is known to others and has to be replaced.
      The way that does not interrupt the running site:
        1. MongoDB Atlas -> Database Access -> Add New Database User
           (password: Autogenerate; built-in role: "Read and write to any database")
        2. paste the connection string of that NEW user below
        3. when the new release works: delete the OLD user in Atlas
      (Changing the old user's password instead works too, but the running site then loses its database
       connection until the new release has finished.)

EOF
  fi
else
  echo "Paste the MongoDB connection string, e.g. mongodb+srv://USER:PASSWORD@cluster-host/"
fi
read -r -s -p "MongoDB connection string (hidden): " MONGODB_URL
echo
if [ -z "$MONGODB_URL" ] && [ "$UPGRADE" = "yes" ]; then
  read -r -p "You kept the stored connection string. Has its password never been in a git repository? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Stopped - nothing was changed. Create the new database user first (see the note above), then run this script again." >&2
    exit 1
  fi
fi
MONGODB_URL="${MONGODB_URL:-$CURRENT_DB}"
case "$MONGODB_URL" in
  mongodb://*|mongodb+srv://*) ;;
  *) echo "ERROR: the connection string must start with mongodb:// or mongodb+srv://" >&2; exit 1 ;;
esac
case "$MONGODB_URL" in
  *[[:space:]]*) echo "ERROR: the connection string contains a space or line break - paste it as one line." >&2; exit 1 ;;
esac
case "$MONGODB_URL" in
  *"<"*|*">"*) echo "ERROR: the connection string still contains a placeholder such as <db_password> - put the real value there (without < >)." >&2; exit 1 ;;
esac

# A new connection string is tried out before it is stored: a mistyped password would otherwise only
# show up minutes later, as a release that does not become healthy.
if [ "$MONGODB_URL" != "$CURRENT_DB" ] && command -v docker >/dev/null 2>&1; then
  TOOLS_IMAGE="${MONGO_TOOLS_IMAGE:-mongo:7}"
  if docker image inspect "$TOOLS_IMAGE" >/dev/null 2>&1 || docker pull --quiet "$TOOLS_IMAGE" >/dev/null 2>&1; then
    echo "Checking that the database accepts this connection string (up to half a minute) ..."
    if MONGO_URI="$MONGODB_URL" docker run --rm -e MONGO_URI "$TOOLS_IMAGE" \
         sh -c 'mongosh "$MONGO_URI" --quiet --eval "db.runCommand({ ping: 1 }).ok"' 2>&1 \
         | sed -E -e 's#(mongodb(\+srv)?://[^:/@[:space:]]+:)[^@[:space:]]+@#\1********@#g' -e '/^1$/d' | tail -n 6; then
      echo "  ok - the database accepted it."
    else
      echo "  The database did NOT accept this connection string (see the message above)." >&2
      echo "  Usual causes: a mistyped password or user name, or this server's address is missing in" >&2
      echo "  MongoDB Atlas -> Network Access." >&2
      read -r -p "  Store it anyway? [y/N] " answer
      if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        echo "Stopped - nothing was changed." >&2
        exit 1
      fi
    fi
  else
    echo "(Not test-connected: the '$TOOLS_IMAGE' image could not be fetched on this server.)"
  fi
fi

# ---------------------------------------------------------------- application keys
ENCRYPTION_KEYS="$(existing ENCRYPTION_KEYS)"
SECRET_KEY="$(existing SECRET_KEY)"
FIRST_RUN="no"
if [ -z "$ENCRYPTION_KEYS" ]; then
  FIRST_RUN="yes"
  # a Fernet key is 32 random bytes in URL-safe base64 (44 characters)
  ENCRYPTION_KEYS="$(random_urlsafe 32)"
  echo "Created a new data-encryption key (ENCRYPTION_KEYS)."
elif [ "$ROTATE_ENCRYPTION_KEY" = "yes" ]; then
  # the first key encrypts, every key in the list can still decrypt: nothing becomes unreadable
  ENCRYPTION_KEYS="$(random_urlsafe 32),$ENCRYPTION_KEYS"
  echo "Added a new data-encryption key in front of the existing one(s)."
elif [ "$DROP_OLD_ENCRYPTION_KEYS" = "yes" ]; then
  case "$ENCRYPTION_KEYS" in
    *,*)
      echo "Removing the old data-encryption key(s) makes everything that is still encrypted with them unreadable for good."
      read -r -p 'Has "python -m app.cli rotate-encryption" finished successfully? Type "rotated" to continue: ' answer
      if [ "$answer" != "rotated" ]; then
        echo "Stopped - nothing was changed." >&2
        exit 1
      fi
      ENCRYPTION_KEYS="${ENCRYPTION_KEYS%%,*}"
      echo "Only the newest data-encryption key is kept."
      ;;
    *) echo "There is only one data-encryption key: nothing to remove." ;;
  esac
else
  echo "Keeping the existing data-encryption key (ENCRYPTION_KEYS)."
fi
if [ "$FIRST_RUN" = "yes" ] || [ "$ROTATE_SESSION_KEY" = "yes" ] || [ "${#SECRET_KEY}" -lt 32 ]; then
  # the previous key may have been published in the repository: it is always replaced on the first run
  SECRET_KEY="$(random_urlsafe 48)"
  echo "Created a new session-signing key (SECRET_KEY). Everybody will have to sign in again."
else
  echo "Keeping the existing session-signing key (SECRET_KEY)."
fi

# ---------------------------------------------------------------- optional values
declare -a EXTRA=()
keep_or_ask() {  # $1 key, $2 question, $3 "hidden" or "shown"
  local key="$1" question="$2" mode="$3" current value=""
  current="$(existing "$key")"
  if [ "$mode" = "hidden" ]; then
    read -r -s -p "$question${current:+ [Enter = keep current]}: " value; echo
  else
    read -r -p "$question${current:+ [Enter = keep current]}: " value
  fi
  value="${value:-$current}"
  if [ -n "$value" ]; then EXTRA+=("$key=$value"); fi
}

admin_password_problem() {  # password, e-mail -> the first rule it breaks (the API applies the same rules), or nothing
  local pw="$1" email="$2" length="${#1}" classes=0 lowered local_part
  local LC_ALL=C   # plain ASCII ranges below, whatever the language of this server
  if [ "$length" -lt 10 ]; then echo "it must be at least 10 characters long"; return; fi
  if [ "$length" -gt 128 ]; then echo "it must be at most 128 characters long"; return; fi
  if [[ "$pw" =~ [a-z] ]]; then classes=$((classes + 1)); fi
  if [[ "$pw" =~ [A-Z] ]]; then classes=$((classes + 1)); fi
  if [[ "$pw" =~ [0-9] ]]; then classes=$((classes + 1)); fi
  if [[ "$pw" =~ [^A-Za-z0-9] ]]; then classes=$((classes + 1)); fi
  if [ "$classes" -lt 3 ]; then echo "it must contain at least 3 of: lower-case letter, upper-case letter, digit, symbol"; return; fi
  lowered="$(printf '%s' "$pw" | tr 'A-Z' 'a-z')"
  case "$lowered" in *password*) echo "it must not contain the word 'password'"; return ;; esac
  case "$lowered" in  # the entries of the application's list of well-known passwords that would pass the rules above
    1234567890|administrator|'p@ssword123'|qwertyuiop|superadmin|superadmin123|welcome123|'welcome@123')
      echo "it is a well-known password"; return ;;
  esac
  local_part="$(printf '%s' "${email%%@*}" | tr 'A-Z' 'a-z')"
  if [ "${#local_part}" -ge 4 ]; then
    case "$lowered" in *"$local_part"*) echo "it must not contain the first part of the e-mail address ('$local_part')"; return ;; esac
  fi
}

echo
read -r -p "Set up the first platform administrator (super admin) now? [y/N] " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  keep_or_ask BOOTSTRAP_SUPERADMIN_EMAIL "  Administrator e-mail" shown
  keep_or_ask BOOTSTRAP_SUPERADMIN_PASSWORD "  Password: 10+ characters with 3 of lower/UPPER/digit/symbol (hidden)" hidden
  # The API silently ignores a bootstrap password that breaks its password rules (it only writes a log line),
  # so the rules are checked here, where the mistake can still be corrected.
  admin_email=""; admin_password=""
  for pair in ${EXTRA[@]+"${EXTRA[@]}"}; do
    case "$pair" in
      BOOTSTRAP_SUPERADMIN_EMAIL=*) admin_email="${pair#*=}" ;;
      BOOTSTRAP_SUPERADMIN_PASSWORD=*) admin_password="${pair#*=}" ;;
    esac
  done
  case "$admin_email" in
    ?*@?*.?*) ;;
    *) echo "ERROR: '$admin_email' is not an e-mail address. Nothing was changed - run the script again." >&2; exit 1 ;;
  esac
  problem="$(admin_password_problem "$admin_password" "$admin_email")"
  if [ -n "$problem" ]; then
    echo "ERROR: this administrator password would be refused by the application: $problem." >&2
    echo "       Nothing was changed - run the script again with another password." >&2
    exit 1
  fi
  unset admin_password problem
  echo "  -> Applied at the next start of the API: the account is created, or - after an upgrade from an"
  echo "     old version - the existing platform administrator gets this password."
  echo "     Two-factor sign-in has to be set up at the first sign-in."
  echo "     Afterwards remove both values again:"
  echo "       kubectl -n $NAMESPACE patch secret $SECRET --type=json \\"
  echo "         -p='[{\"op\":\"remove\",\"path\":\"/data/BOOTSTRAP_SUPERADMIN_EMAIL\"},{\"op\":\"remove\",\"path\":\"/data/BOOTSTRAP_SUPERADMIN_PASSWORD\"}]'"
else
  for key in BOOTSTRAP_SUPERADMIN_EMAIL BOOTSTRAP_SUPERADMIN_PASSWORD; do
    value="$(existing "$key")"; if [ -n "$value" ]; then EXTRA+=("$key=$value"); fi
  done
fi

read -r -p "Configure the platform e-mail relay (password-reset and welcome e-mails)? [y/N] " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  keep_or_ask SMTP_HOST "  SMTP host" shown
  keep_or_ask SMTP_PORT "  SMTP port (587 or 465)" shown
  keep_or_ask SMTP_USERNAME "  SMTP user name" shown
  keep_or_ask SMTP_PASSWORD "  SMTP password (hidden)" hidden
  keep_or_ask SMTP_FROM "  From address, e.g. LeadCRM <no-reply@example.com>" shown
else
  for key in SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD SMTP_FROM; do
    value="$(existing "$key")"; if [ -n "$value" ]; then EXTRA+=("$key=$value"); fi
  done
fi

# ---------------------------------------------------------------- anything else already stored is kept
MANAGED=" MONGODB_URL SECRET_KEY ENCRYPTION_KEYS BOOTSTRAP_SUPERADMIN_EMAIL BOOTSTRAP_SUPERADMIN_PASSWORD SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD SMTP_FROM "
OTHER_KEYS="$(kubectl -n "$NAMESPACE" get secret "$SECRET" -o go-template='{{range $k, $v := .data}}{{$k}} {{end}}' 2>/dev/null || true)"
declare -a UNTOUCHED=()   # copied exactly as stored (still base64-encoded), whatever they contain
for key in $OTHER_KEYS; do
  case "$MANAGED" in *" $key "*) continue ;; esac
  value="$(kubectl -n "$NAMESPACE" get secret "$SECRET" -o "jsonpath={.data.${key//./\\.}}" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    UNTOUCHED+=("$key=$value")
    echo "Keeping the additional key '$key'."
  fi
done

# ---------------------------------------------------------------- write
# The Secret is sent to kubectl through a pipe: the values never touch the disk and never appear in a
# command line (which other users of this server could read in the process list). "printf" is a shell
# built-in, so no separate process sees a value either. Each value is base64-encoded, as Kubernetes
# stores it, which also makes every character safe (spaces, quotes, "=", "%", line breaks).
field() {  # key, value -> one line of the manifest
  printf '  %s: %s\n' "$1" "$(printf '%s' "$2" | base64 | tr -d '\n')"
}
{
  printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n  namespace: %s\ntype: Opaque\ndata:\n' "$SECRET" "$NAMESPACE"
  field MONGODB_URL "$MONGODB_URL"
  field SECRET_KEY "$SECRET_KEY"
  field ENCRYPTION_KEYS "$ENCRYPTION_KEYS"
  for pair in ${EXTRA[@]+"${EXTRA[@]}"}; do field "${pair%%=*}" "${pair#*=}"; done
  for pair in ${UNTOUCHED[@]+"${UNTOUCHED[@]}"}; do printf '  %s: %s\n' "${pair%%=*}" "${pair#*=}"; done
} | kubectl apply -f - >/dev/null

unset MONGODB_URL SECRET_KEY ENCRYPTION_KEYS CURRENT_DB MONGO_URI TOOLS_IMAGE EXTRA UNTOUCHED value answer pair OTHER_KEYS

echo
echo "Secret '$SECRET' saved in namespace '$NAMESPACE'. Stored keys:"
kubectl -n "$NAMESPACE" get secret "$SECRET" -o go-template='{{range $k, $v := .data}}  - {{$k}}{{"\n"}}{{end}}'
echo
if [ "$FIRST_RUN" = "yes" ]; then
  echo "IMPORTANT: back up ENCRYPTION_KEYS now, in your password manager:"
  echo "    kubectl -n $NAMESPACE get secret $SECRET -o jsonpath='{.data.ENCRYPTION_KEYS}' | base64 -d; echo"
  echo "Without it, stored marketplace keys and two-factor seeds cannot be recovered after a cluster loss."
  echo
fi
if [ "$ROTATE_ENCRYPTION_KEY" = "yes" ] && [ "$FIRST_RUN" = "no" ]; then
  echo "Key rotation, next steps:"
  echo "    kubectl -n $NAMESPACE rollout restart deployment/backend-deployment"
  echo "    kubectl -n $NAMESPACE rollout status  deployment/backend-deployment"
  echo "    kubectl -n $NAMESPACE exec deployment/backend-deployment -- python -m app.cli rotate-encryption"
  echo "    bash $0 --drop-old-encryption-keys      (only after the command above reported success)"
  echo "Back up the new ENCRYPTION_KEYS value as well."
  echo
fi
echo "Next: bash deploy.sh   (it builds, tests and releases; pods read the Secret only when they start)."
echo "To apply changed values without a new release:"
echo "    kubectl -n $NAMESPACE rollout restart deployment/backend-deployment"
