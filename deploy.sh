#!/usr/bin/env bash
# =============================================================================
#  Lead-to-Cash - build and release to Kubernetes (K3s on one server)
#
#      bash deploy.sh
#
#  A release is all-or-nothing:
#    1. Pre-flight   - nothing is built or changed unless the cluster Secret is
#                      complete and the cluster accepts the manifests.
#    2. Build        - both images get a tag of their own (date-commit), so the
#                      previous release always stays available to go back to.
#    3. Self-test    - the new images are started on this machine first
#                      (API imports, web server configuration, security headers).
#                      A broken image never reaches the cluster.
#    4. Release API  - old pods keep serving until the new ones are healthy.
#                      If they do not get healthy, the previous version and its
#                      settings are put back and the web application is not touched.
#    5. Release web  - same way. If it fails, BOTH parts are put back.
#
#  Exit codes:  0 released
#               1 release failed, previous version restored
#               2 pre-flight failed, nothing was built or changed
#
#  Optional environment variables:
#    NAMESPACE=leadcrm   SECRET_NAME=leadcrm-secret   ROLLOUT_TIMEOUT=300s
#    KEEP_IMAGES=3       (releases kept on this machine to go back to)
#    NO_PULL=1           (do not look for newer base images; use when the registry is unreachable)
#
#  Secrets are never printed: this script only checks that they exist.
# =============================================================================
set -Eeuo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "${BASH_SOURCE[0]}")"

NS="${NAMESPACE:-leadcrm}"
SECRET_NAME="${SECRET_NAME:-leadcrm-secret}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"
KEEP_IMAGES="${KEEP_IMAGES:-3}"
PLACEHOLDER_TAG="set-by-deploy.sh"   # the tag written in k8s/*-deployment.yaml

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

WORK="$(mktemp -d)"
TEST_CONTAINER=""
STAGE="pre-flight"
CONFIG_CHANGED=0
BACKEND_CHANGED=0
FRONTEND_CHANGED=0
BACKEND_REV_BEFORE=""
FRONTEND_REV_BEFORE=""
BACKEND_IMAGE_BEFORE=""
FRONTEND_IMAGE_BEFORE=""
FIRST_SECURED_RELEASE=0
TAG=""

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

