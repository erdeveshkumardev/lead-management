# Sabse pehle ye padho

Is folder me poora project hai: saare bugs fix + login, data aur server ki security.
Neeche wahi kaam hain jo **aapko khud** karne hain, sahi order me. Poori detail [SECURITY.md](SECURITY.md) me hai.

Is folder me koi password ya key nahi hai.

---

## 1. Aaj hi (site band nahi hogi, naya code bhi nahi chahiye)

Purane code me database ka password aur signing key repository ke andar likhe the
(`k8s/secret.yaml`, `docker-compose.yml`). Jo cheez ek baar push ho gayi use public maana jata hai.

1. VPS par `curl -4 ifconfig.me` chalao – ye uska public IP hai.
2. **MongoDB Atlas → Network Access:** wo IP add karo, site khol kar dekho ki chal rahi hai,
   phir `0.0.0.0/0` wali entry delete kar do. Ab leak hua password server ke bahar kisi ke kaam ka nahi.
3. **Atlas → Database Access → Add New Database User:** naya user banao (password: *Autogenerate*,
   role: *Read and write to any database*). Uska connection string taiyar rakho, kisi file me save mat karna.

Purane user ka password **abhi mat badalna** – chalti hui site ka database connection toot jayega.
Purana user upgrade ke baad delete hoga (step 3 ka aakhri kaam).

## 2. Is folder ko apne GitHub repo se jodo

Ye code GitHub ke latest `main` (commit `8f3ef12`) ke upar bana hai. Folder ke andar terminal kholo:

```bash
git init -b main
git remote add origin https://github.com/erdeveshkumardev/lead-management.git
git fetch origin
git reset --mixed origin/main      # files nahi badalti; git ko bas pata chalta hai ki kya badla
git status                         # badlav dekho
git add -A
git commit -m "Security hardening and bug fixes"
```

`git push` **abhi mat karo** – pehle step 3 padho.
(Agar `8f3ef12` ke baad aapne GitHub par aur commits kiye hain to pehle bata dena, warna wo changes hat jayenge.)

## 3. Pehli release (order mat badalna)

| # | Kaam | Kahan |
| - | ---- | ----- |
| 1 | `git push origin main` – GitHub Action tests chalayega, phir release **"pre-flight" par ruk jayegi (laal ✗)**. Ye expected hai, site purane version par chalti rahegi. | apni machine |
| 2 | `cd /root/lead-management && git pull origin main` ("Already up to date" aaye to theek hai) | VPS |
| 3 | `bash scripts/setup-cluster-secret.sh` – database ka backup khud leta hai (Enter dabao), phir **naye user** ka connection string paste karo; script use connect karke check bhi karta hai | VPS |
| 4 | `bash deploy.sh` | VPS |
| 5 | Site khol kar login check karo, phir **Atlas me purana database user delete kar do** | browser |

`deploy.sh` nayi images ko pehle test karta hai. Kuch bhi gadbad hui to purana version apne-aap wapas aa jata hai.
Backup `~/leadcrm-backups/` me banta hai – usme saara customer data hai, kuch din baad delete kar dena.

## 4. Release ke baad

- Sabko dobara login karna hoga. Purana password **7 din ke andar ek baar** chalega, turant naya banana padega.
  Jinka password `password123` jaisa default tha, unka account lock rahega – company admin
  **Team → Reset password** se temporary password dega.
- Super admin: login karke **2-step verification** set karo (zaroori hai). Login na ho to
  `bash scripts/setup-cluster-secret.sh` dobara chalao, administrator wale sawal par `y`, phir
  `kubectl -n leadcrm rollout restart deployment/backend-deployment`.
- **Har company: Settings → Integrations me naye webhook address.** IndiaMART, TradeIndia, Justdial aur
  Facebook me usi din update karo – purane address par leads ab accept nahi hongi.
- `ENCRYPTION_KEYS` ka backup password manager me rakho (command script ke end me dikhta hai).
- Company profile me sahi GSTIN bharo (demo GSTIN `24ABCDE1234F1Z5` valid nahi hai) aur products me HSN/SAC.

Purane data ke baare me do baatein:

- **IndiaMART ki purani leads wapas milengi.** Purana version IndiaMART ka asli format padh nahi pata tha, isliye
  wo leads "IndiaMART Buyer" naam se, bina phone number ke save hui thi. Naya version start hone ke thodi der baad
  buyer ka naam, number, email, company aur product apne-aap bhar deta hai (lead ki timeline me "DETAILS RESTORED" dikhega).
- **Purane bills apne CA ko dikhao.** Purana version apne hi state ke customer par bhi IGST laga deta tha
  (CGST + SGST ki jagah). Naye bills sahi bante hain; purane bills software nahi badalta.

## 5. Kya test hua, kya nahi

Test hua: 98 backend tests, asli browser me poora flow (login, 2FA, lead, GST bill, PDF, payment, permissions),
desktop aur phone dono size par (asli server ke saath 77 checks),
purane version ke banaye data par naya version (API se 85 checks + browser me 49 checks, koi error nahi),
`deploy.sh` / secret script ke 60+ simulated runs, aur image wala package install (hash-locked) ek naye environment me.

**Test nahi ho paya** (yahan tools nahi the): asli MongoDB Atlas, Docker image build, nginx, asli Kubernetes
aur GitHub workflows. Isiliye `deploy.sh` aapke server par kuch bhi badalne se **pehle** ye sab check karta hai,
aur isiliye backup zaroori hai.

## 6. Kaun si file kis liye

| File | Kaam |
| ---- | ---- |
| [SECURITY.md](SECURITY.md) | security ka poora guide: keys badalna, upgrade, rollback, optional hardening |
| [KUBERNETES_HOSTINGER_GUIDE.md](KUBERNETES_HOSTINGER_GUIDE.md) | VPS setup, step by step (Hindi) |
| [README.md](README.md) | project, local setup, lead sources jodna |
| `scripts/setup-cluster-secret.sh` | cluster me Secret banana / badalna (password kabhi file me nahi jata) |
| `deploy.sh` | build + test + release |
| `k8s/optional/` | extra hardening jo aap khud on karoge (HTTPS redirect, certificate auto-renew, network policy, real visitor IP) |

Ye file kaam ho jane ke baad delete kar sakte ho.
