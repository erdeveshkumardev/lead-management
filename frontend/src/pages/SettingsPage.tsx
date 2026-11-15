import React, { useEffect, useState } from 'react';
import { api, CurrentUser } from '../services/api';
import { 
  Building2, 
  Plus, 
  Sliders, 
  Check, 
  ShieldCheck, 
  Zap, 
  Database, 
  Server, 
  Cpu, 
  Lock, 
  Key, 
  Copy, 
  ExternalLink,
  Save,
  CheckCircle2,
  AlertCircle,
  Globe,
  Radio,
  RefreshCw,
  Code,
  Shield,
  Eye,
  EyeOff
} from 'lucide-react';

interface SettingsPageProps {
  currentUser?: CurrentUser | null;
  tenantId?: string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ currentUser, tenantId }) => {
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const activeTenant = tenantId || currentUser?.tenant_id || 'demo_tenant_01';

  // Sub-tabs for Company Admin
  const [activeTab, setActiveTab] = useState<'integrations' | 'profile' | 'custom_fields'>('integrations');

  // Company Profile state
  const [companyName, setCompanyName] = useState('Apex Machineries Pvt Ltd');
  const [companyType, setCompanyType] = useState('manufacturing');
  const [gstin, setGstin] = useState('24ABCDE1234F1Z5');
  const [stateCode, setStateCode] = useState('24');
  const [stateName, setStateName] = useState('Gujarat');
  const [email, setEmail] = useState('sales@apexmachineries.com');
  const [phone, setPhone] = useState('+919876543210');
  const [city, setCity] = useState('Ahmedabad');
  const [bankName, setBankName] = useState('HDFC Bank');
  const [accountNo, setAccountNo] = useState('50200012345678');
  const [ifsc, setIfsc] = useState('HDFC0001234');
  const [upiId, setUpiId] = useState('apex@hdfcbank');

  // Lead Marketplace Integrations State
  const [indiamartKey, setIndiamartKey] = useState('');
  const [indiamartCrmKey, setIndiamartCrmKey] = useState('');
  const [indiamartEnabled, setIndiamartEnabled] = useState(true);

  const [facebookToken, setFacebookToken] = useState('');
  const [facebookSecret, setFacebookSecret] = useState('');
  const [facebookFormId, setFacebookFormId] = useState('');
  const [facebookEnabled, setFacebookEnabled] = useState(false);

  const [tradeindiaUserId, setTradeindiaUserId] = useState('');
  const [tradeindiaKey, setTradeindiaKey] = useState('');
  const [tradeindiaEnabled, setTradeindiaEnabled] = useState(false);

  const [justdialKey, setJustdialKey] = useState('');
  const [justdialMobile, setJustdialMobile] = useState('');
  const [justdialEnabled, setJustdialEnabled] = useState(false);

  const [websiteToken, setWebsiteToken] = useState('');
  const [websiteSecret, setWebsiteSecret] = useState('');
  const [websiteAllowedDomains, setWebsiteAllowedDomains] = useState('');
  const [websiteEnabled, setWebsiteEnabled] = useState(true);
  const [showWebsiteSecret, setShowWebsiteSecret] = useState(false);
  const [regeneratingKeys, setRegeneratingKeys] = useState(false);
  const [showEmbedCode, setShowEmbedCode] = useState(false);

  // Status & copy feedback
  const [savedAlert, setSavedAlert] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [loading, setLoading] = useState(false);

  // Custom Fields
  const [customFields, setCustomFields] = useState<any[]>([
    { field_key: 'machine_capacity', field_label: 'Machine Power / Capacity', field_type: 'text' },
    { field_key: 'target_delivery_days', field_label: 'Target Delivery Days', field_type: 'number' },
    { field_key: 'application_industry', field_label: 'Industry Category', field_type: 'text' },
  ]);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');

  // Load existing company integrations
  useEffect(() => {
    if (activeTenant) {
      api.getCompanyIntegrations(activeTenant)
        .then((res) => {
          if (res && res.integrations) {
            const i = res.integrations;
            if (i.indiamart) {
              setIndiamartKey(i.indiamart.api_key || '');
              setIndiamartCrmKey(i.indiamart.crm_key || '');
              setIndiamartEnabled(i.indiamart.is_enabled ?? true);
            }
            if (i.facebook) {
              setFacebookToken(i.facebook.api_key || '');
              setFacebookSecret(i.facebook.secret_key || '');
              setFacebookEnabled(i.facebook.is_enabled ?? false);
            }
            if (i.tradeindia) {
              setTradeindiaUserId(i.tradeindia.account_id || '');
              setTradeindiaKey(i.tradeindia.api_key || '');
              setTradeindiaEnabled(i.tradeindia.is_enabled ?? false);
            }
            if (i.justdial) {
              setJustdialKey(i.justdial.api_key || '');
              setJustdialMobile(i.justdial.account_id || '');
              setJustdialEnabled(i.justdial.is_enabled ?? false);
            }
            if (i.website) {
              setWebsiteToken(i.website.webhook_token || '');
              setWebsiteSecret(i.website.secret_key || '');
              setWebsiteAllowedDomains(
                Array.isArray(i.website.allowed_domains) ? i.website.allowed_domains.join(', ') : ''
              );
              setWebsiteEnabled(i.website.is_enabled ?? true);
            }
          }
        })
        .catch(console.error);

      // Load tenant profile
      api.getTenant(activeTenant)
        .then((t) => {
          if (t) {
            if (t.company_name) setCompanyName(t.company_name);
            if (t.company_type) setCompanyType(t.company_type);
            if (t.gstin) setGstin(t.gstin);
            if (t.state_code) setStateCode(t.state_code);
            if (t.state_name) setStateName(t.state_name);
            if (t.email) setEmail(t.email);
            if (t.phone) setPhone(t.phone);
            if (t.city) setCity(t.city);
            if (t.bank_details) {
              setBankName(t.bank_details.bank_name || '');
              setAccountNo(t.bank_details.account_number || '');
              setIfsc(t.bank_details.ifsc_code || '');
              setUpiId(t.bank_details.upi_id || '');
            }
          }
        })
        .catch(console.error);
    }
  }, [activeTenant, isSuperAdmin]);

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  // Save Integrations
  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSavedAlert('');
    try {
      const payload = {
        indiamart: {
          is_enabled: indiamartEnabled,
          api_key: indiamartKey,
          crm_key: indiamartCrmKey,
          status: indiamartKey ? 'Connected' : 'Not Configured'
        },
        facebook: {
          is_enabled: facebookEnabled,
          api_key: facebookToken,
          secret_key: facebookSecret,
          status: facebookToken ? 'Connected' : 'Not Configured'
        },
        tradeindia: {
          is_enabled: tradeindiaEnabled,
          account_id: tradeindiaUserId,
          api_key: tradeindiaKey,
          status: tradeindiaKey ? 'Connected' : 'Not Configured'
        },
        justdial: {
          is_enabled: justdialEnabled,
          api_key: justdialKey,
          account_id: justdialMobile,
          status: justdialKey ? 'Connected' : 'Not Configured'
        },
        website: {
          is_enabled: websiteEnabled,
          webhook_token: websiteToken,
          secret_key: websiteSecret,
          allowed_domains: websiteAllowedDomains
            .split(',')
            .map((d: string) => d.trim())
            .filter((d: string) => Boolean(d)),
          status: 'Active'
        }
      };

      await api.updateCompanyIntegrations(activeTenant, payload);
      setSavedAlert('Marketplace lead API settings saved successfully!');
      setTimeout(() => setSavedAlert(''), 3500);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateKeys = async () => {
    if (!window.confirm("Are you sure you want to regenerate Webhook Security Keys? Any existing forms or scripts using old tokens will immediately stop working until updated.")) {
      return;
    }
    setRegeneratingKeys(true);
    try {
      const res = await api.regenerateIntegrationKeys(activeTenant, 'website');
      if (res && res.webhook_token) {
        setWebsiteToken(res.webhook_token);
        setWebsiteSecret(res.secret_key);
        setSavedAlert('Security keys regenerated successfully! Make sure to update your website forms.');
        setTimeout(() => setSavedAlert(''), 4000);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to regenerate keys');
    } finally {
      setRegeneratingKeys(false);
    }
  };

  // Save Company Profile & GST
  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSavedAlert('');
    try {
      await api.updateTenantProfile(activeTenant, {
        company_name: companyName,
        company_type: companyType,
        gstin,
        state_code: stateCode,
        state_name: stateName,
        email,
        phone,
        city,
        bank_details: {
          bank_name: bankName,
          account_number: accountNo,
          ifsc_code: ifsc,
          upi_id: upiId
        }
      });
      setSavedAlert('Company profile, GST & Bank details updated successfully!');
      setTimeout(() => setSavedAlert(''), 3500);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldKey || !newFieldLabel) return;
    setCustomFields([
      ...customFields,
      { field_key: newFieldKey, field_label: newFieldLabel, field_type: newFieldType },
    ]);
    setNewFieldKey('');
    setNewFieldLabel('');
  };

  // 0. ACCESS GUARD: Sales staff is restricted from viewing or editing administrative settings
  if (currentUser?.role === 'staff') {
    return (
      <div className="py-24 text-center max-w-md mx-auto space-y-4">
        <div className="h-14 w-14 rounded-3xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto border border-slate-200 shadow-sm">
          <ShieldCheck className="h-7 w-7 text-slate-400" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-bold text-slate-900">Administrative Settings Restricted</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Company profile, GST configuration, and lead API credentials can only be accessed by Company Administrators. Please contact your company administrator for any system updates.
          </p>
        </div>
      </div>
    );
  }

  // 1. SUPER ADMIN VIEW: Lead-to-Cash Platform Details & Architecture
  if (isSuperAdmin) {
    return (
      <div className="space-y-6 max-w-5xl">
        {/* Banner */}
        <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white border border-purple-500/20 shadow-2xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300 text-xs font-semibold mb-2">
            <ShieldCheck className="h-3.5 w-3.5 text-purple-400" />
            <span>Lead-to-Cash Core Engine</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Lead-to-Cash Platform & System Specifications
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
            Centralized platform configuration, server architecture, cloud MongoDB Atlas connectivity, and multi-tenant security parameters.
          </p>
        </div>

        {/* System Details Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
            <div className="flex items-center gap-2.5 text-indigo-600 font-bold">
              <Server className="h-5 w-5" />
              <span>Core Application Framework</span>
            </div>
            <div className="space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Platform:</span>
                <span className="font-bold text-slate-800">Lead-to-Cash Enterprise</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Backend:</span>
                <span className="font-bold text-slate-800">FastAPI (Python 3.14 Async)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Server Port:</span>
                <span className="font-bold text-indigo-600 font-mono">8002 (Dedicated)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Frontend:</span>
                <span className="font-bold text-slate-800">React 18 + Tailwind + Vite</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
            <div className="flex items-center gap-2.5 text-emerald-600 font-bold">
              <Database className="h-5 w-5" />
              <span>Cloud Database Architecture</span>
            </div>
            <div className="space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Engine:</span>
                <span className="font-bold text-slate-800">MongoDB Atlas Serverless</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ODM Driver:</span>
                <span className="font-bold text-slate-800">Motor + Beanie ODM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cluster Host:</span>
                <span className="font-bold text-emerald-700 font-mono text-[10px]">leadcrm.kkdslp4</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Isolation:</span>
                <span className="font-bold text-emerald-600">Strict Tenant Scoping</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
            <div className="flex items-center gap-2.5 text-purple-600 font-bold">
              <Lock className="h-5 w-5" />
              <span>Security & Licensing Policy</span>
            </div>
            <div className="space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Default Quota:</span>
                <span className="font-bold text-slate-800">5 Seats / Company</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Enforcement:</span>
                <span className="font-bold text-purple-700">Strict Backend Barrier</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Integrations:</span>
                <span className="font-bold text-slate-800">Company-Private Credentials</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Super Admin Scope:</span>
                <span className="font-bold text-slate-800">Global Read & Audit</span>
              </div>
            </div>
          </div>
        </div>

        {/* Platform Compliance, Governance & Operational Standards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">Platform Governance & Security</h3>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Active Enforced
              </span>
            </div>
            <div className="space-y-2 text-slate-600">
              <div className="flex items-start gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                <p><strong>Strict Multi-Tenant Scoping:</strong> BSON ObjectId verification guarantees each client company cannot see or query records of another client company.</p>
              </div>
              <div className="flex items-start gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                <p><strong>Licensing Quota Gatekeeper:</strong> System rejects team creation requests when a company reaches its allocated maximum seat limit.</p>
              </div>
              <div className="flex items-start gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                <p><strong>Immutable Ledger:</strong> Converted GST Tax Invoices retain chronological audit trails and cannot be overwritten.</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">Cloud Operations & Reliability</h3>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                Healthy (99.98%)
              </span>
            </div>
            <div className="space-y-2 text-slate-600">
              <div className="flex items-start gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <p><strong>High-Performance Async API:</strong> Built on ASGI Uvicorn workers with non-blocking I/O event loops.</p>
              </div>
              <div className="flex items-start gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <p><strong>Database Connection Pool:</strong> Motor connection pooling with persistent keep-alive and automated failover.</p>
              </div>
              <div className="flex items-start gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <p><strong>Automated Backups:</strong> MongoDB Atlas point-in-time cloud snapshots enabled for disaster recovery.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. COMPANY ADMIN VIEW: Integrations + Company Profile & GST + Custom Fields
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Company & Marketplace Settings</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage your company's IndiaMART, Facebook, TradeIndia, Justdial API keys, GST profile & bank ledger.
          </p>
        </div>

        {/* Tab Pills */}
        <div className="flex items-center p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-bold">
          <button
            onClick={() => setActiveTab('integrations')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'integrations'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Marketplace APIs
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'profile'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Profile & GST
          </button>
          <button
            onClick={() => setActiveTab('custom_fields')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'custom_fields'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Custom Fields
          </button>
        </div>
      </div>

      {savedAlert && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <span className="font-bold">{savedAlert}</span>
        </div>
      )}

      {/* TAB 1: Marketplace & Inbound Lead APIs */}
      {activeTab === 'integrations' && (
        <form onSubmit={handleSaveIntegrations} className="space-y-5 text-xs">
          {/* Section 1: IndiaMART */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-red-50 text-red-600 font-extrabold flex items-center justify-center text-sm border border-red-200">
                  IM
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">IndiaMART Push API & Webhook</h3>
                  <p className="text-[11px] text-slate-400">Ingest real-time RFQs and buyer inquiries automatically.</p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[11px] font-semibold text-slate-600">Enabled</span>
                <input
                  type="checkbox"
                  checked={indiamartEnabled}
                  onChange={(e) => setIndiamartEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">IndiaMART CRM API Key</label>
                <input
                  type="text"
                  placeholder="e.g. mRxxxxxxxxxxxxxxxxxxx="
                  value={indiamartKey}
                  onChange={(e) => setIndiamartKey(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Push Webhook Key (GLUSR_CRM_KEY)</label>
                <input
                  type="text"
                  placeholder="e.g. secret_crm_key"
                  value={indiamartCrmKey}
                  onChange={(e) => setIndiamartCrmKey(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Company Webhook Push URL (Copy into IndiaMART)</label>
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={`http://localhost:8002/api/v1/webhooks/indiamart/${activeTenant}`}
                    className="w-full border border-slate-200 rounded-xl pl-3 pr-20 py-2 bg-slate-100 text-slate-600 font-mono text-[11px] select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`http://localhost:8002/api/v1/webhooks/indiamart/${activeTenant}`, 'im')}
                    className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                  >
                    {copiedKey === 'im' ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Facebook / Meta Lead Ads */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 font-extrabold flex items-center justify-center text-sm border border-blue-200">
                  FB
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Meta / Facebook Lead Ads Webhook</h3>
                  <p className="text-[11px] text-slate-400">Capture leads instantly from Facebook and Instagram lead forms.</p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[11px] font-semibold text-slate-600">Enabled</span>
                <input
                  type="checkbox"
                  checked={facebookEnabled}
                  onChange={(e) => setFacebookEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Page Access Token (Permanent / Long-lived)</label>
                <input
                  type="password"
                  placeholder="EAABxxxxxxxxxxxxxxxxxxxxxxx"
                  value={facebookToken}
                  onChange={(e) => setFacebookToken(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono bg-slate-50 focus:bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Facebook Webhook Callback URL</label>
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={`http://localhost:8002/api/v1/webhooks/facebook/${activeTenant}`}
                    className="w-full border border-slate-200 rounded-xl pl-3 pr-20 py-2 bg-slate-100 text-slate-600 font-mono text-[11px] select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`http://localhost:8002/api/v1/webhooks/facebook/${activeTenant}`, 'fb')}
                    className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                  >
                    {copiedKey === 'fb' ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: TradeIndia */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 font-extrabold flex items-center justify-center text-sm border border-amber-200">
                  TI
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">TradeIndia Inquiries API</h3>
                  <p className="text-[11px] text-slate-400">Sync TradeIndia buyer inquiries directly into pipeline.</p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[11px] font-semibold text-slate-600">Enabled</span>
                <input
                  type="checkbox"
                  checked={tradeindiaEnabled}
                  onChange={(e) => setTradeindiaEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">User ID / Profile ID</label>
                <input
                  type="text"
                  placeholder="e.g. 5184209"
                  value={tradeindiaUserId}
                  onChange={(e) => setTradeindiaUserId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">TradeIndia Webhook Push Endpoint</label>
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={`http://localhost:8002/api/v1/webhooks/tradeindia/${activeTenant}`}
                    className="w-full border border-slate-200 rounded-xl pl-3 pr-20 py-2 bg-slate-100 text-slate-600 font-mono text-[11px] select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`http://localhost:8002/api/v1/webhooks/tradeindia/${activeTenant}`, 'ti')}
                    className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                  >
                    {copiedKey === 'ti' ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Justdial */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-orange-50 text-orange-600 font-extrabold flex items-center justify-center text-sm border border-orange-200">
                  JD
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Justdial Lead API & Push</h3>
                  <p className="text-[11px] text-slate-400">Receive verified telephone and web inquiries from Justdial portal.</p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[11px] font-semibold text-slate-600">Enabled</span>
                <input
                  type="checkbox"
                  checked={justdialEnabled}
                  onChange={(e) => setJustdialEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Justdial Lead API Key</label>
                <input
                  type="text"
                  placeholder="e.g. JD_API_KEY_xxxx"
                  value={justdialKey}
                  onChange={(e) => setJustdialKey(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Justdial Webhook Push URL</label>
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={`http://localhost:8002/api/v1/webhooks/justdial/${activeTenant}`}
                    className="w-full border border-slate-200 rounded-xl pl-3 pr-20 py-2 bg-slate-100 text-slate-600 font-mono text-[11px] select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`http://localhost:8002/api/v1/webhooks/justdial/${activeTenant}`, 'jd')}
                    className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                  >
                    {copiedKey === 'jd' ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 5: Website Contact Form (Dual-Channel Ingestion) */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 font-extrabold flex items-center justify-center text-sm border border-emerald-200">
                  WEB
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-slate-900">Website & Landing Page Form Webhook</h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Dual-Channel Protected
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Captures leads from WordPress, Elementor, React, Zapier, or custom backends.</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-[11px] font-semibold text-slate-600">Enabled</span>
                  <input
                    type="checkbox"
                    checked={websiteEnabled}
                    onChange={(e) => setWebsiteEnabled(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-0 h-4 w-4"
                  />
                </label>
              </div>
            </div>

            {/* Security Shields Banner */}
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Active Bot Shield:</strong> IP Rate Limiting (10/min) • Honeypot Trap • Fast-Submit Speed Trap • Domain Whitelisting • HMAC Signing
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmbedCode(!showEmbedCode)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold text-[10px] shadow-sm"
                >
                  <Code className="h-3.5 w-3.5 text-indigo-600" />
                  <span>{showEmbedCode ? 'Hide Embed Code' : 'Get HTML/JS Form Code'}</span>
                </button>
                <button
                  type="button"
                  disabled={regeneratingKeys}
                  onClick={handleRegenerateKeys}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-semibold text-[10px] shadow-sm disabled:opacity-50"
                  title="Revoke and generate new security keys if URL was leaked"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${regeneratingKeys ? 'animate-spin' : ''}`} />
                  <span>{regeneratingKeys ? 'Regenerating...' : 'Regenerate Keys'}</span>
                </button>
              </div>
            </div>

            {/* CHANNEL 1: Frontend Website Form Submissions */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-indigo-600" />
                <h4 className="font-bold text-xs text-slate-800">Channel 1: Frontend Website Form Ingestion (HTML / JS / React)</h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Public Webhook Token (Client Token)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      placeholder="Generating token..."
                      value={websiteToken}
                      className="w-full border border-slate-200 rounded-xl pl-3 pr-20 py-2 bg-slate-100 text-slate-700 font-mono text-[11px] select-all font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(websiteToken, 'token_only')}
                      className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                    >
                      {copiedKey === 'token_only' ? 'Copied!' : 'Copy Token'}
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Rotatable client token. Passed as <code>?token=...</code></span>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Complete Public Webhook URL
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={websiteToken ? `http://localhost:8002/api/v1/webhooks/website/${activeTenant}?token=${websiteToken}` : `http://localhost:8002/api/v1/webhooks/website/${activeTenant}`}
                      className="w-full border border-slate-200 rounded-xl pl-3 pr-20 py-2 bg-slate-100 text-slate-600 font-mono text-[11px] select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`http://localhost:8002/api/v1/webhooks/website/${activeTenant}?token=${websiteToken}`, 'web_pub')}
                      className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                    >
                      {copiedKey === 'web_pub' ? 'Copied!' : 'Copy URL'}
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Ready-to-use form action URL for WordPress / React.</span>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Allowed Website Domains (CORS / Whitelist)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. https://mycompany.com, https://landingpage.in"
                    value={websiteAllowedDomains}
                    onChange={(e) => setWebsiteAllowedDomains(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-mono text-[11px] bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">Comma-separated. Restricts form submissions to your exact domain.</span>
                </div>
              </div>
            </div>

            {/* CHANNEL 2: Backend-to-Backend Server & Zapier Integration */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-emerald-600" />
                <h4 className="font-bold text-xs text-slate-800">Channel 2: Backend-to-Backend & Zapier Ingestion (HMAC Signature Protected)</h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Private Webhook Secret Key (HMAC-SHA256)
                  </label>
                  <div className="relative">
                    <input
                      type={showWebsiteSecret ? 'text' : 'password'}
                      readOnly
                      value={websiteSecret}
                      className="w-full border border-slate-200 rounded-xl pl-3 pr-24 py-2 bg-slate-100 text-slate-600 font-mono text-[11px] select-all"
                    />
                    <div className="absolute right-1.5 top-1 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowWebsiteSecret(!showWebsiteSecret)}
                        className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-[10px]"
                        title={showWebsiteSecret ? 'Hide' : 'Show'}
                      >
                        {showWebsiteSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(websiteSecret, 'web_sec')}
                        className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                      >
                        {copiedKey === 'web_sec' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Keep this confidential. Use for Zapier, Webflow Server, or custom backend signing.</span>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Direct Server Endpoint
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={`http://localhost:8002/api/v1/webhooks/website/${activeTenant}`}
                      className="w-full border border-slate-200 rounded-xl pl-3 pr-20 py-2 bg-slate-100 text-slate-600 font-mono text-[11px] select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`http://localhost:8002/api/v1/webhooks/website/${activeTenant}`, 'web_direct')}
                      className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[10px]"
                    >
                      {copiedKey === 'web_direct' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Pass header <code>X-Webhook-Signature: sha256=&lt;hmac&gt;</code> or <code>Authorization: Bearer {websiteSecret.slice(0, 8)}...</code></span>
                </div>
              </div>
            </div>

            {/* Ready-to-use Secure HTML Form Snippet (Collapsible) */}
            {showEmbedCode && (
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-800">Copy-Paste Protected Form Code (Includes Honeypot & Anti-Bot Traps)</span>
                  <button
                    type="button"
                    onClick={() => {
                      const code = `<!-- Anti-Spam Protected Lead Form -->
<form id="leadCaptureForm" onsubmit="submitProtectedLead(event)">
  <!-- Anti-Bot Honeypot (Invisible to humans, caught by bots) -->
  <input type="text" name="website_hp" style="display:none !important;" tabindex="-1" autocomplete="off" />
  
  <!-- Human typing speed trap -->
  <input type="hidden" name="_render_time" id="_form_render_time" value="" />
  
  <input type="text" name="full_name" placeholder="Full Name" required />
  <input type="tel" name="phone" placeholder="Mobile Number" required />
  <input type="email" name="email" placeholder="Email Address" />
  <textarea name="inquiry_message" placeholder="Requirement Details"></textarea>
  
  <button type="submit">Submit Inquiry</button>
</form>

<script>
  // Set form render timestamp
  document.getElementById('_form_render_time').value = Date.now();

  async function submitProtectedLead(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      full_name: form.full_name.value,
      phone: form.phone.value,
      email: form.email ? form.email.value : '',
      inquiry_message: form.inquiry_message ? form.inquiry_message.value : '',
      website_hp: form.website_hp.value,
      _render_time: form._render_time.value
    };

    try {
      const res = await fetch("http://localhost:8002/api/v1/webhooks/website/${activeTenant}?token=${websiteToken}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (res.ok) {
        alert("Inquiry submitted successfully!");
        form.reset();
      } else {
        alert("Submission failed: " + (result.detail || "Error"));
      }
    } catch (err) {
      alert("Network error. Please try again.");
    }
  }
</script>`;
                      copyToClipboard(code, 'embed_code');
                    }}
                    className="px-3 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold text-[10px]"
                  >
                    {copiedKey === 'embed_code' ? 'Copied Snippet!' : 'Copy Full HTML/JS Snippet'}
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 text-slate-200 rounded-2xl text-[10px] font-mono overflow-x-auto max-h-60 leading-relaxed select-all">
{`<!-- Anti-Spam Protected Lead Form -->
<form id="leadCaptureForm" onsubmit="submitProtectedLead(event)">
  <!-- Anti-Bot Honeypot (Invisible to humans, caught by bots) -->
  <input type="text" name="website_hp" style="display:none !important;" tabindex="-1" autocomplete="off" />
  
  <!-- Human typing speed trap -->
  <input type="hidden" name="_render_time" id="_form_render_time" value="" />
  
  <input type="text" name="full_name" placeholder="Full Name" required />
  <input type="tel" name="phone" placeholder="Mobile Number" required />
  <input type="email" name="email" placeholder="Email Address" />
  <textarea name="inquiry_message" placeholder="Requirement Details"></textarea>
  
  <button type="submit">Submit Inquiry</button>
</form>

<script>
  document.getElementById('_form_render_time').value = Date.now();

  async function submitProtectedLead(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      full_name: form.full_name.value,
      phone: form.phone.value,
      email: form.email ? form.email.value : '',
      inquiry_message: form.inquiry_message ? form.inquiry_message.value : '',
      website_hp: form.website_hp.value,
      _render_time: form._render_time.value
    };

    const res = await fetch("http://localhost:8002/api/v1/webhooks/website/${activeTenant}?token=${websiteToken}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (res.ok) {
      alert("Inquiry submitted successfully!");
      form.reset();
    }
  }
</script>`}
                </pre>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-lg shadow-indigo-600/25 transition-all transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{loading ? 'Saving Keys...' : 'Save API Credentials'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: Company Profile & GST & Bank Details */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveCompany} className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6 text-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Building2 className="h-5 w-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-800">Company Identity & Indian GST Details</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Company / Organization Name</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Business Model Type</label>
              <select
                value={companyType}
                onChange={(e) => setCompanyType(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800"
              >
                <option value="manufacturing">B2B Manufacturing & Machinery</option>
                <option value="trading">Wholesale & B2B Trading</option>
                <option value="services">IT & Professional Services</option>
                <option value="real_estate">Real Estate & Construction</option>
                <option value="agency">Agency / Consulting</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">GSTIN Number</label>
              <input
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                placeholder="24ABCDE1234F1Z5"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 uppercase"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">State & 2-Digit Code</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="24"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  className="w-16 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 text-center font-bold"
                />
                <input
                  type="text"
                  placeholder="Gujarat"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Official Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Official Contact Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </div>
          </div>

          {/* Bank Details for GST Bills */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <h4 className="font-bold text-xs text-slate-700">Bank Details & UPI (Printed on GST Invoices)</h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Bank Name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Account Number</label>
                <input
                  type="text"
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">IFSC Code</label>
                <input
                  type="text"
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono uppercase"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">UPI ID (For Instant QR / Payment)</label>
                <input
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="company@bank"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Profile & GST Settings'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: Dynamic Custom Fields */}
      {activeTab === 'custom_fields' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-4 text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="font-bold text-sm text-slate-800">Custom Lead Fields</h3>
              <p className="text-[11px] text-slate-400">Capture industry-specific requirements for your leads.</p>
            </div>
          </div>

          <div className="space-y-2">
            {customFields.map((cf, idx) => (
              <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800">{cf.field_label}</span>
                  <span className="text-[11px] text-slate-400 block font-mono">key: {cf.field_key} ({cf.field_type})</span>
                </div>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded border border-indigo-200">
                  Active Field
                </span>
              </div>
            ))}
          </div>

          {/* Add field form */}
          <form onSubmit={handleAddCustomField} className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Field Label (e.g. Machine Size)"
              value={newFieldLabel}
              onChange={(e) => {
                setNewFieldLabel(e.target.value);
                setNewFieldKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
              }}
              className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800"
            />
            <input
              type="text"
              placeholder="field_key"
              value={newFieldKey}
              onChange={(e) => setNewFieldKey(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-slate-600 font-mono"
            />
            <button
              type="submit"
              disabled={!newFieldLabel}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:opacity-40"
            >
              Add Field
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