cleanup() {
  [ -z "$TEST_CONTAINER" ] || docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ------------------------------------------------------------------ helpers
# (command substitutions below always end in "|| true": a helper can never abort the script by itself)

secret_field() {   # decoded value of one key of the Secret - used for checks only, never printed
  kubectl -n "$NS" get secret "$SECRET_NAME" -o "jsonpath={.data.$1}" 2>/dev/null | base64 -d 2>/dev/null || true
}

revision_of() {    # current revision number of a Deployment ("" when it does not exist)
  kubectl -n "$NS" get deployment "$1" \
    -o 'jsonpath={.metadata.annotations.deployment\.kubernetes\.io/revision}' 2>/dev/null || true
}

image_of() {       # image a Deployment is running ("" when it does not exist)
  kubectl -n "$NS" get deployment "$1" -o 'jsonpath={.spec.template.spec.containers[0].image}' 2>/dev/null || true
}

discard_release_images() {   # a release that failed is thrown away, so it can never be mistaken for a good one
  local part
  [ -n "$TAG" ] || return 0
  for part in backend frontend; do
    docker rmi "leadcrm-$part:$TAG" >/dev/null 2>&1
    if command -v k3s >/dev/null 2>&1; then
      $SUDO k3s ctr images rm "docker.io/library/leadcrm-$part:$TAG" >/dev/null 2>&1
    fi
  done
  return 0
}

config_value() {   # KEY -> value of that key in k8s/configmap.yaml
  awk -F'"' -v key="$1" '$0 ~ "^ *" key ":" { print $2; exit }' k8s/configmap.yaml
}

snapshot() {       # keeps a copy of a live object so it can be put back exactly as it was
  local kind="$1" name="$2" file="$WORK/before-$1-$2.yaml"
  if kubectl -n "$NS" get "$kind" "$name" -o yaml > "$file.raw" 2>/dev/null; then
    grep -vE '^  (resourceVersion|uid|creationTimestamp|generation|selfLink):' "$file.raw" | sed '/^status:/,$d' > "$file"
  fi
  rm -f "$file.raw"
}

put_back() {       # re-applies a snapshot, if there is one
  local file="$WORK/before-$1-$2.yaml"
  [ -s "$file" ] || return 0
  if kubectl apply -f "$file" >/dev/null 2>&1; then
    info "$1/$2 restored"
  else
    warn "$1/$2 could not be restored automatically"
  fi
}

put_back_deployment() {   # name, revision before this release
  local name="$1" before="$2" now
  if [ -z "$before" ]; then
    info "$name did not exist before this release: left in place for inspection"
    return 0
  fi
  now="$(revision_of "$name")"
  [ "$now" != "$before" ] || return 0
  if kubectl -n "$NS" rollout undo "deployment/$name" --to-revision="$before" >/dev/null 2>&1; then
    if kubectl -n "$NS" rollout status "deployment/$name" --timeout=180s >/dev/null 2>&1; then
      info "$name is back on the previous version"
    else
      warn "$name: the previous version was requested but is not healthy yet (kubectl -n $NS get pods)"
    fi
  else
    warn "$name could not be rolled back automatically (kubectl -n $NS rollout undo deployment/$name)"
  fi
}

show_failure() {   # what the newest pod of one part said (application logs never contain secrets)
  local label="$1" pod
  kubectl -n "$NS" get pods -l "app=$label" -o wide 2>/dev/null
  pod="$(kubectl -n "$NS" get pods -l "app=$label" --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | tail -n 1)"
  [ -n "$pod" ] || return 0
  echo "---- last log lines of $pod"
  kubectl -n "$NS" logs "$pod" --tail=40 2>/dev/null || kubectl -n "$NS" logs "$pod" --previous --tail=40 2>/dev/null
  echo "---- last events of $pod"
  kubectl -n "$NS" describe "$pod" 2>/dev/null | sed -n '/^Events:/,$p' | tail -n 12
}

undo_release() {
  if [ "$CONFIG_CHANGED$BACKEND_CHANGED$FRONTEND_CHANGED" = 000 ]; then
    return 0
  fi
  say "Putting the previous version back"
  if [ "$FRONTEND_CHANGED" = 1 ]; then
    put_back_deployment frontend-deployment "$FRONTEND_REV_BEFORE"
    put_back service frontend-service
  fi
  if [ "$CONFIG_CHANGED" = 1 ]; then
    put_back configmap leadcrm-config      # before the API, so its previous version starts with its own settings
  fi
  if [ "$BACKEND_CHANGED" = 1 ]; then
    put_back_deployment backend-deployment "$BACKEND_REV_BEFORE"
    put_back service backend-service
  fi
}

fail_release() {   # message [label of the part whose pods should be shown]
  trap - ERR
  set +e
  set +o pipefail
  [ -z "${2:-}" ] || show_failure "$2" >&2
  printf '\nERROR: %s\n' "$1" >&2
  if [ "$CONFIG_CHANGED$BACKEND_CHANGED$FRONTEND_CHANGED" = 000 ]; then
    discard_release_images
    printf '\nNothing was changed in the cluster: the site keeps running on the current version.\n' >&2
    exit 1
  fi
  undo_release
  discard_release_images
  cat >&2 <<EOF

The release was NOT completed; the previous version and its settings have been put back.
EOF
  if [ "$FIRST_SECURED_RELEASE" = 1 ]; then
    cat >&2 <<EOF
This was the first release of the secured version: if the new API had already started, it has upgraded
stored data (passwords, integration keys), which the previous version cannot read. Fix the cause shown
above and run "bash deploy.sh" again, or restore the database backup taken before the upgrade
(SECURITY.md, "Upgrading").
EOF
  fi
  exit 1
}

preflight_stop() { # message lines
  trap - ERR
  printf '\nPRE-FLIGHT FAILED - nothing was built or changed.\n\n' >&2
  printf '  %s\n' "$@" >&2
  exit 2
}

on_error() {
  if [ "$STAGE" = "pre-flight" ]; then
    preflight_stop "Unexpected error (line $1 of $SCRIPT_NAME)."
  fi
  fail_release "Unexpected error during '$STAGE' (line $1 of $SCRIPT_NAME)."
}
trap 'on_error $LINENO' ERR

host_allowed() {   # host, comma separated allow-list (supports "*" and "*.example.com")
  local host="$1" pattern
  local -a patterns
  IFS=',' read -r -a patterns <<< "$2"
  for pattern in "${patterns[@]}"; do
    pattern="${pattern// /}"
    case "$pattern" in
      "") ;;
      "*") return 0 ;;
      "*."*) case "$host" in *"${pattern#\*}") return 0 ;; esac ;;
      *) [ "$host" != "$pattern" ] || return 0 ;;
    esac
  done
  return 1
}

