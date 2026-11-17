import React, { useEffect, useState } from 'react';
import { api, CurrentUser, API_BASE_URL } from '../services/api';
import { CommunicationSettingsTab } from '../components/CommunicationSettingsTab';
import { ConfirmModal } from '../components/ConfirmModal';
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
  const [activeTab, setActiveTab] = useState<'communications' | 'integrations' | 'profile' | 'custom_fields'>('communications');

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
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

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
    setRegeneratingKeys(true);
    setShowRegenConfirm(false);
    try {
      const res = await api.regenerateIntegrationKeys(activeTenant, 'website');
      if (res && res.webhook_token) {
        setWebsiteToken(res.webhook_token);
        setWebsiteSecret(res.secret_key);
        setSavedAlert('Security keys regenerated successfully! Make sure to update your website forms.');
        setTimeout(() => setSavedAlert(''), 4000);
      }
    } catch (err: any) {
      console.error(err);
      setSavedAlert('Failed to regenerate keys: ' + (err?.message || 'Network error'));
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
            onClick={() => setActiveTab('communications')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'communications'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            SMS, WhatsApp & Mail
          </button>
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

      {/* TAB 0: Communication Settings (SMS, WhatsApp, Mail) */}
      {activeTab === 'communications' && (
        <CommunicationSettingsTab tenantId={activeTenant} />
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

              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                <span className="text-[11px] font-bold text-slate-700">{indiamartEnabled ? 'Active' : 'Disabled'}</span>
                <input
                  type="checkbox"
                  checked={indiamartEnabled}
                  onChange={(e) => setIndiamartEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4 cursor-pointer"
                />
              </label>
            </div>

            {indiamartEnabled ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">IndiaMART CRM Key (GLUSR_CRM_KEY)</label>
                  <input
                    type="text"
                    placeholder="e.g. mRxxxxxxxxxxxxxxxxxxx="
                    value={indiamartCrmKey || indiamartKey}
                    onChange={(e) => {
                      setIndiamartCrmKey(e.target.value);
                      setIndiamartKey(e.target.value);
                    }}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Single secret key provided in IndiaMART Seller Portal under CRM Webhook settings.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700 text-xs">
                      Complete IndiaMART Push URL
                    </label>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      (indiamartCrmKey || indiamartKey)
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      {(indiamartCrmKey || indiamartKey) ? '✓ CRM Key Attached' : 'Plug & Play (Direct URL)'}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={`${API_BASE_URL}/webhooks/indiamart/${activeTenant}${indiamartCrmKey || indiamartKey ? `?crm_key=${indiamartCrmKey || indiamartKey}` : ''}`}
                      className="w-full border border-indigo-200 rounded-xl pl-3 pr-24 py-2 bg-indigo-50/40 text-indigo-950 font-mono text-[11px] select-all font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${API_BASE_URL}/webhooks/indiamart/${activeTenant}${indiamartCrmKey || indiamartKey ? `?crm_key=${indiamartCrmKey || indiamartKey}` : ''}`, 'im')}
                      className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] shadow-xs cursor-pointer"
                    >
                      {copiedKey === 'im' ? 'Copied!' : 'Copy Full URL'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {(indiamartCrmKey || indiamartKey)
                      ? '✓ Is URL ko IndiaMART Seller Portal (Lead Manager → CRM Integration) me paste karein. CRM Key URL aur request body dono me verify hogi.'
                      : 'ℹ️ IndiaMART ko URL me kisi alag token ki zaroorat nahi hoti. Is URL ko copy karke IndiaMART Seller Portal me paste karein. Agar aap security ke liye upar Secret Key enter karenge to URL me automatically key jud jayegi.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 italic bg-slate-50/60 p-3 rounded-xl border border-dashed border-slate-200">
                Integration is currently disabled. Toggle "Active" above if you receive buyer inquiries from IndiaMART.
              </div>
            )}
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

              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                <span className="text-[11px] font-bold text-slate-700">{facebookEnabled ? 'Active' : 'Disabled'}</span>
                <input
                  type="checkbox"
                  checked={facebookEnabled}
                  onChange={(e) => setFacebookEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4 cursor-pointer"
                />
              </label>
            </div>

            {facebookEnabled ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      1. Facebook Webhook Callback URL
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        readOnly
                        value={`${API_BASE_URL}/webhooks/facebook/${activeTenant}`}
                        className="w-full border border-blue-200 rounded-xl pl-3 pr-24 py-2 bg-blue-50/40 text-blue-950 font-mono text-[11px] select-all font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${API_BASE_URL}/webhooks/facebook/${activeTenant}`, 'fb')}
                        className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] shadow-xs cursor-pointer"
                      >
                        {copiedKey === 'fb' ? 'Copied!' : 'Copy URL'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Meta for Developers → Webhooks → Callback URL me paste karein.</p>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      2. Verify Token (Meta Handshake)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        readOnly
                        value={facebookSecret || websiteToken || activeTenant}
                        className="w-full border border-blue-200 rounded-xl pl-3 pr-24 py-2 bg-blue-50/40 text-blue-950 font-mono text-[11px] select-all font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(facebookSecret || websiteToken || activeTenant, 'fb_tok')}
                        className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold text-[10px] shadow-xs cursor-pointer"
                      >
                        {copiedKey === 'fb_tok' ? 'Copied!' : 'Copy Token'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Meta Webhook setup me "Verify Token" field me paste karein.</p>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Page Access Token (Meta Graph API)</label>
                  <input
                    type="password"
                    placeholder="EAABxxxxxxxxxxxxxxxxxxxxxxx"
                    value={facebookToken}
                    onChange={(e) => setFacebookToken(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono bg-slate-50 focus:bg-white text-slate-800"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Prospect lead details decrypt karne ke liye permanent Page Access Token enter karein.</p>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 italic bg-slate-50/60 p-3 rounded-xl border border-dashed border-slate-200">
                Integration is currently disabled. Toggle "Active" above if you run paid Lead Ads on Facebook or Instagram.
              </div>
            )}
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

              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                <span className="text-[11px] font-bold text-slate-700">{tradeindiaEnabled ? 'Active' : 'Disabled'}</span>
                <input
                  type="checkbox"
                  checked={tradeindiaEnabled}
                  onChange={(e) => setTradeindiaEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4 cursor-pointer"
                />
              </label>
            </div>

            {tradeindiaEnabled ? (
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
                  <p className="text-[10px] text-slate-400 mt-1">TradeIndia Seller Profile ID found on your tradeindia dashboard.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700 text-xs">
                      Complete TradeIndia Webhook URL
                    </label>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      tradeindiaKey
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      {tradeindiaKey ? '✓ API Key Attached' : 'Plug & Play (Direct URL)'}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={`${API_BASE_URL}/webhooks/tradeindia/${activeTenant}${tradeindiaKey ? `?key=${tradeindiaKey}` : ''}`}
                      className="w-full border border-amber-200 rounded-xl pl-3 pr-24 py-2 bg-amber-50/40 text-amber-950 font-mono text-[11px] select-all font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${API_BASE_URL}/webhooks/tradeindia/${activeTenant}${tradeindiaKey ? `?key=${tradeindiaKey}` : ''}`, 'ti')}
                      className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] shadow-xs cursor-pointer"
                    >
                      {copiedKey === 'ti' ? 'Copied!' : 'Copy Full URL'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {tradeindiaKey
                      ? '✓ TradeIndia Seller Portal → CRM Inquiries Webhook setting me ye URL paste karein.'
                      : 'ℹ️ TradeIndia Webhook URL direct copy-paste kar sakte hain. Agar aapne upar API Key bhari hai to wo URL me automatically jud jayegi.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 italic bg-slate-50/60 p-3 rounded-xl border border-dashed border-slate-200">
                Integration is currently disabled. Toggle "Active" above if you have a TradeIndia seller account.
              </div>
            )}
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

              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                <span className="text-[11px] font-bold text-slate-700">{justdialEnabled ? 'Active' : 'Disabled'}</span>
                <input
                  type="checkbox"
                  checked={justdialEnabled}
                  onChange={(e) => setJustdialEnabled(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 h-4 w-4 cursor-pointer"
                />
              </label>
            </div>

            {justdialEnabled ? (
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
                  <p className="text-[10px] text-slate-400 mt-1">Lead API authentication key issued by Justdial account executive.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700 text-xs">
                      Complete Justdial Webhook URL
                    </label>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      justdialKey
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      {justdialKey ? '✓ API Key Attached' : 'Plug & Play (Direct URL)'}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={`${API_BASE_URL}/webhooks/justdial/${activeTenant}${justdialKey ? `?key=${justdialKey}` : ''}`}
                      className="w-full border border-orange-200 rounded-xl pl-3 pr-24 py-2 bg-orange-50/40 text-orange-950 font-mono text-[11px] select-all font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${API_BASE_URL}/webhooks/justdial/${activeTenant}${justdialKey ? `?key=${justdialKey}` : ''}`, 'jd')}
                      className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-[10px] shadow-xs cursor-pointer"
                    >
                      {copiedKey === 'jd' ? 'Copied!' : 'Copy Full URL'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {justdialKey
                      ? '✓ Justdial executive ya webhook config me ye poora URL provide karein.'
                      : 'ℹ️ Justdial Push URL direct use kiya ja sakta hai. Agar aapne API key set ki hai to URL me automatically append ho jayegi.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 italic bg-slate-50/60 p-3 rounded-xl border border-dashed border-slate-200">
                Integration is currently disabled. Toggle "Active" above if you receive leads from Justdial.
              </div>
            )}
          </div>

          {/* Section 5: Universal Website & Postman Lead Ingestion Webhook */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 font-extrabold flex items-center justify-center text-sm border border-emerald-200">
                  WEB
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-slate-900">Website, WordPress & Postman Webhook</h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Copy-Paste Ready
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Website forms (HTML, Elementor, CF7, React) ya Postman/cURL se leads capture karne ke liye universal endpoint.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                  <span className="text-[11px] font-bold text-slate-700">{websiteEnabled ? 'Active' : 'Disabled'}</span>
                  <input
                    type="checkbox"
                    checked={websiteEnabled}
                    onChange={(e) => setWebsiteEnabled(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-0 h-4 w-4 cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {websiteEnabled ? (
              <div className="space-y-4">
                {/* Full Webhook URL with Token Included */}
                <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-xs text-emerald-950 flex items-center gap-1.5">
                      <span>🔗</span>
                      <span>Complete Webhook URL (With Security Token Included)</span>
                    </label>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      Direct Ingestion URL
                    </span>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={`${API_BASE_URL}/webhooks/website/${activeTenant}?token=${websiteToken || activeTenant}`}
                      className="w-full border border-emerald-300 rounded-xl pl-3 pr-28 py-2.5 bg-white text-emerald-950 font-mono text-xs select-all font-bold shadow-2xs"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${API_BASE_URL}/webhooks/website/${activeTenant}?token=${websiteToken || activeTenant}`, 'web_pub')}
                      className="absolute right-1.5 top-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>{copiedKey === 'web_pub' ? 'Copied!' : 'Copy URL'}</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-emerald-800 font-medium">
                    👉 Is URL ko Postman me POST method par hit karein ya website contact form ke action me dalein. Token pehle se URL me juda hua hai.
                  </p>
                </div>

                {/* 1-Click Postman / cURL Command Snippet */}
                <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <span>⚡</span>
                      <span>1-Click Postman & cURL Test Command</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const cmd = `curl -X POST "${API_BASE_URL}/webhooks/website/${activeTenant}?token=${websiteToken || activeTenant}" -H "Content-Type: application/json" -d "{\\"name\\":\\"Rohit Sharma\\",\\"phone\\":\\"9876543210\\",\\"email\\":\\"rohit@example.com\\",\\"product\\":\\"Machinery Requirement\\",\\"city\\":\\"Delhi\\",\\"message\\":\\"Urgent quote needed\\"}"`;
                        copyToClipboard(cmd, 'curl_cmd');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-[10px] shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      <span>{copiedKey === 'curl_cmd' ? 'Copied Command!' : 'Copy cURL Command'}</span>
                    </button>
                  </div>

                  <pre className="text-[11px] font-mono text-indigo-200 bg-slate-950 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap select-all border border-slate-800">
{`curl -X POST "${API_BASE_URL}/webhooks/website/${activeTenant}?token=${websiteToken || activeTenant}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Rohit Sharma",
    "phone": "9876543210",
    "email": "rohit@example.com",
    "product": "Machinery Requirement",
    "city": "Delhi",
    "message": "Urgent quote needed"
  }'`}
                  </pre>
                </div>

                {/* JSON Body Keys Reference */}
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                  <span className="font-bold text-slate-800 block">Supported JSON Payload Fields:</span>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                    <span className="bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-md font-bold">name *</span>
                    <span className="bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-md font-bold">phone *</span>
                    <span className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">email</span>
                    <span className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">product</span>
                    <span className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">city</span>
                    <span className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">company</span>
                    <span className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">deal_value</span>
                    <span className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">message</span>
                  </div>
                  <p className="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-xl border border-amber-200 mt-2 font-medium">
                    📌 <strong>Note:</strong> Jab koi bhi lead new aayegi (website, indiamart ya kahi se bhi), wo automatically <strong>⚠️ Unassigned (Open Pool)</strong> me dikhegi taaki admin/manager use manually staff ko assign kar sake.
                  </p>
                </div>

                {/* Optional HTML Form Embed Code Accordion */}
                <div className="pt-1 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowEmbedCode(!showEmbedCode)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span>{showEmbedCode ? '▼ Hide HTML Form Code' : '▶ Show Ready-to-paste HTML Website Form Code'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={regeneratingKeys}
                    onClick={() => setShowRegenConfirm(true)}
                    className="text-[10px] text-rose-600 hover:text-rose-800 font-semibold cursor-pointer"
                  >
                    {regeneratingKeys ? 'Regenerating...' : 'Regenerate Token'}
                  </button>
                </div>

                {showEmbedCode && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-bold text-slate-700">HTML Form Code (With Honeypot Bot Shield):</span>
                      <button
                        type="button"
                        onClick={() => {
                          const html = `<form action="${API_BASE_URL}/webhooks/website/${activeTenant}?token=${websiteToken || activeTenant}" method="POST">
  <input type="text" name="name" placeholder="Full Name" required />
  <input type="tel" name="phone" placeholder="Phone Number" required />
  <input type="email" name="email" placeholder="Email Address" />
  <input type="text" name="product" placeholder="Product Inquired" />
  <textarea name="message" placeholder="Requirement Message"></textarea>
  <button type="submit">Submit Inquiry</button>
</form>`;
                          copyToClipboard(html, 'html_code');
                        }}
                        className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 text-[10px] font-bold hover:bg-slate-50 cursor-pointer"
                      >
                        {copiedKey === 'html_code' ? 'Copied HTML!' : 'Copy HTML'}
                      </button>
                    </div>
                    <pre className="text-[10px] font-mono text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200 overflow-x-auto select-all">
{`<form action="${API_BASE_URL}/webhooks/website/${activeTenant}?token=${websiteToken || activeTenant}" method="POST">
  <input type="text" name="name" placeholder="Full Name" required />
  <input type="tel" name="phone" placeholder="Phone Number" required />
  <input type="email" name="email" placeholder="Email Address" />
  <input type="text" name="product" placeholder="Product Inquired" />
  <textarea name="message" placeholder="Requirement Message"></textarea>
  <button type="submit">Submit Inquiry</button>
</form>`}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 italic bg-slate-50/60 p-3 rounded-xl border border-dashed border-slate-200">
                Website lead capture is currently disabled. Toggle "Active" above to enable webhooks.
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

      {/* Modern React Confirmation Modal for Key Regeneration */}
      <ConfirmModal
        isOpen={showRegenConfirm}
        title="Regenerate Webhook Security Keys?"
        message="Are you sure you want to regenerate Webhook Security Keys? Any existing website forms or external scripts using old tokens will immediately stop working until updated with the new token."
        confirmText="Yes, Regenerate Keys"
        cancelText="Cancel"
        variant="warning"
        isLoading={regeneratingKeys}
        onConfirm={handleRegenerateKeys}
        onCancel={() => setShowRegenConfirm(false)}
      />
    </div>
  );
};
