# Lead-to-Cash: High Quality Lead Management & GST Billing System

A modern, multi-tenant Lead Management System (LMS) with automated multi-channel ingestion (IndiaMART, TradeIndia, Meta Lead Ads, Website forms), deduplication, sales pipeline tracking, and 1-click **Lead-to-GST Invoice (Billing)** conversion.

---

## 🚀 Tech Stack

* **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Shadcn UI styling, Vite
* **Backend**: Python 3.11+ / 3.14, FastAPI, Pydantic v2
* **Database (NoSQL)**: MongoDB (with `beanie` async ODM and `motor`)
* **PDF Billing Engine**: ReportLab (Generates branded GST Tax Invoices and Quotations with CGST/SGST/IGST breakdown)

---

## 📂 Project Structure

```
d:\Software Development\Lead Management\
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/
│   │   │   ├── webhooks.py         # IndiaMART, TradeIndia, Meta FB, Website forms
│   │   │   ├── leads.py            # Kanban, CRM activity logs, stage transitions
│   │   │   ├── invoices.py         # Lead-to-Bill conversion & payment ledger
│   │   │   ├── products.py         # Product & Service catalog (HSN/SAC & GST slabs)
│   │   │   ├── analytics.py        # Win rates, total invoiced, pending balances
│   │   │   └── tenants.py          # Multi-company setup & dynamic custom fields
│   │   │   └── router.py           # v1 Router aggregator
│   │   ├── core/
│   │   │   ├── config.py           # Settings & CORS
│   │   │   └── database.py         # MongoDB connection & Beanie initialization
│   │   ├── models/                 # Beanie Document Models
│   │   │   ├── lead.py             # Flexible NoSQL Lead schema + Activity timeline
│   │   │   ├── invoice.py          # Tax Invoices & Quotations
│   │   │   ├── product.py          # Catalog with GST HSN/SAC
│   │   │   ├── counter.py          # Atomic sequential invoice numbering
│   │   │   ├── tenant.py           # Company profile & GSTIN
│   │   │   └── custom_field.py     # Per-industry custom attributes
│   │   ├── services/
│   │   │   ├── lead_service.py     # Phone normalization & deduplication
│   │   │   ├── billing_service.py  # Lead-to-Cash conversion & GST calculator
│   │   │   ├── pdf_service.py      # GST Tax Invoice PDF generator
│   │   │   └── adapters/           # Multi-source ingestion adapters
│   │   │       ├── indiamart.py
│   │   │       ├── tradeindia.py
│   │   │       ├── facebook.py
│   │   │       └── website.py
│   │   └── main.py
│   ├── requirements.txt
│   ├── .env.example
│   └── run.py
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Navbar.tsx
    │   │   ├── KanbanBoard.tsx
    │   │   ├── ConvertToBillModal.tsx  # 1-Click Lead-to-Bill interactive engine
    │   │   └── LeadDetailModal.tsx     # Activity timeline, Call & WhatsApp logging
    │   ├── pages/
    │   │   ├── Dashboard.tsx           # Win rate, revenue billed, receivables
    │   │   ├── LeadsPage.tsx           # Searchable table & new lead modal
    │   │   ├── InvoicesPage.tsx        # Invoices list, PDF download, Record payment
    │   │   ├── ProductsPage.tsx        # Item catalog & GST slabs
    │   │   └── SettingsPage.tsx        # Company profile, GSTIN & Custom fields
    │   ├── services/api.ts
    │   ├── App.tsx
    │   └── main.tsx
    ├── package.json
    ├── tailwind.config.js
    └── vite.config.ts
```

---

## 🛠️ Getting Started

### 1. Backend Setup (FastAPI + MongoDB)

1. Open a terminal in `backend`:
   ```bash
   cd "d:\Software Development\Lead Management\backend"
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the FastAPI server:
   ```bash
   python run.py
   ```
   * Server runs at: `http://localhost:8000`
   * Interactive API Docs (Swagger UI): `http://localhost:8000/docs`

> **Note on MongoDB**: By default, it connects to `mongodb://localhost:27017`. If using MongoDB Atlas, simply set `MONGODB_URL="mongodb+srv://..."` in `backend/.env`.

---

### 2. Frontend Setup (React + Tailwind CSS)

1. Open a terminal in `frontend`:
   ```bash
   cd "d:\Software Development\Lead Management\frontend"
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Start Vite dev server:
   ```bash
   npm run dev
   ```
   * Application runs at: `http://localhost:5173`

---

## ⚡ Key Highlights & Workflows

### 1. Ingestion & Deduplication
* Ingestion webhooks for **IndiaMART**, **TradeIndia**, **Meta Lead Ads**, and **Website Forms** standardise raw payloads into a `StandardLeadDTO`.
* Standardizes phone numbers using `phonenumbers` (E.164 & 10-digit formats).
* If a duplicate lead is detected for the same tenant, the system appends the inquiry to the lead's **Activity Timeline** instead of creating confusing duplicates.

### 2. Multi-Company Type Adaptability
* Uses MongoDB's dynamic `custom_fields: {}` to store industry-specific attributes (e.g. machine capacity, property type, delivery timeline) without modifying the database schema.
* Configurable pipeline stages from inquiry to closed won.

### 3. Lead to Bill Conversion (Lead-to-Cash)
* On the Kanban board or Lead detail view, click **"Convert to Bill"**.
* Select items from the **Product Master** or add custom line items.
* Automatic GST computation:
  * **Intra-State**: 50% CGST + 50% SGST
  * **Inter-State**: 100% IGST
* Sequential invoice number generation with MongoDB atomic counter (e.g. `INV/2026-27/00001`).
* Generates a downloadable, branded **GST Tax Invoice PDF**.
* Tracks payment status (`UNPAID`, `PARTIALLY_PAID`, `PAID`) with ledger reference numbers.
