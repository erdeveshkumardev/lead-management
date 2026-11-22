# Security guide

How this system is protected, how to run it safely, and what to do when something has to be changed.
Written for the person who operates the server; no security background is assumed.

Contents

1. [What protects what](#1-what-protects-what)
2. [Secrets and keys](#2-secrets-and-keys)
3. [Upgrading from the earlier version](#3-upgrading)
4. [Releasing](#4-releasing)
5. [Day-to-day administration](#5-day-to-day-administration)
6. [Real visitor addresses](#6-real-visitor-addresses)
7. [Optional hardening](#7-optional-hardening)
8. [Dependencies](#8-dependencies)
9. [What was tested, and what was not](#9-what-was-tested-and-what-was-not)
10. [Reporting a problem](#10-reporting-a-problem)

---

## 1. What protects what

| Area | Protection |
| --- | --- |
| Passwords | Stored as Argon2id hashes, never readable. At least 10 characters with 3 of lower case / upper case / digit / symbol; well-known passwords and passwords containing the person's name or e-mail are refused. |
| Sign-in | Same answer for "unknown account" and "wrong password". An account is locked for 15 minutes after 5 wrong passwords. Limits per account (10 a minute) and per network address (60 a minute). |
| Two-factor sign-in | Authenticator-app codes (TOTP) with 8 one-time recovery codes. Mandatory for the roles in `MFA_REQUIRED_ROLES` (default: platform administrator). A code cannot be used twice. |
| Sessions | The access token lives 15 minutes and only in the page's memory (not in localStorage). People stay signed in through a refresh token in an HttpOnly, Secure, SameSite=Strict cookie that is replaced on every use; if a replaced one is presented again, every session of that sign-in is ended (a repeat within 15 seconds is treated as the same browser retrying, for example two open tabs). Sessions can be listed and ended from the profile dialog. |
| Cross-site requests | Ordinary calls carry the access token in a header, which another site cannot add. The cookie is only sent to `/api/v1/auth`; the calls that use it also need a custom header that browsers do not send cross-site without permission, and the origin is checked. |
| Company separation | Every request is tied to the company in the verified sign-in token; a company id sent by the browser is never trusted. The platform administrator manages companies but cannot read their leads, invoices or integration keys. |
| Permissions | 15 permissions per user (leads, billing, team, settings, audit ...) checked on the server for every call. Nobody can grant a permission they do not hold. |
| Stored credentials | Marketplace keys, gateway passwords, webhook tokens and two-factor seeds are encrypted at rest (`ENCRYPTION_KEYS`). The screen shows them masked; seeing one in full requires the administrator's password again and is recorded. |
| Webhooks | Every company and provider has its own private token in the address. Website forms: allowed domains, hidden-field and speed traps, optional HMAC signature. Meta deliveries are verified with the App Secret. Size and rate limits. |
| Outgoing connections | Gateway and mail hosts entered by a company are resolved and refused when they point to private or internal addresses (SSRF); redirects are not followed. |
| Files | CSV import is limited to 5 MB / 5000 rows; CSV export neutralises spreadsheet formulas. PDF and CSV downloads need a valid sign-in. |
| Billing | GST is calculated on the server; document numbers are unique per company; a document can only be cancelled, and a payment only reversed, with a reason that is recorded; creating a bill twice by a double click is prevented (idempotency key). |
| Audit trail | Sign-ins, failures, permission changes, deletions, billing actions, key rotations and secret views are recorded with who / when / from where, never with secret values. Kept 400 days. |
| Browser | Content-Security-Policy that only allows the application's own scripts, no framing by other sites, no third-party requests (fonts are bundled), HSTS. |
| API surface | Interactive API documentation is off in production; error answers carry a reference id, never a stack trace; only listed host names are answered. |
| Containers | Both containers run as unprivileged users with all Linux capabilities dropped; the API's file system is read-only; no Kubernetes API token is mounted. |
| Supply chain | Python packages are installed by exact version **and hash**; npm packages from the lock file without install scripts; GitHub Actions pinned to commit ids; weekly vulnerability checks. |
| Configuration | The API refuses to start with a missing, short or well-known key, with `http://` origins in production, or with long-lived access tokens. |

---

## 2. Secrets and keys

### Where they live

| Secret | Purpose | Where |
| --- | --- | --- |
| `MONGODB_URL` | database user and password | Kubernetes Secret `leadcrm-secret` |
| `SECRET_KEY` | signs sign-in tokens | same Secret |
| `ENCRYPTION_KEYS` | encrypts stored integration credentials and two-factor seeds | same Secret **and your password manager** |
| SMTP password (optional) | platform e-mail relay | same Secret |

Nothing secret is stored in this repository, in a Docker image, or in `k8s/`. The Secret is created on the
server by `bash scripts/setup-cluster-secret.sh`, which reads the values without showing them and sends them to
the cluster through a pipe (they are not written to disk and do not appear in a command line).

For local development the values are in `backend/.env`, created by `python -m app.cli init-env`. That file is
ignored by git.

`bash scripts/check-no-secrets.sh` (also run on every push) stops the build when a Secret file, a real `.env`,
a private key or a connection string with a password is about to be committed.

### If you ran the earlier version: do this first

Earlier versions of this project had the database connection string and the signing key **inside the
repository** (`k8s/secret.yaml`, `docker-compose.yml`), and sample webhook tokens in the Postman files.
Anything that was ever pushed must be treated as public, even after the file is deleted.

**Today, before anything else** (no new code needed, the site keeps running):

1. **Restrict who can reach the database.** On the server, `curl -4 ifconfig.me` shows its public address.
   In MongoDB Atlas → *Network Access* add that address, check that the site still works, then delete the
   entry `0.0.0.0/0` ("allow access from anywhere"). From that moment the published password is of no use
   to anybody outside your server. Add your own computer's address as well if you use Compass or run the
   back end locally.
2. Look at the Atlas *Activity Feed* (and, on paid clusters, the database access history) for anything you
   do not recognise.

**As part of the upgrade** ([section 3](#3-upgrading)) the published values themselves are replaced:

3. **Database user.** Create a *new* database user in Atlas (*Database Access → Add New Database User*,
   password *Autogenerate*, built-in role *Read and write to any database*), give its connection string to
   `setup-cluster-secret.sh`, and delete the *old* user as soon as the new release works. The running site
   is not interrupted this way. Do **not** simply change the old user's password first: the running site
   would lose its database connection until the new release has finished.
4. The signing key is replaced automatically by `setup-cluster-secret.sh` on its first run.
5. Every company should press **Regenerate** for its webhook keys (*Settings → Integrations*) after the
   upgrade and enter the new addresses at the marketplaces.
6. Optional but recommended: remove the old values from the git history (see
   [7. Optional hardening](#7-optional-hardening)). This does **not** replace steps 1–5.

### Rotating keys

**Database user** – without interrupting the site: create a new database user in Atlas, then on the server:

```bash
bash scripts/setup-cluster-secret.sh          # paste the new user's connection string (it is test-connected)
kubectl -n leadcrm rollout restart deployment/backend-deployment
kubectl -n leadcrm rollout status  deployment/backend-deployment
```

and delete the old user in Atlas afterwards. (Changing the password of the existing user works as well, but
the site is without a database from that moment until the restart has finished.)

**Signing key** (`SECRET_KEY`) – signs everybody out once:

```bash
bash scripts/setup-cluster-secret.sh --rotate-session-key
kubectl -n leadcrm rollout restart deployment/backend-deployment
```

**Data-encryption key** (`ENCRYPTION_KEYS`) – two guarded steps, nothing becomes unreadable in between:

```bash
bash scripts/setup-cluster-secret.sh --rotate-encryption-key      # new key goes in front, the old one still decrypts
kubectl -n leadcrm rollout restart deployment/backend-deployment
kubectl -n leadcrm rollout status  deployment/backend-deployment
kubectl -n leadcrm exec deployment/backend-deployment -- python -m app.cli rotate-encryption
bash scripts/setup-cluster-secret.sh --drop-old-encryption-keys   # asks you to confirm the step above succeeded
kubectl -n leadcrm rollout restart deployment/backend-deployment
```

Back up the new key afterwards:

```bash
kubectl -n leadcrm get secret leadcrm-secret -o jsonpath='{.data.ENCRYPTION_KEYS}' | base64 -d; echo
```

> **Never lose `ENCRYPTION_KEYS` and never replace it by hand.** Without it the stored marketplace keys,
> gateway passwords and two-factor seeds cannot be read again: every company would have to enter its keys
> again and every two-factor user would need a reset.

---

## 3. Upgrading

*From the version that stored readable passwords and had no sign-in protection.*

### What changes for people

- Everybody signs in again. The old password works **once, within 7 days**, and a new one must be chosen
  immediately. Accounts whose old password was a well-known default (`password123`, `admin123`, ...) are
  locked until their administrator issues a temporary password (*Team → Reset password*).
- The platform administrator has to set up two-factor sign-in at the first sign-in.
- Marketplace webhook addresses now contain a private token. **Leads sent to the old marketplace addresses
  are refused** until the new address from *Settings → Integrations* is entered at IndiaMART, TradeIndia,
  Justdial and Facebook. IndiaMART switches its push off when deliveries keep failing for more than
  48 hours, so do this on the day of the upgrade. Website forms that already send their token to the
  address with the company id normally keep working - test each one after the upgrade.
- Tax invoices need a valid company GSTIN (the check digit is verified) and HSN/SAC codes on every line.

### Data written by the earlier version

- Quotations, invoices and payments are shown and printed exactly as they were stored. Nothing is recalculated.
- **IndiaMART enquiries without a name.** The earlier version could not read IndiaMART's push format. It saved
  such an enquiry as "IndiaMART Buyer" without a phone number, but kept the original data. Shortly after the
  first start the buyer's name, number, e-mail, company, place, product and message are filled in from that
  data. A lead that somebody completed by hand is not changed. Every repaired lead gets a timeline entry
  "DETAILS RESTORED"; the number of leads is written to the log and to the company's audit log. A buyer who
  enquired several times appears as several leads with the same number.
- **IGST on old invoices for customers in your own state.** The earlier version compared the company's state
  *code* ("24") with the text in the lead's state field ("Gujarat"), so it charged IGST whenever a state was
  filled in. New documents charge CGST + SGST inside the state. The application does not change invoices that
  were issued: show them to your accountant, who decides whether a correction (credit note, amendment) is needed.
- Unpaid tax invoices whose due date has passed are shown as **Overdue**.

### Before

- [ ] Network access to the database restricted (previous section).
- [ ] New database user created in Atlas, its connection string at hand (do not save it in a file).
- [ ] People informed (new sign-in, new password, short maintenance window).

The **database backup** is made by `setup-cluster-secret.sh` itself: the upgrade rewrites passwords as hashes
and encrypts integration keys, and the earlier version cannot read that data. The script saves the backup
in `~/leadcrm-backups/` on the server (it uses Docker and the official `mongo` image; without Docker it asks
you to confirm a backup of your own). It contains all customer data: keep it private, delete it after a few days.

### Steps (on the server)

```bash
cd /root/lead-management
git pull origin main                      # or copy the new project files here
bash scripts/setup-cluster-secret.sh      # backup, then the NEW user's connection string (it is test-connected)
bash deploy.sh
```

`deploy.sh` stops before changing anything when the Secret is incomplete, when the cluster rejects a manifest
or when a new image fails its own checks. If the new API or web application does not become healthy, the
previous version and settings are put back automatically.

Pushing to `main` does the same through GitHub Actions. If you push **before** running
`setup-cluster-secret.sh`, the release job fails at "pre-flight" and the site keeps running unchanged.

### After

- [ ] Open the site, sign in as platform administrator, set up two-factor sign-in, store the recovery codes.
      If the administrator's old password was a default one, see
      [Recover the platform administrator](#recover-the-platform-administrator).
- [ ] Back up `ENCRYPTION_KEYS` (command above).
- [ ] Delete the **old** database user in Atlas (*Database Access*).
- [ ] Every company: new webhook addresses entered at the marketplaces; **Regenerate** pressed if the old
      keys were ever shared; Meta needs App Secret, Page access token and the verify token.
- [ ] Company profile: valid GSTIN, state, address; products have HSN/SAC codes.
- [ ] Check [Real visitor addresses](#6-real-visitor-addresses).
- [ ] If you used the bootstrap administrator values, remove them (the command is printed by the script).

### If something goes wrong

`deploy.sh` already restores the previous version when a release fails. To go back **after** a completed
upgrade (first days only):

```bash
kubectl -n leadcrm rollout undo deployment/frontend-deployment
kubectl -n leadcrm rollout undo deployment/backend-deployment
```

and restore the database backup, because the earlier version cannot read upgraded data:

```bash
ls ~/leadcrm-backups/                                   # pick the file
read -rs -p "Connection string: " MONGO_URI; echo; export MONGO_URI
docker run --rm -e MONGO_URI -v "$HOME/leadcrm-backups:/backup" mongo:7 \
  sh -c 'mongorestore --uri "$MONGO_URI" --gzip --archive="/backup/$1" --drop' sh leadcrm-before-upgrade-<date>.gz
unset MONGO_URI
```

Everything entered after the backup was made is lost by a restore, so decide quickly.
The earlier images are removed from the server after three successful releases of this version.

### Stricter option

Set `LEGACY_PASSWORD_MIGRATION: "disable"` in `k8s/configmap.yaml` **before** the first release if no old
password may ever be used again: every account then needs a temporary password from its administrator.

---

## 4. Releasing

```bash
bash deploy.sh
```

| Step | What happens |
| --- | --- |
| Pre-flight | Secret complete? Ingress host names accepted by the API? Manifests accepted by the cluster (dry run)? Otherwise: exit code 2, nothing built or changed. |
| Build | Both images get their own tag (`date-commit`). |
| Self-test | The API image must import as the unprivileged user on a read-only file system; the web image must pass `nginx -t`, answer, and send its security headers. A broken image never reaches the cluster. |
| API | Rolling update; old pods serve until the new ones are healthy. On failure: previous version **and settings** restored, web application untouched. |
| Web | Same. On failure both parts are restored, so versions are never mixed. |
| Clean-up | The newest 3 releases stay on the server for roll-backs; older images are removed. |

Never run `kubectl apply -k k8s/` to release: the manifests carry a placeholder image tag that only
`deploy.sh` fills in (applying them by hand cannot start an untested image – the new pods simply do not start).

Changing settings: edit `k8s/configmap.yaml` and release. Changing a secret: `setup-cluster-secret.sh`, then
`kubectl -n leadcrm rollout restart deployment/backend-deployment`.

The ingress is created once and then left alone, so manual changes survive. After editing
`k8s/ingress.yaml`, apply it yourself: `kubectl apply -f k8s/ingress.yaml`. When you add a host name, also
add it to `ALLOWED_HOSTS` and `BACKEND_CORS_ORIGINS` in `k8s/configmap.yaml` (pre-flight checks this).

---

## 5. Day-to-day administration

Commands run inside a running API pod:

```bash
kubectl -n leadcrm exec -it deployment/backend-deployment -- python -m app.cli <command>
```

| Command | Use |
| --- | --- |
| `create-superadmin you@company.com` | create a platform administrator (asks for the password) |
| `reset-password someone@company.com` | temporary password for any account (must be changed at sign-in, valid 7 days) |
| `reset-mfa someone@company.com` | remove two-factor sign-in after a lost phone **and** lost recovery codes |
| `rotate-encryption` | re-encrypt stored credentials with the newest key (see [Rotating keys](#rotating-keys)) |

Inside the application: *Team* resets passwords and two-factor sign-in of company users; the platform portal
resets a company administrator; *Security & Audit Log* shows who did what.

### Recover the platform administrator

```bash
bash scripts/setup-cluster-secret.sh      # answer "y" to the administrator question: e-mail + a strong password
kubectl -n leadcrm rollout restart deployment/backend-deployment
```

At the next start the API gives that password to the existing platform administrator with this e-mail if the
account is still waiting for its first password change (the situation after an upgrade), or creates the
account when no working platform administrator exists. The script checks the password against the
application's rules first (10+ characters, 3 of lower / upper / digit / symbol, not a well-known password,
not containing the e-mail name), because the API ignores a bootstrap password that breaks them.
Then remove the two values again with the command the script prints.

### Logs

```bash
kubectl -n leadcrm logs -l app=leadcrm-backend --tail=200 -f
```

One JSON line per request with a request id; the same id is shown to the user in error messages. Query
strings, webhook tokens and reset tokens are never written to the logs.

---

## 6. Real visitor addresses

Limits per address and the audit trail are only as good as the address the API sees. On a default K3s
installation the ingress controller usually reports an internal address (`10.42.x.x`) for every visitor.
The application then still works – the per-address limits are deliberately generous – but all visitors
share them and the audit log shows the same address for everyone. The API writes one warning line when it
notices:

```bash
kubectl -n leadcrm logs -l app=leadcrm-backend --tail=1000 | grep "Real visitor addresses"
```

Or sign in and compare the address in *Security & Audit Log* with your own public address.

- Directly on the internet (no CDN): see `k8s/optional/traefik-real-client-ip.yaml`.
- Behind a CDN or proxy: the ingress controller must be told to trust that proxy's addresses
  (Traefik `forwardedHeaders.trustedIPs`) and `FORWARDED_ALLOW_HOPS` must be `"2"`.

Do not raise `FORWARDED_ALLOW_HOPS` without a trusted proxy in front: visitors could then choose their own
address by sending a header.

---

## 7. Optional hardening

Not applied automatically, because each depends on your network. Every file explains how to check first
and how to undo.

| What | How |
| --- | --- |
| Redirect HTTP to HTTPS | `k8s/optional/https-redirect.yaml` |
| Only the ingress controller may reach the pods | `k8s/optional/networkpolicy.yaml` |
| Real visitor addresses | `k8s/optional/traefik-real-client-ip.yaml` |
| Two-factor sign-in for company administrators | `MFA_REQUIRED_ROLES: "super_admin,company_admin"` in `k8s/configmap.yaml` |
| Automatic certificate renewal | The site sends HSTS: if the certificate expires, browsers refuse the site without a "continue anyway" button. `k8s/optional/cert-manager-issuer.yaml` sets up certificates that renew themselves; do not rely on renewing by hand. (`HSTS_MAX_AGE_SECONDS` in the ConfigMap and the last line of `frontend/nginx-security-headers.conf` control the duration.) |
| Server firewall | `ufw allow 22,80,443/tcp && ufw enable`; the K3s API port 6443 does not need to be public. SSH with keys only. |
| GitHub | Enable *Secret scanning* and *Push protection*; protect `main` (pull request + "Security checks" must pass); add the secret `VPS_SSH_FINGERPRINT` (see `.github/workflows/deploy.yml`); use a deploy user that is not `root`. |
| Backups | Atlas scheduled backups or a nightly `mongodump`; test a restore once. |
| Remove old secrets from git history | Rotate first (section 2). Then `git filter-repo --invert-paths --path k8s/secret.yaml` and force-push, or create a fresh repository from the current files. Old clones and forks keep the history, which is why rotating is the real fix. |

---

## 8. Dependencies

- `backend/requirements.txt` – direct packages with exact versions (use this on a development machine).
- `backend/requirements.lock` – the complete tree with hashes for Python 3.11 on Linux; the Docker image and
  CI install **only** this file with `--require-hashes`.

After changing `requirements.txt`:

```bash
cd backend
uv pip compile requirements.txt --python-version 3.11 --generate-hashes -o requirements.lock
python ../scripts/check-lock.py
python -m pytest -q
```

`.github/workflows/security.yml` runs on every push and pull request and every Monday: the tests, `bandit`
(static analysis), `pip-audit` on the lock, `npm audit` on what is shipped to the browser, the lock check and
the credentials check. Dependabot opens weekly pull requests.

If a database-driver update ever causes trouble against your MongoDB version, the previous driver set was
`beanie==1.26.0`, `motor==3.5.1`, `pymongo[srv]==4.7.3`.

### Known and accepted

- `npm audit` reports advisories in **build tools** (esbuild's development server, the `picomatch` pattern
  library used by Tailwind 3 and Vite 5). They are not part of what is sent to browsers
  (`npm audit --omit=dev` reports none) and removing them means moving to Tailwind 4 and Vite 8, which
  changes how the styles are built. Until then: run the development server only on your own machine
  (it listens on `localhost` by default) and do not build untrusted branches.
- Base images are referenced by tag (`python:3.11-slim`, `nginx-unprivileged:stable-alpine`), so each release
  picks up their security fixes (`docker build --pull`). Pinning them by digest is stricter but needs
  a process that updates the digests.
- Text in scripts other than Latin (for example Devanagari) is not drawn by the PDF's built-in font.

---

## 9. What was tested, and what was not

Tested:

- 98 automated back-end tests against an in-memory database: sign-in, lockout, two-factor, sessions,
  company separation, permissions, billing and GST, webhooks, SSRF, upgrade of old data, configuration checks.
- The web application in a real browser against the real API: forced password change, session restore,
  two-factor enrolment and recovery codes, billing flow and PDF, masked secrets, permission limits, and the
  production security headers (no Content-Security-Policy violations, no third-party requests).
  The same on a desktop and on a phone-sized screen (77 checks): every screen fits the phone width, the menu
  works as a drawer, dialogs and the invoice PDF button are reachable.
- The API started with the exact values of `k8s/configmap.yaml` (production mode) on a database in the old
  format: host-name check and probes, security headers, CORS, behaviour of old accounts and default passwords,
  the old plain integration key readable again after encryption, session-cookie flags, refresh replay,
  bootstrap administrator, no secret values in the log.
- The new version on a database that the earlier version itself had written (its own code and package
  versions): 85 checks through the API and 49 in a real browser. Every old lead, document, PDF, payment,
  product, setting and account opens and can be worked with; no server error, no page error.
- `deploy.sh` and `setup-cluster-secret.sh` in more than sixty simulated runs against stand-ins for `kubectl`,
  `docker` and `k3s` (incomplete Secret, failed API, failed web application, broken images, backup, key rotation).
- The package installation of the image and of CI (`pip install --require-hashes -r requirements.lock`) in a
  fresh environment, followed by the tests, `bandit` and `pip-audit`.

**Not** tested, because the tools were not available where this was prepared:

- a real MongoDB / Atlas (including the newer database driver against your cluster),
- building the Docker images and running nginx with `frontend/nginx.conf`,
- a real Kubernetes cluster, and the GitHub workflows.

`deploy.sh` checks the first three on your server before it changes anything, and puts the previous version
back if the new one does not become healthy. Take the backup anyway.

---

## 10. Reporting a problem

If you find a security problem, do not open a public issue. Write to the repository owner privately with
the steps to reproduce it. If a credential may have been exposed, rotate it first (section 2) and
investigate afterwards.