# ------------------------------------------------------------------ 1. pre-flight
say "1/5 Pre-flight checks"

for tool in kubectl docker base64 awk; do
  command -v "$tool" >/dev/null 2>&1 || preflight_stop "'$tool' is not installed on this machine."
done
kubectl get namespace kube-system >/dev/null 2>&1 \
  || preflight_stop "The cluster cannot be reached with kubectl (is K3s running? is KUBECONFIG set?)."
docker info >/dev/null 2>&1 || preflight_stop "Docker is not running, or this user may not use it."
for file in k8s/namespace.yaml k8s/configmap.yaml k8s/backend-deployment.yaml k8s/frontend-deployment.yaml k8s/ingress.yaml \
            backend/Dockerfile backend/requirements.lock frontend/Dockerfile frontend/package-lock.json; do
  [ -f "$file" ] || preflight_stop "$file is missing - run this script from a complete copy of the project."
done
if [ -e k8s/secret.yaml ]; then
  preflight_stop "k8s/secret.yaml exists. Credentials must never be kept in a file of this project:" \
                 "delete it and create the Secret with:  bash scripts/setup-cluster-secret.sh"
fi

# one release at a time (the lock is this script file itself: no temporary file is created)
if command -v flock >/dev/null 2>&1; then
  exec 9<"$SCRIPT_NAME"
  flock -n 9 || preflight_stop "Another release is running on this machine. Try again when it has finished."
fi

# The Secret must be complete BEFORE anything is touched: the new API refuses to start without these values.
problems=()
if ! kubectl -n "$NS" get secret "$SECRET_NAME" >/dev/null 2>&1; then
  problems+=("the Secret '$SECRET_NAME' does not exist in namespace '$NS'")
else
  value="$(secret_field MONGODB_URL)"
  case "$value" in
    mongodb://*|mongodb+srv://*) ;;
    *) problems+=("MONGODB_URL is missing or is not a MongoDB connection string") ;;
  esac
  value="$(secret_field SECRET_KEY)"
  [ "${#value}" -ge 32 ] || problems+=("SECRET_KEY is missing or shorter than 32 characters")
  value="$(secret_field ENCRYPTION_KEYS)"
  [ -n "$value" ] || problems+=("ENCRYPTION_KEYS is missing")
  unset value
fi
if [ "${#problems[@]}" -gt 0 ]; then
  preflight_stop "The cluster Secret is not ready:" "${problems[@]/#/  - }" "" \
                 "Run this once on the server, then start the release again:" \
                 "    bash scripts/setup-cluster-secret.sh" \
                 "(It asks for the database connection string without showing it and creates the two keys.)" \
                 "The site keeps running on the current version until then."
fi
info "Secret '$SECRET_NAME' is complete"

# Every host name the ingress serves must be accepted by the API, otherwise those visitors would get an error page.
ALLOWED_HOSTS="$(config_value ALLOWED_HOSTS)"
PUBLIC_URL="$(config_value FRONTEND_BASE_URL)"
[ -n "$ALLOWED_HOSTS" ] || preflight_stop "ALLOWED_HOSTS is not set in k8s/configmap.yaml."
case "$PUBLIC_URL" in
  https://*) ;;
  *) preflight_stop "FRONTEND_BASE_URL in k8s/configmap.yaml must be the https:// address of the site." ;;
