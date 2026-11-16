# 🚀 LeadCRM - Hostinger VPS Kubernetes & Docker Deployment Guide

यह गाइड आपको अपने **LeadCRM** प्रोजेक्ट को **Hostinger VPS (Ubuntu)** पर **Docker** और **Kubernetes (K3s)** के ज़रिए **2 Frontend Pods** और **2 Backend Pods** के साथ High Availability में डिप्लॉय करने का पूरा A-to-Z प्रोसेस सिखाता है।

---

## 🏗️ आर्किटेक्चर (System Architecture)

- **Frontend Deployment (2 Pods):** React + Vite (Nginx Alpine) - Port 80
- **Backend Deployment (2 Pods):** FastAPI + Uvicorn (Python 3.11 Slim) - Port 8000
- **Ingress Controller (Traefik/Nginx):** 
  - `leadcrm.travistas.in/` ➔ Frontend Pods (Load Balanced)
  - `leadcrm.travistas.in/api/` ➔ Backend Pods (Load Balanced)
- **Database:** MongoDB Atlas Cloud (M0/Dedicated)

---

## 📋 Step 1: Hostinger VPS में लॉगिन करें (SSH Access)

अपने टर्मिनल (PowerShell या Mac/Linux Terminal) से VPS में लॉगिन करें:
```bash
ssh root@YOUR_VPS_IP
```
*(यहाँ `YOUR_VPS_IP` की जगह अपने Hostinger VPS का IP एड्रेस डालें)*

---

## 🛠️ Step 2: VPS अपडेट और Docker + K3s इनस्टॉल करें

### 2.1 सिस्टम पैकेज अपडेट करें:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget ufw
```

### 2.2 Docker इनस्टॉल करें:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### 2.3 K3s (Lightweight Kubernetes) इनस्टॉल करें:
> 💡 **K3s क्यों?** मानक `kubeadm` Kubernetes केवल अपने कंट्रोल प्लेन में 3-4 GB RAM खाता है, जबकि **K3s (CNCF Certified Kubernetes)** केवल 512 MB RAM में चलता है और इसमें Ingress Controller (Traefik) पहले से इनबिल्ट आता है। यह Hostinger VPS के लिए सबसे बेस्ट और पावरफुल है।

```bash
curl -sfL https://get.k3s.io | sh -
```

K3s का स्टेटस और `kubectl` चेक करें:
```bash
sudo kubectl get nodes
```
*(Status: `Ready` दिखना चाहिए)*

अगर बिना `sudo` के `kubectl` चलाना चाहते हैं:
```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc
```

---

## 🌐 Step 3: Domain DNS Point करें (Hostinger DNS Zone)

अपने Domain Management (Hostinger / Cloudflare / GoDaddy) में जाएं और यह **A Record** जोड़ें:

| Type | Name / Host | Points to (Value) | TTL |
| :--- | :--- | :--- | :--- |
| **A** | `leadcrm` | `YOUR_VPS_IP` | Automatic / 300 |

*(कुछ ही मिनटों में `leadcrm.travistas.in` आपके VPS IP पर पॉइंट करने लगेगा)*

---

## 📂 Step 4: प्रोजेक्ट कोड VPS पर लाएं

VPS के होम डायरेक्टरी में कोड क्लोन या कॉपी करें:
```bash
cd /root
git clone <YOUR_GIT_REPOSITORY_URL> leadcrm
cd leadcrm
```
*(या आप FileZilla / WinSCP / SCP से भी पूरा फ़ोल्डर अपलोड कर सकते हैं)*

---

## 🚀 Step 5: 1-Click ऑटोमैटिक डिप्लॉयमेंट चलाएं

प्रोजेक्ट में मौजूद `deploy.sh` को एग्जीक्यूट करें:
```bash
chmod +x deploy.sh
./deploy.sh
```

यह स्क्रिप्ट ऑटोमैटिकली:
1. `leadcrm-backend:latest` डॉकर इमेज बिल्ड करेगी।
2. `leadcrm-frontend:latest` डॉकर इमेज बिल्ड करेगी।
3. इमेजेस को K3s के इंटरनल रनटाइम में लोड करेगी।
4. Kubernetes में `leadcrm` नाम का अलग Namespace बनाएगी।
5. ConfigMap, Secrets, 2 Backend Pods, 2 Frontend Pods, ClusterIP Services और Ingress को डिप्लॉय कर देगी।

---

## 🔍 Step 6: Pods का स्टेटस चेक करें

```bash
kubectl -n leadcrm get pods -o wide
```

आपको कुल **4 Pods** (2 Frontend + 2 Backend) Running दिखेंगे:
```text
NAME                                   READY   STATUS    RESTARTS   AGE   IP
backend-deployment-64d84fbb7f-9p2k1    1/1     Running   0          45s   10.42.0.12
backend-deployment-64d84fbb7f-m8xz4    1/1     Running   0          45s   10.42.0.13
frontend-deployment-7bb9cfb879-4k29a   1/1     Running   0          45s   10.42.0.14
frontend-deployment-7bb9cfb879-x7q8b   1/1     Running   0          45s   10.42.0.15
```

---

## 🔒 Step 7: Free SSL Certificate (HTTPS) सेटअप

K3s के साथ Certbot से SSL सर्टिफिकेट सेट करने के लिए:

```bash
sudo apt install -y certbot

# स्टैंडअलोन या DNS के जरिए सर्टिफिकेट जनरेट करें
sudo certbot certonly --standalone -d leadcrm.travistas.in
```

इसके बाद जनरेटेड सर्टिफिकेट को Kubernetes Secret में सेव करें:
```bash
kubectl -n leadcrm create secret tls leadcrm-tls-secret \
  --cert=/etc/letsencrypt/live/leadcrm.travistas.in/fullchain.pem \
  --key=/etc/letsencrypt/live/leadcrm.travistas.in/privkey.pem \
  --dry-run=client -o yaml | kubectl apply -f -
```

इसके बाद आपका डोमेन **`https://leadcrm.travistas.in`** सुरक्षित ग्रीन पैडलॉक (SSL) के साथ लाइव हो जाएगा!

---

## 📊 उपयोगी Kubernetes कमांड्स (Cheat Sheet)

### 1. लाइव लॉग्स देखना (Logs):
```bash
# Backend के लॉग्स देखना
kubectl -n leadcrm logs -l app=leadcrm-backend -f

# Frontend के लॉग्स देखना
kubectl -n leadcrm logs -l app=leadcrm-frontend -f
```

### 2. पॉड्स को स्केल करना (Scale up/down):
अगर आपको 2 पॉड्स से बढ़ाकर 4 पॉड्स करने हों:
```bash
kubectl -n leadcrm scale deployment backend-deployment --replicas=4
kubectl -n leadcrm scale deployment frontend-deployment --replicas=4
```

### 3. पॉड के अंदर टर्मिनल खोलना (Debug):
```bash
kubectl -n leadcrm exec -it deployment/backend-deployment -- /bin/bash
```

### 4. Zero-Downtime रीस्टार्ट:
```bash
kubectl -n leadcrm rollout restart deployment/backend-deployment
kubectl -n leadcrm rollout restart deployment/frontend-deployment
```

---

## 💡 ऑप्शन B: सिम्पल Docker Compose तरीका (No K8s)

अगर कभी आप Kubernetes के बिना सिम्पल Docker Compose से तुरंत चलाना चाहें:
```bash
docker compose up -d --build
```
यह `leadcrm-backend` (Port 8002) और `leadcrm-frontend` (Port 80) को तुरंत शुरू कर देगा!
