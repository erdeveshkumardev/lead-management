# Lead-to-Cash: lead management and GST billing

A multi-company lead management system: leads arrive automatically from IndiaMART, TradeIndia, Justdial,
Meta Lead Ads and website forms, are de-duplicated and worked through a sales pipeline, and are turned into
GST quotations and tax invoices with payment tracking.

- **Security guide, upgrade steps and key handling: [SECURITY.md](SECURITY.md)** – read it before the first release.
- Server set-up on a Hostinger VPS with K3s: [KUBERNETES_HOSTINGER_GUIDE.md](KUBERNETES_HOSTINGER_GUIDE.md)

---

## What it does

| Area | Details |
| --- | --- |
| Lead capture | Tokenised webhooks per company for IndiaMART (push and scheduled pull), TradeIndia, Justdial, Meta Lead Ads and website forms; CSV import; manual entry. Duplicate enquiries are added to the existing lead's timeline. |
| Pipeline | Kanban board with configurable stages, assignment, follow-ups with reminders, activity timeline, custom fields per company, recycle bin for deleted leads. |
| Billing | Quotation, proforma and tax invoice from a lead; CGST+SGST or IGST by place of supply; HSN/SAC; sequential document numbers per company and financial year; payments, reversals and cancellations with reasons; PDF. |
| Companies | Any number of companies on one installation, each with its own users, data, settings and keys. A platform administrator creates and suspends companies but cannot see their business data. |
| People | Roles (company administrator, manager, staff) plus 15 individual permissions; temporary passwords; two-factor sign-in; list of signed-in devices. |
| Oversight | Dashboard and analytics; audit trail of sign-ins, changes, deletions, billing actions and key use. |
| Devices | Works on desktops, tablets and phones: on small screens the menu becomes a slide-in drawer and dialogs fill the screen. |

## Technology

- **Back end**: Python 3.11, FastAPI, Pydantic 2, Beanie + Motor (MongoDB), ReportLab (PDF)
- **Front end**: React 18, TypeScript, Vite 5, Tailwind CSS 3
- **Operations**: Docker, Kubernetes (K3s), GitHub Actions

## Project layout

```
backend/
  app/
    api/v1/endpoints/    auth, leads, invoices, products, team, tenants, webhooks, audit, ...
    core/                config, security (passwords, tokens, 2FA), crypto, deps (who may do what),
                         middleware (headers, limits), net (outgoing-connection checks), gst, audit
    models/              users, sessions, companies, leads, invoices, products, audit log
    services/            sign-in sessions, billing, PDF, CSV, e-mail, marketplace adapters,
                         scheduler, start-up tasks and data upgrade
    cli.py               operator commands (keys, administrators, password / 2FA reset, key rotation)
  tests/                 98 tests: sign-in, company separation, permissions, billing, webhooks, hardening
  requirements.txt       direct packages, exact versions (development)
  requirements.lock      full tree with hashes (Docker image, CI)
frontend/
  src/services/api.ts    the only place that talks to the API (session handling lives here)
  src/pages, components  screens and dialogs
  nginx.conf, nginx-security-headers.conf   web server of the container
k8s/                     manifests; k8s/optional/ = hardening you switch on yourself
scripts/                 setup-cluster-secret.sh, check-no-secrets.sh, check-lock.py
deploy.sh                build, test and release to the cluster (all-or-nothing)
```

---

## Run it on your own machine

You need Python 3.11, Node.js 20 and a MongoDB (local, or a free Atlas cluster).

### 1. Back end

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows      (Linux / macOS: source .venv/bin/activate)
pip install -r requirements-dev.txt

python -m app.cli init-env        # creates backend/.env with freshly generated keys
```

Open `backend/.env` and set `MONGODB_URL` (and `DATABASE_NAME` if you like). Then:

```bash
python -m app.cli seed-demo                       # optional: a demo company with three users (prints their temporary passwords)
python -m app.cli create-superadmin you@example.com   # platform administrator (asks for a password)
python run.py                                     # http://127.0.0.1:8002   API documentation: /docs (development only)
```

`backend/.env` is ignored by git. Never copy real keys into any other file.

### 2. Front end

```bash
cd frontend
npm ci
npm run dev                       # http://localhost:5173
```

The page calls `/api/...` on its own address and Vite passes that on to `http://127.0.0.1:8002`
(set `VITE_DEV_API_TARGET` in `frontend/.env.local` for another address). This is the same arrangement as in
production, where nginx or the ingress does the forwarding, so the session cookie behaves the same.

### 3. Checks

```bash
cd backend  && python -m pytest -q                 # 98 tests, in-memory database, no network needed
cd frontend && npm run build                       # type check + production build
bash scripts/check-no-secrets.sh                      # before every push (Git Bash on Windows)
```

---

## Run it with Docker Compose (one machine)

```bash
cp backend/.env.example backend/.env
docker compose build backend
docker compose run --rm backend python -m app.cli generate-keys    # prints SECRET_KEY and ENCRYPTION_KEYS
```

Paste the two printed lines into `backend/.env`, set `MONGODB_URL` there, then:

```bash
docker compose up -d --build                        # http://localhost  (MongoDB Atlas in MONGODB_URL)
```

No Atlas? For testing you can use a throw-away MongoDB container instead. `localhost` does not work inside
a container, so use the service name:

```bash
# backend/.env:  MONGODB_URL=mongodb://mongo:27017
docker compose --profile local-db up -d --build     # http://localhost
docker compose exec backend python -m app.cli seed-demo   # optional demo company
```

(That database has no password and is reachable only by the API container: never use it for real data.)

Only the web server is published; it forwards `/api/` to the API container. For anything reachable from
the internet set `ENVIRONMENT=production`, your `https://` address in `FRONTEND_BASE_URL`,
`BACKEND_CORS_ORIGINS` and `ALLOWED_HOSTS`, and put a TLS-terminating proxy in front.

## Release to the server (Kubernetes)

```bash
bash scripts/setup-cluster-secret.sh      # once, and whenever a secret changes
bash deploy.sh                            # every release
```

Pushing to `main` runs the tests and then `deploy.sh` on the server through GitHub Actions.
Details, the first-time upgrade and what to do when a release fails: [SECURITY.md](SECURITY.md).

---

## Connecting lead sources

Each company finds its own addresses under **Settings → Integrations**. They look like

```
https://<your-domain>/api/v1/webhooks/<provider>/<company-id>/<private-token>
```

| Source | What to enter where |
| --- | --- |
| IndiaMART | Paste the address into Lead Manager → Push API. For the scheduled pull, enter the CRM key in the application. |
| TradeIndia, Justdial | Give the address to the marketplace / your account manager. |
| Meta Lead Ads | Callback URL and verify token in the Meta app; App Secret and Page access token in the application. |
| Website form | Use the HTML snippet or cURL example shown in the application; list your website under *Allowed domains*. Server-to-server posts can be signed with the signing secret. |

A token can be replaced at any time with **Regenerate**; the old address stops working immediately.
The Postman collection in this folder contains ready-made requests – it holds no credentials; fill in the
environment with your own values.

---

## Licence and support

Internal project. Security problems: see [SECURITY.md](SECURITY.md#10-reporting-a-problem).