esac
PUBLIC_URL="${PUBLIC_URL%/}"
LIVE_HOSTS="$(kubectl -n "$NS" get ingress -o 'jsonpath={range .items[*].spec.rules[*]}{.host}{"\n"}{end}' 2>/dev/null || true)"
while IFS= read -r host; do
  [ -n "$host" ] || continue
  host_allowed "$host" "$ALLOWED_HOSTS" || preflight_stop \
    "The ingress serves '$host' but k8s/configmap.yaml only allows: $ALLOWED_HOSTS" \
    "Visitors of '$host' would be refused by the API. Add the host to ALLOWED_HOSTS" \
    "(and its https:// address to BACKEND_CORS_ORIGINS) in k8s/configmap.yaml, then run again."
done <<< "$LIVE_HOSTS"
public_host="${PUBLIC_URL#https://}"
public_host="${public_host%%[:/]*}"
host_allowed "$public_host" "$ALLOWED_HOSTS" || preflight_stop \
  "FRONTEND_BASE_URL ($PUBLIC_URL) is not covered by ALLOWED_HOSTS ($ALLOWED_HOSTS) in k8s/configmap.yaml."
info "host names accepted by the API: $ALLOWED_HOSTS"

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
TAG="$(date -u +%Y%m%d%H%M%S)-${GIT_SHA}"

render() {         # part -> deployment manifest with this release's image tag
  local part="$1" out="$WORK/$1.yaml"
  sed "s|image: leadcrm-$part:$PLACEHOLDER_TAG|image: leadcrm-$part:$TAG|" "k8s/$part-deployment.yaml" > "$out"
  grep -q "image: leadcrm-$part:$TAG" "$out" \
    || preflight_stop "k8s/$part-deployment.yaml does not contain 'image: leadcrm-$part:$PLACEHOLDER_TAG'."
}
render backend
render frontend

# The cluster checks the manifests without storing anything.
if ! kubectl apply --dry-run=server -f k8s/configmap.yaml -f "$WORK/backend.yaml" -f "$WORK/frontend.yaml" > "$WORK/dryrun.log" 2>&1; then
  sed 's/^/    /' "$WORK/dryrun.log" >&2
  preflight_stop "The cluster does not accept the manifests in k8s/ (details above)."
fi
info "manifests accepted by the cluster (dry run)"

if [ -n "$(revision_of backend-deployment)" ] \
   && [ -z "$(kubectl -n "$NS" get configmap leadcrm-config -o 'jsonpath={.data.ENVIRONMENT}' 2>/dev/null || true)" ]; then
  FIRST_SECURED_RELEASE=1
  info "first release of the secured version on this cluster: stored data will be upgraded by the new API"
fi

# ------------------------------------------------------------------ 2. build
STAGE="build"
say "2/5 Building images (tag $TAG)"
PULL="--pull"
[ -z "${NO_PULL:-}" ] || PULL=""
# shellcheck disable=SC2086
docker build $PULL --label "org.opencontainers.image.revision=$GIT_SHA" -t "leadcrm-backend:$TAG" ./backend \
  || fail_release "Building the API image failed (output above)."
# shellcheck disable=SC2086
docker build $PULL --label "org.opencontainers.image.revision=$GIT_SHA" -t "leadcrm-frontend:$TAG" ./frontend \
  || fail_release "Building the web image failed (output above)."

# ------------------------------------------------------------------ 3. self-test on this machine
STAGE="image self-test"
say "3/5 Testing the new images before they go anywhere"

# API: every module imports with the locked packages, as the unprivileged user, on a read-only file system
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --network none -e ENVIRONMENT=development \
  "leadcrm-backend:$TAG" python -c "import app.main" >/dev/null \
  || fail_release "The new API image does not start (error above)."
info "API image: ok"

# Web server: the configuration is valid, the page and its security headers are served
docker run --rm --cap-drop ALL --network none -e BACKEND_UPSTREAM=http://127.0.0.1:8000 \
  "leadcrm-frontend:$TAG" nginx -t >/dev/null 2>"$WORK/nginx-test.log" \
  || { sed 's/^/    /' "$WORK/nginx-test.log" >&2; fail_release "The web server configuration (frontend/nginx.conf) is not valid."; }
