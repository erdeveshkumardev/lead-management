# 🚀 LeadCRM - Complete Hostinger VPS Kubernetes (K3s) & Docker Deployment Guide

A production-grade, step-by-step English deployment guide for running **LeadCRM** on a **Hostinger Ubuntu VPS** using **K3s (Lightweight Kubernetes)** and **Docker** with **High Availability (2 Backend Pods + 2 Frontend Pods)**, zero-downtime rolling updates, SSL/TLS encryption, and automated CI/CD.

---

## 📑 Table of Contents

1. [Architecture Overview](#-architecture-overview)
2. [Prerequisites & Server Specifications](#-prerequisites--server-specifications)
3. [Domain & DNS Configuration](#-domain--dns-configuration)
4. [Part 1: First-Time Deployment (From Scratch)](#-part-1-first-time-deployment-from-scratch)
   - [Step 1: SSH into Hostinger VPS](#step-1-ssh-into-hostinger-vps)
   - [Step 2: Update System & Install Core Utilities](#step-2-update-system--install-core-utilities)
   - [Step 3: Configure Firewall (UFW)](#step-3-configure-firewall-ufw)
   - [Step 4: Install Docker Engine](#step-4-install-docker-engine)
   - [Step 5: Install K3s (Lightweight Kubernetes)](#step-5-install-k3s-lightweight-kubernetes)
   - [Step 6: Clone Project Code on VPS](#step-6-clone-project-code-on-vps)
   - [Step 7: Configure Kubernetes Secrets & ConfigMap](#step-7-configure-kubernetes-secrets--configmap)
   - [Step 8: Build Docker Images & Import into K3s](#step-8-build-docker-images--import-into-k3s)
   - [Step 9: Apply Kubernetes Manifests](#step-9-apply-kubernetes-manifests)
   - [Step 10: Setup Free Let's Encrypt SSL/TLS Certificate](#step-10-setup-free-lets-encrypt-ssltls-certificate)
   - [Step 11: Verify Cluster Health & Pods](#step-11-verify-cluster-health--pods)
5. [Part 2: How to Re-Deploy & Update Application](#-part-2-how-to-re-deploy--update-application)
   - [Option A: Automated CI/CD via GitHub Actions (Recommended)](#option-a-automated-cicd-via-github-actions-recommended)
   - [Option B: Manual 1-Click Redeployment (`./deploy.sh`)](#option-b-manual-1-click-redeployment-deploysh)
   - [Option C: Selective Redeployment (Frontend or Backend Only)](#option-c-selective-redeployment-frontend-or-backend-only)
   - [Option D: Fixing Frontend Browser Caching](#option-d-fixing-frontend-browser-caching)
6. [Part 3: Production Operations & Troubleshooting Cheat Sheet](#-part-3-production-operations--troubleshooting-cheat-sheet)
   - [Viewing Live Pod Logs](#1-viewing-live-pod-logs)
   - [Scaling Pods Dynamically](#2-scaling-pods-dynamically)
   - [Executing Shell Inside Pods](#3-executing-shell-inside-pods)
   - [Zero-Downtime Rolling Restarts](#4-zero-downtime-rolling-restarts)
   - [Common Issues & Instant Fixes](#5-common-issues--instant-fixes)
   - [Disk Space & Image Cleanup](#6-disk-space--docker-image-cleanup)
7. [Part 4: Alternative Fallback - Standalone Docker Compose](#-part-4-alternative-fallback---standalone-docker-compose)

---

## 🏗️ Architecture Overview

The production system runs across a dedicated Kubernetes namespace (`leadcrm`) with high availability, self-healing pods, and automatic load balancing:

```text
                                [ Internet / User Request ]
                                             │
                                             ▼
                      https://leadcrm.travistas.in (Port 80 / 443)
                                             │
                              [ Ingress Controller (Traefik) ]
                                             │
                     ┌───────────────────────┴───────────────────────┐
                     │                                               │
             Path: / (Default)                                Path: /api & /docs
                     │                                               │
                     ▼                                               ▼
         [ frontend-service:80 ]                           [ backend-service:8000 ]
         (ClusterIP Load Balancer)                         (ClusterIP Load Balancer)
                     │                                               │
          ┌──────────┴──────────┐                         ┌──────────┴──────────┐
          │                     │                         │                     │
          ▼                     ▼                         ▼                     ▼
 [ frontend-pod-1 ]    [ frontend-pod-2 ]        [ backend-pod-1 ]     [ backend-pod-2 ]
 (React 19 + Nginx)    (React 19 + Nginx)        (FastAPI + Uvicorn)   (FastAPI + Uvicorn)
                                                          │                     │
                                                          └──────────┬──────────┘
                                                                     │
                                                                     ▼
                                                         [ MongoDB Atlas Cloud ]
```

### Components Breakdown:
- **Frontend (2 Replicas):** React 19 + Vite SPA served via Nginx Alpine on Port `80` with gzip compression and strict `no-cache` headers for `index.html`.
- **Backend (2 Replicas):** FastAPI + Python 3.11 Slim with Beanie ODM running on Uvicorn ASGI server on Port `8000`.
- **Ingress Controller:** Inbuilt K3s Traefik routing `/` to Frontend and `/api` to Backend.
- **Database:** Managed MongoDB Atlas Cluster.
- **Namespace:** `leadcrm` (all resources are completely isolated).

---

## 💻 Prerequisites & Server Specifications

| Requirement | Recommended Value | Notes |
| :--- | :--- | :--- |
| **Hosting Provider** | Hostinger VPS | KVM 1, KVM 2, or KVM 4 |
| **Operating System** | Ubuntu 22.04 LTS or 24.04 LTS | Clean 64-bit install |
| **RAM** | Minimum 2 GB (4 GB recommended) | K3s uses only ~512 MB |
| **Storage** | 20 GB+ SSD / NVMe | For Docker images & logs |
| **Domain Name** | `leadcrm.travistas.in` | Any custom domain or subdomain |
| **Database** | MongoDB Atlas (Free M0 or Dedicated) | Cloud-hosted MongoDB cluster |

---

## 🌐 Domain & DNS Configuration

Before starting, configure your DNS record so traffic routes to your Hostinger VPS.

Log in to your DNS provider (Hostinger DNS Zone, Cloudflare, GoDaddy, etc.) and add an **A Record**:

| Record Type | Name / Host | Points to (Value) | TTL | Proxy Status (if Cloudflare) |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `leadcrm` | `YOUR_HOSTINGER_VPS_IP` | 300 / Auto | DNS Only (Grey Cloud) during SSL setup |

> 💡 **Tip:** Verify that your domain resolves to your VPS IP using `ping leadcrm.travistas.in` or `nslookup leadcrm.travistas.in`.

---

## 🚀 Part 1: First-Time Deployment (From Scratch)

Follow these exact steps if you are deploying to a brand new Hostinger VPS.

### Step 1: SSH into Hostinger VPS

Open your terminal (PowerShell, Command Prompt, or macOS/Linux Terminal) and connect to your VPS:

```bash
ssh root@YOUR_VPS_IP
```
*(Replace `YOUR_VPS_IP` with your actual Hostinger VPS IP address).*

---

### Step 2: Update System & Install Core Utilities

Ensure your server is up-to-date and install the required build tools:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget ufw ca-certificates gnupg lsb-release
```

---

### Step 3: Configure Firewall (UFW)

Allow necessary ports for SSH, HTTP, HTTPS, and Kubernetes:

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 6443/tcp    # K3s Kubernetes API Server
sudo ufw --force enable
sudo ufw status
```

---

### Step 4: Install Docker Engine

Install official Docker Engine to build container images:

```bash
# Install Docker via convenience script
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Enable and start Docker service
sudo systemctl enable docker
sudo systemctl start docker

# Add your user to the docker group
sudo usermod -aG docker $USER
```

Verify Docker installation:
```bash
docker --version
```

---

### Step 5: Install K3s (Lightweight Kubernetes)

> 💡 **Why K3s?** Standard `kubeadm` Kubernetes consumes 3-4 GB of RAM just for its control plane. **K3s (CNCF-Certified lightweight Kubernetes)** uses only ~512 MB RAM and comes pre-packaged with Traefik Ingress Controller, CoreDNS, and Local-Path Storage. It is the optimal Kubernetes distribution for VPS hosting.

Run the official K3s installer:

```bash
curl -sfL https://get.k3s.io | sh -
```

Configure `kubectl` permissions for non-root execution:

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc
```

Verify that K3s is healthy:
```bash
kubectl get nodes
```
*Output should show your node with status `Ready`:*
```text
NAME             STATUS   ROLES                  AGE   VERSION
vps-hostname     Ready    control-plane,master   1m    v1.30.x+k3s1
```

---

### Step 6: Clone Project Code on VPS

Clone your repository into the `/root/lead-management` (or `/root/leadcrm`) directory:

```bash
cd /root
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git lead-management
cd lead-management
```

*(If you already have a local directory called `leadcrm`, make sure the directory matches your setup).*

---

### Step 7: Configure Kubernetes Secrets & ConfigMap

Ensure your Kubernetes configuration files contain your production credentials.

#### 1. Edit `k8s/secret.yaml`:
```bash
nano k8s/secret.yaml
```
Ensure your production MongoDB Atlas connection string and secure JWT secret are set:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: leadcrm-secret
  namespace: leadcrm
type: Opaque
stringData:
  MONGODB_URL: "mongodb+srv://<username>:<password>@<cluster>.mongodb.net/"
  SECRET_KEY: "YOUR_PRODUCTION_RANDOM_SECRET_KEY"
```
*(Press `Ctrl + O` then `Enter` to save, and `Ctrl + X` to exit).*

> ⚠️ **Important MongoDB Atlas Whitelist:** In your MongoDB Atlas dashboard, navigate to **Network Access** and ensure your VPS IP address (or `0.0.0.0/0` with secure credentials) is whitelisted, otherwise your backend pods will fail to connect.

#### 2. Edit `k8s/configmap.yaml`:
```bash
nano k8s/configmap.yaml
```
Verify your domain name and CORS origins:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: leadcrm-config
  namespace: leadcrm
data:
  PROJECT_NAME: "Lead-to-Cash LMS"
  API_V1_STR: "/api/v1"
  DATABASE_NAME: "LeadCRM"
  ACCESS_TOKEN_EXPIRE_MINUTES: "10080"
  BACKEND_CORS_ORIGINS: '["https://leadcrm.travistas.in", "http://leadcrm.travistas.in"]'
```

---

### Step 8: Build Docker Images & Import into K3s

K3s uses `containerd` as its internal container runtime. When building images locally using standard Docker on the VPS, we import the built images into K3s `ctr` so Kubernetes can launch them without needing a private registry:

```bash
# 1. Build Backend Image
echo "Building Backend Docker Image..."
docker build -t leadcrm-backend:latest ./backend

# 2. Build Frontend Image
echo "Building Frontend Docker Image..."
docker build -t leadcrm-frontend:latest ./frontend

# 3. Import images directly into K3s runtime
echo "Importing images into K3s containerd..."
docker save leadcrm-backend:latest | sudo k3s ctr images import -
docker save leadcrm-frontend:latest | sudo k3s ctr images import -
```

Verify that the images are available in K3s:
```bash
sudo k3s ctr images list | grep leadcrm
```

---

### Step 9: Apply Kubernetes Manifests

Apply the entire Kubernetes configuration using Kustomize:

```bash
kubectl apply -k k8s/
```

This single command automatically creates:
- The `leadcrm` namespace
- `leadcrm-config` ConfigMap
- `leadcrm-secret` Secret
- `backend-deployment` (2 FastAPI Pods) & `backend-service` (ClusterIP Port 8000)
- `frontend-deployment` (2 Nginx Pods) & `frontend-service` (ClusterIP Port 80)
- `leadcrm-ingress` (Traefik Ingress routing rules)

Wait for pods to be ready:
```bash
kubectl -n leadcrm rollout status deployment/backend-deployment --timeout=120s
kubectl -n leadcrm rollout status deployment/frontend-deployment --timeout=120s
```

---

### Step 10: Setup Free Let's Encrypt SSL/TLS Certificate

To serve traffic securely over `https://leadcrm.travistas.in`:

#### 1. Install Certbot:
```bash
sudo apt install -y certbot
```

#### 2. Generate the SSL Certificate:
```bash
# Stop port 80 temporarily or use DNS / webroot challenge:
sudo certbot certonly --standalone -d leadcrm.travistas.in
```
*(Certbot will save certificates in `/etc/letsencrypt/live/leadcrm.travistas.in/`)*.

#### 3. Store the SSL Certificate in a Kubernetes Secret:
```bash
kubectl -n leadcrm create secret tls leadcrm-tls-secret \
  --cert=/etc/letsencrypt/live/leadcrm.travistas.in/fullchain.pem \
  --key=/etc/letsencrypt/live/leadcrm.travistas.in/privkey.pem \
  --dry-run=client -o yaml | kubectl apply -f -
```

#### 4. Automatic SSL Renewal Cron Job:
Create a monthly cron job to automatically renew the cert and update the Kubernetes secret:
```bash
(crontab -l 2>/dev/null; echo "0 3 1 * * certbot renew --quiet && kubectl -n leadcrm create secret tls leadcrm-tls-secret --cert=/etc/letsencrypt/live/leadcrm.travistas.in/fullchain.pem --key=/etc/letsencrypt/live/leadcrm.travistas.in/privkey.pem --dry-run=client -o yaml | kubectl apply -f -") | crontab -
```

---

### Step 11: Verify Cluster Health & Pods

Check the status of all pods and services:

```bash
kubectl -n leadcrm get pods -o wide
```

You should see **4 Pods** (2 Frontend + 2 Backend) with status `Running`:
```text
NAME                                   READY   STATUS    RESTARTS   AGE   IP
backend-deployment-6b97658f6d-gkkzc    1/1     Running   0          2m    10.42.0.18
backend-deployment-6b97658f6d-sjlsj    1/1     Running   0          2m    10.42.0.19
frontend-deployment-5b5df89b5b-gfxm5   1/1     Running   0          2m    10.42.0.20
frontend-deployment-5b5df89b5b-t8s9f   1/1     Running   0          2m    10.42.0.21
```

Check Services and Ingress:
```bash
kubectl -n leadcrm get svc,ingress
```

Visit in your browser:
- **Application URL:** `https://leadcrm.travistas.in`
- **Backend API Docs:** `https://leadcrm.travistas.in/docs`
- **Health Check Endpoint:** `https://leadcrm.travistas.in/api/v1/healthz` (or `/healthz`)

---

## 🔄 Part 2: How to Re-Deploy & Update Application

Whenever you push new code or make changes, you need to redeploy the updated Docker images to the Kubernetes cluster without causing any downtime for end users.

### Option A: Automated CI/CD via GitHub Actions (Recommended)

The repository includes a ready-to-use GitHub Actions workflow file: [`.github/workflows/deploy.yml`](file:///.github/workflows/deploy.yml).

Every time you run `git push origin main`, GitHub Actions automatically connects to your VPS over SSH, pulls the latest code, rebuilds the images, imports them into K3s, and performs a zero-downtime rolling restart!

#### Setting up GitHub Secrets (One-time setup):
1. In your GitHub repository, go to **Settings** > **Secrets and variables** > **Actions**.
2. Click **New repository secret** and add the following 3 secrets:
   - `VPS_HOST`: Your Hostinger VPS IP address (e.g. `195.35.x.x`).
   - `VPS_USERNAME`: `root`
   - `VPS_SSH_KEY`: Your private SSH key (generated via `ssh-keygen -t rsa -b 4096`).
3. Whenever you commit and push to `main`:
   ```bash
   git add .
   git commit -m "feat: added new feature"
   git push origin main
   ```
4. Watch the deployment complete in real-time under the **Actions** tab of your GitHub repository.

---

### Option B: Manual 1-Click Redeployment (`./deploy.sh`)

If you want to manually redeploy from the VPS:

1. **SSH into your VPS:**
   ```bash
   ssh root@YOUR_VPS_IP
   ```

2. **Navigate to the project folder and pull latest code:**
   ```bash
   cd /root/lead-management
   git pull origin main
   ```

3. **Run the 1-click deployment script:**
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

#### What `deploy.sh` does automatically:
1. Rebuilds `leadcrm-backend:latest` and `leadcrm-frontend:latest`.
2. Imports both images into K3s containerd runtime (`sudo k3s ctr images import -`).
3. Re-applies Kubernetes manifests (`kubectl apply -k k8s/`).
4. Executes rolling restart (`kubectl rollout restart`).
5. Waits until new pods are verified healthy (`kubectl rollout status`).
6. Displays the active pod list.

---

### Option C: Selective Redeployment (Frontend or Backend Only)

If you only edited code in the Frontend or only in the Backend, you can save build time by rebuilding only the affected service.

#### If you only modified the Backend:
```bash
cd /root/lead-management
git pull origin main

# Build and import backend image
docker build --no-cache -t leadcrm-backend:latest ./backend
docker save leadcrm-backend:latest | sudo k3s ctr images import -

# Restart only backend pods (Zero-downtime rolling rollout)
kubectl -n leadcrm rollout restart deployment/backend-deployment

# Check rollout status
kubectl -n leadcrm rollout status deployment/backend-deployment
```

#### If you only modified the Frontend:
```bash
cd /root/lead-management
git pull origin main

# Build and import frontend image
docker build --no-cache -t leadcrm-frontend:latest ./frontend
docker save leadcrm-frontend:latest | sudo k3s ctr images import -

# Restart only frontend pods (Zero-downtime rolling rollout)
kubectl -n leadcrm rollout restart deployment/frontend-deployment

# Check rollout status
kubectl -n leadcrm rollout status deployment/frontend-deployment
```

---

### Option D: Fixing Frontend Browser Caching

If after redeploying you still see older UI screens in your browser:

1. **Why does this happen?** Browsers aggressively cache `.js` bundles and HTML files locally.
2. **How our Nginx configuration prevents this:**
   The `frontend/nginx.conf` is configured with:
   ```nginx
   location = /index.html {
       add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
       add_header Pragma "no-cache";
       expires -1;
   }
   ```
3. **Client Hard Refresh:**
   - **Windows / Linux:** Press `Ctrl + F5` or `Ctrl + Shift + R`
   - **macOS:** Press `Cmd + Shift + R`
   - Or open the website in an **Incognito / Private Window**.

---

## 📊 Part 3: Production Operations & Troubleshooting Cheat Sheet

### 1. Viewing Live Pod Logs

```bash
# Stream live logs for all Backend Pods
kubectl -n leadcrm logs -l app=leadcrm-backend -f --tail=100

# Stream live logs for all Frontend Pods
kubectl -n leadcrm logs -l app=leadcrm-frontend -f --tail=100

# View logs for a specific pod by name
kubectl -n leadcrm logs <pod-name> -f

# View logs from a previously crashed pod
kubectl -n leadcrm logs <pod-name> --previous
```

---

### 2. Scaling Pods Dynamically

To handle high traffic bursts, you can scale the number of pods instantly without restarting the server:

```bash
# Scale Backend to 4 Pods
kubectl -n leadcrm scale deployment backend-deployment --replicas=4

# Scale Frontend to 4 Pods
kubectl -n leadcrm scale deployment frontend-deployment --replicas=4

# Verify scaled pods
kubectl -n leadcrm get pods -o wide
```

To scale back down to 2 pods:
```bash
kubectl -n leadcrm scale deployment backend-deployment --replicas=2
kubectl -n leadcrm scale deployment frontend-deployment --replicas=2
```

---

### 3. Executing Shell Inside Pods

To run commands or inspect files inside a running container:

```bash
# Open interactive bash in a Backend pod
kubectl -n leadcrm exec -it deployment/backend-deployment -- /bin/bash

# Test MongoDB connection from inside the pod
curl -v http://localhost:8000/healthz

# Exit pod shell
exit
```

---

### 4. Zero-Downtime Rolling Restarts

Force Kubernetes to cycle through pods one-by-one:

```bash
kubectl -n leadcrm rollout restart deployment/backend-deployment
kubectl -n leadcrm rollout restart deployment/frontend-deployment
```

---

### 5. Common Issues & Instant Fixes

#### Issue 1: Pods showing `CrashLoopBackOff` or `Error`
- **Cause:** Usually an invalid `MONGODB_URL`, database network rejection, or missing environment variable.
- **Fix:**
  1. Inspect the error log:
     ```bash
     kubectl -n leadcrm logs -l app=leadcrm-backend --tail=50
     ```
  2. If it states `ServerSelectionTimeoutError`: log in to **MongoDB Atlas** > **Network Access** > Click **Add IP Address** > Whitelist your Hostinger VPS IP or `0.0.0.0/0`.
  3. Verify `k8s/secret.yaml` has the correct password and apply it:
     ```bash
     kubectl apply -f k8s/secret.yaml
     kubectl -n leadcrm rollout restart deployment/backend-deployment
     ```

#### Issue 2: Pods stuck in `ErrImageNeverPull` or `ImagePullBackOff`
- **Cause:** K3s cannot find the image `leadcrm-backend:latest` in its local containerd storage.
- **Fix:** Re-import the image from Docker into K3s:
  ```bash
  docker save leadcrm-backend:latest | sudo k3s ctr images import -
  docker save leadcrm-frontend:latest | sudo k3s ctr images import -
  kubectl -n leadcrm rollout restart deployment/backend-deployment
  kubectl -n leadcrm rollout restart deployment/frontend-deployment
  ```

#### Issue 3: Ingress returns `502 Bad Gateway`
- **Cause:** Backend pods are still starting up or failed their health checks.
- **Fix:**
  1. Check pod readiness:
     ```bash
     kubectl -n leadcrm get pods
     ```
  2. If pods show `0/1 Running`, wait 15 seconds for startup probes to pass or check logs:
     ```bash
     kubectl -n leadcrm logs -l app=leadcrm-backend
     ```

#### Issue 4: `404 Not Found` on API Endpoints
- **Cause:** Ingress routing mismatch.
- **Fix:** Ensure your API requests in frontend code target `/api/v1/...`. The Ingress routes any path starting with `/api` directly to `backend-service:8000`.

---

### 6. Disk Space & Docker Image Cleanup

Over time, multiple Docker builds can fill up VPS disk storage. Clean unused images and cache regularly:

```bash
# Remove dangling docker images and build cache
docker system prune -af --volumes

# Remove unused K3s containerd images
sudo k3s crictl rmi --prune

# Check remaining disk space
df -h /
```

---

## 🐳 Part 4: Alternative Fallback - Standalone Docker Compose

If you ever wish to run LeadCRM without Kubernetes, a [`docker-compose.yml`](file:///docker-compose.yml) file is included in the project root.

### Starting with Docker Compose:
```bash
docker compose up -d --build
```

### Checking Status:
```bash
docker compose ps
docker compose logs -f
```

### Stopping:
```bash
docker compose down
```

*Note: In Docker Compose mode, Backend runs on port `8002` and Frontend runs on port `80`.*

---

## 🎯 Quick Command Summary

| Action | Command |
| :--- | :--- |
| **Check Pods Status** | `kubectl -n leadcrm get pods -o wide` |
| **View Backend Logs** | `kubectl -n leadcrm logs -l app=leadcrm-backend -f` |
| **View Frontend Logs** | `kubectl -n leadcrm logs -l app=leadcrm-frontend -f` |
| **Restart Deployments** | `kubectl -n leadcrm rollout restart deployment/backend-deployment deployment/frontend-deployment` |
| **1-Click Redeploy** | `cd /root/lead-management && ./deploy.sh` |
| **Check Ingress & TLS** | `kubectl -n leadcrm get ingress,secret` |

---
*Created for LeadCRM Production Deployment on Hostinger VPS.*
