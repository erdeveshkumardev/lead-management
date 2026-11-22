# LeadCRM – Hostinger VPS पर Docker + Kubernetes (K3s) डिप्लॉयमेंट गाइड

यह गाइड **LeadCRM** को **Hostinger VPS (Ubuntu)** पर **K3s** के साथ चलाने का पूरा तरीका बताती है:
2 Frontend Pods + 2 Backend Pods, HTTPS, और सुरक्षित तरीके से रखे गए पासवर्ड/keys।

> **पहले से चल रहा सर्वर अपग्रेड कर रहे हैं?** सीधे [पुराने वर्ज़न से अपग्रेड](#upgrade) पढ़ें।
> सुरक्षा से जुड़ी पूरी जानकारी (keys बदलना, rollback, optional hardening) [SECURITY.md](SECURITY.md) में है।

---

## आर्किटेक्चर

| हिस्सा | विवरण |
| --- | --- |
| Frontend (2 Pods) | React + Vite, **unprivileged nginx** (root नहीं), container के अंदर port 8080, Service port 80 |
| Backend (2 Pods) | FastAPI + Uvicorn (Python 3.11), non-root user, read-only file system, port 8000 |
| Ingress (Traefik) | `leadcrm.travistas.in/` → Frontend, `leadcrm.travistas.in/api` → Backend |
| Database | MongoDB Atlas |
| Secrets | सिर्फ़ cluster के अंदर Secret `leadcrm-secret` में – **किसी फ़ाइल या git में नहीं** |

दो ज़रूरी नियम:

1. **कोई भी पासवर्ड / key किसी फ़ाइल में न लिखें।** `k8s/secret.yaml` नाम की फ़ाइल अब नहीं बनती;
   Secret सीधे cluster में `bash scripts/setup-cluster-secret.sh` से बनता है।
2. **रिलीज़ हमेशा `bash deploy.sh` से करें**, `kubectl apply -k k8s/` से नहीं। `deploy.sh` नई images को पहले
   जाँचता है, और कुछ गड़बड़ हो तो पुराना वर्ज़न अपने-आप वापस ले आता है।

---

## Step 1: VPS में लॉगिन (SSH)

```bash
ssh root@YOUR_VPS_IP
```

## Step 2: Docker, K3s और Firewall

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget ufw

# Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# K3s (हल्का Kubernetes, Traefik ingress साथ में आता है)
curl -sfL https://get.k3s.io | sh -
sudo kubectl get nodes          # STATUS: Ready
```

बिना `sudo` के `kubectl` चलाने के लिए:

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
chmod 600 ~/.kube/config
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc && export KUBECONFIG=~/.kube/config
```

Firewall – सिर्फ़ SSH, HTTP और HTTPS खुले रखें:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Step 3: Domain का DNS

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `leadcrm` | `YOUR_VPS_IP` | Automatic |

दूसरा domain इस्तेमाल कर रहे हैं तो `k8s/configmap.yaml` (तीन लाइनें: `FRONTEND_BASE_URL`,
`BACKEND_CORS_ORIGINS`, `ALLOWED_HOSTS`) और `k8s/ingress.yaml` में domain बदलें।

## Step 4: कोड VPS पर लाएँ

```bash
cd /root
git clone <YOUR_GIT_REPOSITORY_URL> lead-management
cd lead-management
```

फ़ोल्डर का नाम `/root/lead-management` ही रखें – GitHub Actions (auto deploy) इसी path का इस्तेमाल करता है।

## Step 5: MongoDB Atlas तैयार करें

1. Atlas → **Database Access** → इस ऐप के लिए अलग user बनाएँ, password **Autogenerate** करें।
2. Atlas → **Network Access** → `0.0.0.0/0` हटाएँ, सिर्फ़ अपने VPS का IP जोड़ें।
3. Connection string कॉपी करें (`mongodb+srv://USER:PASSWORD@cluster-host/`)। इसे कहीं सेव न करें –
   अगले स्टेप में सीधे paste करना है।

## Step 6: Secret बनाएँ (एक बार)

```bash
bash scripts/setup-cluster-secret.sh
```

स्क्रिप्ट यह पूछती है:

| सवाल | क्या करें |
| --- | --- |
| MongoDB connection string | paste करें (स्क्रीन पर दिखेगा नहीं) |
| Set up the first platform administrator? | नए सर्वर पर `y` – email और मज़बूत password दें (10+ अक्षर, छोटे/बड़े अक्षर, अंक, चिह्न में से 3) |
| Configure the platform e-mail relay? | password-reset ईमेल चाहिए तो `y`, वरना `n` |

`SECRET_KEY` और `ENCRYPTION_KEYS` स्क्रिप्ट ख़ुद बनाती है। अंत में दिखाए गए command से
**`ENCRYPTION_KEYS` का backup अपने password manager में ज़रूर रखें** – यह key खो गई तो सेव की हुई
marketplace keys और 2FA दोबारा नहीं पढ़े जा सकते।

## Step 7: रिलीज़

```bash
bash deploy.sh
```

यह क्रम से करता है:

1. **Pre-flight** – Secret पूरा है? manifests सही हैं? नहीं तो यहीं रुक जाता है, कुछ नहीं बदलता।
2. **Build** – दोनों images, हर रिलीज़ का अलग tag।
3. **Self-test** – नई images को पहले इसी मशीन पर चलाकर जाँचता है (nginx config, security headers, API)।
4. **API रिलीज़** – पुराने pods तब तक चलते रहते हैं जब तक नए healthy न हो जाएँ।
5. **Web रिलीज़** – वैसे ही। किसी भी स्टेप में गड़बड़ हुई तो पुराना वर्ज़न वापस।

नतीजा: `exit 0` = रिलीज़ हो गई, `exit 1` = रिलीज़ फ़ेल, पुराना वर्ज़न वापस, `exit 2` = pre-flight फ़ेल, कुछ नहीं बदला।

## Step 8: जाँचें

```bash
kubectl -n leadcrm get pods -o wide        # 4 pods Running
```

ब्राउज़र में `https://leadcrm.travistas.in` खोलें, platform administrator से sign in करें और
**two-factor (authenticator app) सेट करें** – यह अनिवार्य है। Recovery codes सुरक्षित जगह रखें।

Administrator बाद में बनाना हो:

```bash
kubectl -n leadcrm exec -it deployment/backend-deployment -- python -m app.cli create-superadmin you@company.com
```

Step 6 में administrator का email/password दिया था तो sign in के बाद उन्हें Secret से हटा दें
(command स्क्रिप्ट ने दिखाया था)।

## Step 9: HTTPS certificate

साइट browser को हमेशा HTTPS इस्तेमाल करने को कहती है (HSTS)। इसलिए certificate का **अपने-आप renew होना
ज़रूरी है** – expire होने पर browser साइट खोलने ही नहीं देगा।

```bash
kubectl -n leadcrm get certificate
```

- `leadcrm-tls-secret` के आगे `READY True` दिखे → सब ठीक है, कुछ नहीं करना।
- कुछ न दिखे या error आए → `k8s/optional/cert-manager-issuer.yaml` खोलें और उसमें लिखे 4 स्टेप करें
  (cert-manager इंस्टॉल + Let's Encrypt issuer)। इसके बाद certificate अपने-आप बनता और renew होता है।

## Step 10: GitHub से auto deploy (वैकल्पिक)

GitHub repository → Settings → Secrets and variables → Actions में ये secrets जोड़ें:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | VPS का IP |
| `VPS_USERNAME` | `root` (या deploy user) |
| `VPS_SSH_KEY` | private SSH key |
| `VPS_SSH_FINGERPRINT` (सुझाव) | सर्वर पर: `ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub \| cut -d ' ' -f2` |

इसके बाद `main` पर हर push: पहले tests चलते हैं, फिर सर्वर पर `bash deploy.sh`। Secret तैयार न हो तो
रिलीज़ "pre-flight" पर रुक जाती है और साइट जैसी थी वैसी चलती रहती है।

---

<a name="upgrade"></a>

## पुराने वर्ज़न से अपग्रेड

पुराने वर्ज़न में database का password और signing key repository के अंदर (`k8s/secret.yaml`) थे, और
passwords database में पढ़े जा सकने वाले रूप में थे। नया वर्ज़न यह सब ठीक करता है, इसलिए पहली रिलीज़
थोड़ी अलग है। **क्रम न बदलें:**

1. **आज ही (साइट बंद नहीं होगी):** सर्वर पर `curl -4 ifconfig.me` चलाकर उसका public IP देखें। Atlas →
   **Network Access** में वह IP जोड़ें, साइट खोलकर देखें कि चल रही है, फिर `0.0.0.0/0` वाली entry हटा दें।
   अब लीक हुआ password सर्वर के बाहर से किसी के काम का नहीं रहा।
2. Atlas → **Database Access → Add New Database User**: नया user बनाएँ (password: *Autogenerate*, role:
   *Read and write to any database*) और उसका connection string तैयार रखें (किसी फ़ाइल में सेव न करें)।
   पुराने user का password **अभी न बदलें** – वरना चलती हुई साइट का database connection टूट जाएगा।
3. सर्वर पर:
   ```bash
   cd /root/lead-management
   git pull origin main
   bash scripts/setup-cluster-secret.sh     # backup ख़ुद लेता है, फिर NAYE user का connection string माँगता और जाँचता है
   bash deploy.sh
   ```
   Backup `~/leadcrm-backups/` में बनता है (अपग्रेड passwords को hash और keys को encrypt कर देता है; पुराना
   वर्ज़न वह data नहीं पढ़ सकता, इसलिए backup ज़रूरी है)। कुछ दिन बाद उसे delete कर दें।
4. रिलीज़ के बाद:
   - साइट पर sign in करके देख लें, फिर **Atlas में पुराना database user delete कर दें।**
   - सभी users को दोबारा sign in करना होगा। पुराना password **7 दिन के अंदर एक बार** चलेगा और तुरंत नया
     बनाना होगा। जिनका password `password123` जैसा default था, उनका account लॉक रहेगा – उनका
     administrator **Team → Reset password** से temporary password देगा।
   - Platform administrator sign in करके two-factor सेट करे। Sign in न हो पाए तो
     `bash scripts/setup-cluster-secret.sh` दोबारा चलाएँ, administrator वाले सवाल पर `y` दें, फिर
     `kubectl -n leadcrm rollout restart deployment/backend-deployment`।
   - **हर कंपनी: Settings → Integrations में नए webhook address दिखेंगे।** इन्हें IndiaMART, TradeIndia,
     Justdial और Facebook में उसी दिन अपडेट करें – पुराने address पर आई leads अब स्वीकार नहीं होंगी।
   - `ENCRYPTION_KEYS` का backup रखें।
   - IndiaMART की जो पुरानी leads "IndiaMART Buyer" नाम से, बिना phone number के सेव हुई थीं, उनमें buyer का
     नाम, number और बाकी जानकारी अपने-आप भर जाती है (lead की timeline में "DETAILS RESTORED" दिखेगा)।
   - पुराना वर्ज़न अपने ही state के customer पर भी IGST लगा देता था। नए bills सही बनते हैं; पुराने bills
     software नहीं बदलता – उन्हें अपने accountant को दिखाएँ।

पूरा checklist और rollback: [SECURITY.md → Upgrading](SECURITY.md#3-upgrading)।

---

## काम के commands

```bash
# Logs
kubectl -n leadcrm logs -l app=leadcrm-backend --tail=200 -f
kubectl -n leadcrm logs -l app=leadcrm-frontend --tail=200 -f

# किसी user का temporary password / 2FA reset
kubectl -n leadcrm exec -it deployment/backend-deployment -- python -m app.cli reset-password someone@company.com
kubectl -n leadcrm exec -it deployment/backend-deployment -- python -m app.cli reset-mfa someone@company.com

# Secret बदलने के बाद (बिना नई रिलीज़ के)
kubectl -n leadcrm rollout restart deployment/backend-deployment

# Pods बढ़ाना
kubectl -n leadcrm scale deployment backend-deployment --replicas=4

# पिछली रिलीज़ पर वापस जाना
kubectl -n leadcrm rollout undo deployment/frontend-deployment
kubectl -n leadcrm rollout undo deployment/backend-deployment
```

## समस्या आए तो

| लक्षण | कारण और हल |
| --- | --- |
| `PRE-FLIGHT FAILED … Secret is not ready` | `bash scripts/setup-cluster-secret.sh` चलाएँ, फिर `bash deploy.sh` |
| `The new API did not become healthy` + log में `Insecure configuration - refusing to start` | log में लिखी सेटिंग ठीक करें (ज़्यादातर `k8s/configmap.yaml` या Secret)। पुराना वर्ज़न अपने-आप वापस आ चुका है। |
| API `400 Invalid host header` देता है | जिस domain से साइट खुल रही है उसे `k8s/configmap.yaml` के `ALLOWED_HOSTS` और `BACKEND_CORS_ORIGINS` में जोड़ें |
| Sign in के बाद बार-बार login पेज | साइट `http://` पर खुल रही है। Production में session cookie सिर्फ़ HTTPS पर काम करती है |
| Audit log में सबका IP `10.42.x.x` | [SECURITY.md → Real visitor addresses](SECURITY.md#6-real-visitor-addresses) |
| रिलीज़ बीच में रुक गई | दोबारा `bash deploy.sh` चलाना सुरक्षित है |

---

## विकल्प B: सिर्फ़ Docker Compose (Kubernetes के बिना)

```bash
cp backend/.env.example backend/.env
docker compose build backend
docker compose run --rm backend python -m app.cli generate-keys     # SECRET_KEY और ENCRYPTION_KEYS दिखाता है
# दोनों लाइनें backend/.env में paste करें, MONGODB_URL वगैरह भरें, फिर:
docker compose up -d --build
```

सिर्फ़ web server (port 80) बाहर खुलता है; API सीधे बाहर से नहीं पहुँचती। Internet पर चलाने के लिए
`backend/.env` में `ENVIRONMENT=production` और अपना `https://` address भरें, और आगे TLS वाला proxy
(Caddy / Traefik / nginx) लगाएँ।