TEST_CONTAINER="$(docker run -d --cap-drop ALL --network none -e BACKEND_UPSTREAM=http://127.0.0.1:8000 "leadcrm-frontend:$TAG" 2>/dev/null || true)"
[ -n "$TEST_CONTAINER" ] || fail_release "The new web image could not be started on this machine."
web_ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$TEST_CONTAINER" wget -q -O /dev/null http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    web_ok=1
    break
  fi
  sleep 1
done
if [ "$web_ok" != 1 ]; then
  docker logs "$TEST_CONTAINER" 2>&1 | tail -n 20 >&2 || true
  fail_release "The new web image does not answer on port 8080."
fi
page="$(docker exec "$TEST_CONTAINER" wget -q -O - http://127.0.0.1:8080/ 2>/dev/null || true)"
case "$page" in
  *'id="root"'*) ;;
  *) fail_release "The new web image does not serve the application page." ;;
esac
headers="$(docker exec "$TEST_CONTAINER" wget -S -O /dev/null http://127.0.0.1:8080/ 2>&1 || true)"
case "$headers" in
  *[Cc]ontent-[Ss]ecurity-[Pp]olicy*) ;;
  *) fail_release "The new web image does not send the security headers (frontend/nginx-security-headers.conf)." ;;
esac
unset page headers
docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
TEST_CONTAINER=""
info "web image: ok (configuration valid, page and security headers served)"

# ------------------------------------------------------------------ hand the images to the cluster
STAGE="image import"
if command -v k3s >/dev/null 2>&1; then
  info "importing both images into K3s"
  docker save "leadcrm-backend:$TAG"  | $SUDO k3s ctr images import - >/dev/null \
    || fail_release "The API image could not be imported into K3s."
  docker save "leadcrm-frontend:$TAG" | $SUDO k3s ctr images import - >/dev/null \
    || fail_release "The web image could not be imported into K3s."
else
  warn "k3s was not found: assuming this cluster can already use images built by the local Docker engine."
fi

# ------------------------------------------------------------------ 4. release the API
STAGE="release of the API"
say "4/5 Releasing the API"
snapshot configmap leadcrm-config
snapshot service backend-service
snapshot service frontend-service
BACKEND_REV_BEFORE="$(revision_of backend-deployment)"
FRONTEND_REV_BEFORE="$(revision_of frontend-deployment)"
BACKEND_IMAGE_BEFORE="$(image_of backend-deployment)"
FRONTEND_IMAGE_BEFORE="$(image_of frontend-deployment)"

kubectl get namespace "$NS" >/dev/null 2>&1 || kubectl apply -f k8s/namespace.yaml >/dev/null
CONFIG_CHANGED=1
kubectl apply -f k8s/configmap.yaml >/dev/null
BACKEND_CHANGED=1
kubectl apply -f "$WORK/backend.yaml" >/dev/null
if ! kubectl -n "$NS" rollout status deployment/backend-deployment --timeout="$ROLLOUT_TIMEOUT"; then
  fail_release "The new API did not become healthy within $ROLLOUT_TIMEOUT (its last log lines are shown above)." leadcrm-backend
fi
info "API is healthy on the new version"

# ------------------------------------------------------------------ 5. release the web application
STAGE="release of the web application"
say "5/5 Releasing the web application"
FRONTEND_CHANGED=1
kubectl apply -f "$WORK/frontend.yaml" >/dev/null
if ! kubectl -n "$NS" rollout status deployment/frontend-deployment --timeout="$ROLLOUT_TIMEOUT"; then
  fail_release "The new web application did not become healthy within $ROLLOUT_TIMEOUT (its last log lines are shown above)." leadcrm-frontend
fi
info "web application is healthy on the new version"

# The ingress is created once and then left alone, so manual changes to it (extra host names, annotations) survive.
if kubectl -n "$NS" get ingress leadcrm-ingress >/dev/null 2>&1; then
  info "ingress 'leadcrm-ingress' exists: left unchanged (apply k8s/ingress.yaml yourself after editing it)"
else
  kubectl apply -f k8s/ingress.yaml >/dev/null
  info "ingress created"
fi

# ------------------------------------------------------------------ released: nothing below can undo it
trap - ERR
set +e
set +o pipefail
STAGE="clean-up"

# Keep this release and the previous ones to go back to; remove older images so the disk does not fill up.
# The release that was live until a minute ago is never removed, whatever KEEP_IMAGES says.
for part in backend frontend; do
  previous="$BACKEND_IMAGE_BEFORE"
  [ "$part" = backend ] || previous="$FRONTEND_IMAGE_BEFORE"
  docker images "leadcrm-$part" --format '{{.Tag}}' 2>/dev/null | grep -E '^[0-9]{14}-' | sort -r | tail -n +"$((KEEP_IMAGES + 1))" \
    | while read -r old; do
        [ "leadcrm-$part:$old" = "$previous" ] || docker rmi "leadcrm-$part:$old" >/dev/null 2>&1
      done
  if command -v k3s >/dev/null 2>&1; then
    $SUDO k3s ctr images ls -q 2>/dev/null | grep -E "^docker\.io/library/leadcrm-$part:[0-9]{14}-" | sort -r | tail -n +"$((KEEP_IMAGES + 1))" \
      | while read -r old; do
          [ "$old" = "docker.io/library/$previous" ] || $SUDO k3s ctr images rm "$old" >/dev/null 2>&1
        done
    # The pre-security build (":latest") is removed once enough secured releases exist to go back to,
    # so that it can never be started again by accident.
    releases="$($SUDO k3s ctr images ls -q 2>/dev/null | grep -cE "^docker\.io/library/leadcrm-$part:[0-9]{14}-")"
    in_use="$(kubectl -n "$NS" get pods -o 'jsonpath={..image}' 2>/dev/null | tr ' ' '\n' | grep -c "leadcrm-$part:latest$")"
    if [ "${releases:-0}" -ge "$KEEP_IMAGES" ] && [ "${in_use:-0}" -eq 0 ]; then
      $SUDO k3s ctr images rm "docker.io/library/leadcrm-$part:latest" >/dev/null 2>&1
      docker rmi "leadcrm-$part:latest" >/dev/null 2>&1
    fi
  fi
done
docker image prune -f >/dev/null 2>&1

say "Released $TAG"
kubectl -n "$NS" get pods -o wide
echo
info "Site: $PUBLIC_URL"

# A look from the outside (information only - the release is already complete).
if command -v curl >/dev/null 2>&1; then
  page_code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PUBLIC_URL/healthz" 2>/dev/null)"
  api_code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PUBLIC_URL/api/v1/auth/me" 2>/dev/null)"
  if [ "$page_code" = 200 ] && [ "$api_code" = 401 ]; then
    info "outside check: the page opens and the API answers (401 without sign-in, as expected)"
  else
    warn "outside check: $PUBLIC_URL/healthz returned '${page_code:-no answer}' and /api/v1/auth/me returned '${api_code:-no answer}' (expected 200 and 401)."
    warn "The pods are healthy. If the site does not open, look at DNS, the certificate and the ingress."
  fi
fi

if [ "$FIRST_SECURED_RELEASE" = 1 ]; then
  cat <<EOF

FIRST RELEASE OF THE SECURED VERSION - do these now (details: SECURITY.md, "Upgrading"):
  1. Everybody has to sign in again and is asked to set a new password. Accounts that used a
     well-known default password are locked until their administrator issues a new temporary password.
  2. Platform administrator: sign in and set up two-factor sign-in when asked.
     Cannot sign in?  bash scripts/setup-cluster-secret.sh  (answer "y" to the administrator question), then: bash deploy.sh
  3. Every company: Settings -> Integrations shows NEW webhook addresses. Enter them at IndiaMART,
     TradeIndia, Facebook and in website forms - the old addresses no longer accept leads.
  4. Back up the encryption key now (the command is shown at the end of scripts/setup-cluster-secret.sh).
  5. If you created a new database user for this version: delete the OLD user in MongoDB Atlas now
     (Database Access). Its password was stored in the repository.
EOF
fi
exit 0
