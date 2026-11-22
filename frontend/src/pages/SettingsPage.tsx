import React, { useCallback, useEffect, useState } from 'react';
import { api, apiMessage, can, CurrentUser, isApiError, API_BASE_URL } from '../services/api';
import { CommunicationSettingsTab } from '../components/CommunicationSettingsTab';
import { ConfirmModal } from '../components/ConfirmModal';
import { PasswordInput } from '../components/PasswordInput';
import { SecretInput } from '../components/SecretInput';
import { gstinProblem, normalizeGstin, stateCodeFromGstin } from '../utils/gst';
import { formatIndianDateTime } from '../utils/dateUtils';
import { AlertCircle, Building2, CheckCircle2, Copy, Eye, KeyRound, RefreshCw, Save, ShieldCheck, Trash2, X } from 'lucide-react';

interface SettingsPageProps {
  currentUser?: CurrentUser | null;
  tenantId?: string;
}

type Provider = 'indiamart' | 'facebook' | 'tradeindia' | 'justdial' | 'website';
const PROVIDERS: Provider[] = ['indiamart', 'facebook', 'tradeindia', 'justdial', 'website'];

interface ProviderState {
  is_enabled: boolean;
  account_id: string;
  api_key: string; // a mask ("••••••••abcd") for a stored value, or what the administrator just typed
  crm_key: string;
  secret_key: string;
  auto_sync: boolean;
  allowed_domains: string; // comma separated (website forms)
  webhook_path: string;
  verify_token: string;
  status: string;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
}

const emptyProvider = (): ProviderState => ({
  is_enabled: false,
  account_id: '',
  api_key: '',
  crm_key: '',
  secret_key: '',
  auto_sync: false,
  allowed_domains: '',
  webhook_path: '',
  verify_token: '',
  status: '',
  last_sync_at: null,
  last_sync_status: null,
});

const emptyIntegrations = (): Record<Provider, ProviderState> => ({
  indiamart: emptyProvider(),
  facebook: emptyProvider(),
  tradeindia: emptyProvider(),
  justdial: emptyProvider(),
  website: emptyProvider(),
});

const fromServer = (raw: any): Record<Provider, ProviderState> => {
  const out = emptyIntegrations();
  PROVIDERS.forEach((provider) => {
    const item = raw?.[provider];
    if (!item) return;
    out[provider] = {
      is_enabled: Boolean(item.is_enabled),
      account_id: item.account_id || '',
      api_key: item.api_key || '',
      crm_key: item.crm_key || '',
      secret_key: item.secret_key || '',
      auto_sync: Boolean(item.auto_sync),
      allowed_domains: Array.isArray(item.allowed_domains) ? item.allowed_domains.join(', ') : '',
      webhook_path: item.webhook_path || '',
      verify_token: item.verify_token || '',
      status: item.status || '',
      last_sync_at: item.last_sync_at || null,
      last_sync_status: item.last_sync_status || null,
    };
  });
  return out;
};

const inputClass = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

export const SettingsPage: React.FC<SettingsPageProps> = ({ currentUser, tenantId }) => {
  const allowed = can(currentUser, 'settings_manage') && currentUser?.role !== 'super_admin';
  const [activeTab, setActiveTab] = useState<'communications' | 'integrations' | 'profile' | 'custom_fields'>('integrations');

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [saving, setSaving] = useState(false);

  // ---- integrations ----
  const [integrations, setIntegrations] = useState<Record<Provider, ProviderState>>(emptyIntegrations);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [regenProvider, setRegenProvider] = useState<Provider | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showEmbedCode, setShowEmbedCode] = useState(false);
  // step-up authentication before a stored secret is displayed
  const [revealProvider, setRevealProvider] = useState<Provider | null>(null);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [revealed, setRevealed] = useState<{ title: string; values: Array<{ label: string; value: string }> } | null>(null);

  // ---- company profile (nothing is pre-filled with sample data) ----
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyType, setCompanyType] = useState('manufacturing');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [branch, setBranch] = useState('');
  const [upiId, setUpiId] = useState('');
  const [invoiceTerms, setInvoiceTerms] = useState('');
  const [states, setStates] = useState<Array<{ code: string; name: string }>>([]);

  // ---- custom fields ----
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [fieldToDelete, setFieldToDelete] = useState<any>(null);

  const flash = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    if (type === 'success') window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 5000);
  };

  const loadIntegrations = useCallback(async () => {
    const res = await api.getCompanyIntegrations();
    if (isApiError(res)) {
      flash('error', apiMessage(res, 'Integration settings could not be loaded.'));
      return;
    }
    setIntegrations(fromServer(res.integrations));
    setIntegrationsLoaded(true);
  }, []);

  const applyTenant = (t: any) => {
    setCompanyName(t.company_name || '');
    setCompanyType(t.company_type || 'manufacturing');
    setGstin(t.gstin || '');
    setPan(t.pan_number || '');
    setStateCode(t.state_code || '');
    setEmail(t.email || '');
    setPhone(t.phone || '');
    setAddress(t.address || '');
    setCity(t.city || '');
    setPincode(t.pincode || '');
    setBankName(t.bank_details?.bank_name || '');
    setAccountNo(t.bank_details?.account_number || '');
    setIfsc(t.bank_details?.ifsc_code || '');
    setBranch(t.bank_details?.branch_name || '');
    setUpiId(t.bank_details?.upi_id || '');
    setInvoiceTerms(t.default_invoice_terms || '');
    setProfileLoaded(true);
  };

  const loadCustomFields = useCallback(async () => {
    setCustomFields(await api.getCustomFields());
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    loadIntegrations();
    loadCustomFields();
    api.getTenant().then((t) => {
      if (!alive) return;
      if (isApiError(t)) flash('error', apiMessage(t, 'The company profile could not be loaded.'));
      else if (t) applyTenant(t);
    });
    api.getGstStates().then((res) => alive && setStates(res));
    return () => {
      alive = false;
    };
  }, [allowed, loadIntegrations, loadCustomFields]);

  const copyToClipboard = async (text: string, keyName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyName);
      window.setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      flash('error', 'Copy is not available in this browser. Select the text and copy it by hand.');
    }
  };

  const setProvider = (provider: Provider, patch: Partial<ProviderState>) =>
    setIntegrations((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));

  /** Full address a marketplace or website has to call. It contains this company's private token. */
  const webhookUrl = (provider: Provider): string => (integrations[provider].webhook_path ? `${API_BASE_URL}${integrations[provider].webhook_path}` : '');

  // ------------------------------------------------------------------------------------------ save
  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    // masked values are sent back unchanged: the server reads a mask as "keep the stored secret"
    const payload: Record<string, any> = {};
    PROVIDERS.forEach((provider) => {
      const cfg = integrations[provider];
      payload[provider] = { is_enabled: cfg.is_enabled, account_id: cfg.account_id.trim(), api_key: cfg.api_key, crm_key: cfg.crm_key };
      if (provider !== 'website') payload[provider].secret_key = cfg.secret_key; // the website signing secret is only ever generated by the server
      if (provider === 'indiamart') payload[provider].auto_sync = cfg.auto_sync;
      if (provider === 'website') {
        payload[provider].allowed_domains = cfg.allowed_domains
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean);
      }
    });
    const res = await api.updateCompanyIntegrations(undefined, payload);
    setSaving(false);
    if (isApiError(res)) {
      flash('error', apiMessage(res, 'The integration settings could not be saved.'));
      return;
    }
    if (res.integrations) setIntegrations(fromServer(res.integrations));
    flash('success', 'Integration settings saved. Credentials are stored encrypted.');
  };

  const handleRegenerate = async () => {
    const provider = regenProvider;
    if (!provider) return;
    setRegenerating(true);
    const res = await api.regenerateIntegrationKeys(undefined, provider);
    setRegenerating(false);
    setRegenProvider(null);
    if (isApiError(res)) {
      flash('error', apiMessage(res, 'The credentials could not be regenerated.'));
      return;
    }
    if (res.integrations) setIntegrations(fromServer(res.integrations));
    if (provider === 'website' && res.secret_key) {
      // the new signing secret is shown once, straight after it has been created
      setRevealed({ title: 'New website signing secret', values: [{ label: 'Signing secret (server-to-server)', value: res.secret_key }] });
    }
    flash('success', 'New credentials created. The old address stopped working: update it wherever it was configured.');
  };

  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revealProvider) return;
    setRevealBusy(true);
    setRevealError('');
    const res = await api.revealIntegrationSecrets(revealProvider, revealPassword);
    setRevealBusy(false);
    setRevealPassword('');
    if (isApiError(res)) {
      setRevealError(apiMessage(res, 'The secret could not be shown.'));
      return;
    }
    const labels: Record<string, string> = { api_key: 'API key / access token', crm_key: 'CRM key', secret_key: 'Secret' };
    const values = Object.keys(labels)
      .filter((key) => res[key])
      .map((key) => ({ label: labels[key], value: String(res[key]) }));
    setRevealProvider(null);
    setRevealed({ title: `Stored credentials: ${revealProvider}`, values: values.length ? values : [{ label: 'Nothing stored', value: '' }] });
  };

  // a revealed secret does not stay on screen
  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(null), 60_000);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  const handleSyncIndiamart = async () => {
    setSyncing(true);
    const res = await api.syncIndiamartNow();
    setSyncing(false);
    if (isApiError(res)) {
      flash('error', apiMessage(res, 'IndiaMART could not be synchronised.'));
      return;
    }
    flash('success', res.message || `IndiaMART sync finished: ${res.created} new, ${res.duplicates} already known.`);
    loadIntegrations();
  };

  // ------------------------------------------------------------------------------------- profile
  const gstinError = gstinProblem(gstin);
  const gstinState = !gstinError ? stateCodeFromGstin(gstin) : '';
  const effectiveState = gstinState || stateCode;
  const profileProblems: string[] = [];
  if (!companyName.trim()) profileProblems.push('Company name is required.');
  if (gstinError) profileProblems.push(gstinError);
  if (pan && !PAN_RE.test(pan)) profileProblems.push('PAN must look like ABCDE1234F.');
  if (pan && gstin && !gstinError && normalizeGstin(gstin).slice(2, 12) !== pan) profileProblems.push('PAN does not match the PAN inside the GSTIN.');
  if (pincode && !PIN_RE.test(pincode)) profileProblems.push('PIN code must be 6 digits.');
  if (ifsc && !IFSC_RE.test(ifsc)) profileProblems.push('IFSC code must look like HDFC0001234.');

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profileProblems.length > 0) return;
    setSaving(true);
    const res = await api.updateTenantProfile(undefined, {
      company_name: companyName.trim(),
      company_type: companyType,
      gstin: normalizeGstin(gstin),
      pan_number: pan || undefined,
      state_code: effectiveState || undefined,
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      city: city.trim(),
      pincode: pincode.trim(),
      default_invoice_terms: invoiceTerms,
      bank_details: {
        bank_name: bankName.trim(),
        account_number: accountNo.trim(),
        ifsc_code: ifsc.trim(),
        branch_name: branch.trim(),
        upi_id: upiId.trim(),
      },
    });
    setSaving(false);
    if (isApiError(res)) {
      flash('error', apiMessage(res, 'The company profile could not be saved.'));
      return;
    }
    if (res.tenant) applyTenant(res.tenant);
    flash('success', 'Company profile, GST and bank details saved.');
  };

  // -------------------------------------------------------------------------------- custom fields
  const handleAddCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldKey || !newFieldLabel.trim()) return;
    const res = await api.addCustomField({ field_key: newFieldKey, field_label: newFieldLabel.trim(), field_type: newFieldType });
    if (isApiError(res)) {
      flash('error', apiMessage(res, 'The field could not be added.'));
      return;
    }
    setNewFieldKey('');
    setNewFieldLabel('');
    loadCustomFields();
  };

  const handleDeleteCustomField = async () => {
    const id = fieldToDelete?._id || fieldToDelete?.id;
    setFieldToDelete(null);
    if (!id) return;
    const res = await api.deleteCustomField(id);
    if (isApiError(res)) {
      flash('error', apiMessage(res, 'The field could not be removed.'));
      return;
    }
    loadCustomFields();
  };

  // The server refuses these calls for anyone without the permission; this is only a friendlier message.
  if (!allowed) {
    return (
      <div className="py-24 text-center max-w-md mx-auto space-y-4">
        <div className="h-14 w-14 rounded-3xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto border border-slate-200 shadow-sm">
          <ShieldCheck className="h-7 w-7 text-slate-400" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-bold text-slate-900">Administrative Settings Restricted</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Company profile, GST configuration and lead API credentials can only be opened by people with the "Company Settings &
            Integrations" permission. Please contact your company administrator.
          </p>
        </div>
      </div>
    );
  }

  // ---- small pieces used by every provider card ----
  const toggle = (provider: Provider) => (
    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
      <span className="text-[11px] font-bold text-slate-700">{integrations[provider].is_enabled ? 'Active' : 'Disabled'}</span>
      <input
        type="checkbox"
        checked={integrations[provider].is_enabled}
        onChange={(e) => setProvider(provider, { is_enabled: e.target.checked })}
        className="rounded text-indigo-600 focus:ring-0 h-4 w-4 cursor-pointer"
      />
    </label>
  );

  const urlBox = (provider: Provider, label: string, hint: string) => {
    const url = webhookUrl(provider);
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="font-semibold text-slate-700">{label}</label>
          <button type="button" onClick={() => setRegenProvider(provider)} className="text-[10px] text-rose-600 hover:text-rose-800 font-semibold">
            Regenerate token
          </button>
        </div>
        <div className="relative">
          <input type="text" readOnly value={url || 'Save the settings to create the address'} className="w-full border border-indigo-200 rounded-xl pl-3 pr-24 py-2 bg-indigo-50/40 text-indigo-950 font-mono text-[11px] select-all font-semibold" />
          <button
            type="button"
            disabled={!url}
            onClick={() => copyToClipboard(url, `${provider}_url`)}
            className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] shadow-xs disabled:opacity-50"
          >
            {copiedKey === `${provider}_url` ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">{hint}</p>
        <p className="text-[10px] text-amber-700 mt-0.5">This address contains a private token. Anyone who has it can add leads to your account, so share it only with the provider.</p>
      </div>
    );
  };

  const revealButton = (provider: Provider) => (
    <button
      type="button"
      onClick={() => { setRevealError(''); setRevealPassword(''); setRevealProvider(provider); }}
      className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-indigo-700"
    >
      <Eye className="h-3 w-3" />
      <span>Show stored value</span>
    </button>
  );

  const disabledNote = (text: string) => (
    <div className="text-[11px] text-slate-400 italic bg-slate-50/60 p-3 rounded-xl border border-dashed border-slate-200">{text}</div>
  );

  const cardHeader = (provider: Provider, badge: string, badgeClass: string, title: string, subtitle: string) => (
    <div className="flex items-center justify-between pb-3 border-b border-slate-100 gap-3">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl font-extrabold flex items-center justify-center text-sm border ${badgeClass}`}>{badge}</div>
        <div>
          <h3 className="font-bold text-sm text-slate-900">{title}</h3>
          <p className="text-[11px] text-slate-400">{subtitle}</p>
        </div>
      </div>
      {toggle(provider)}
    </div>
  );

  const im = integrations.indiamart;
  const fb = integrations.facebook;
  const ti = integrations.tradeindia;
  const jd = integrations.justdial;
  const web = integrations.website;
  const websiteUrl = webhookUrl('website');
  const sampleCurl = `curl -X POST "${websiteUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Test Customer",
    "phone": "9820012345",
    "email": "test@example.com",
    "product": "Product enquiry",
    "city": "Delhi",
    "message": "Please send a quotation"
  }'`;
  const embedHtml = `<form id="lead-form">
  <input type="text" name="name" placeholder="Full Name" required />
  <input type="tel" name="phone" placeholder="Phone Number" required />
  <input type="email" name="email" placeholder="Email Address" />
  <input type="text" name="product" placeholder="Product / Service" />
  <textarea name="message" placeholder="Your requirement"></textarea>
  <!-- keep this field hidden and empty: it catches spam bots -->
  <input type="text" name="website_hp" tabindex="-1" autocomplete="off"
         style="position:absolute;left:-9999px" aria-hidden="true" />
  <button type="submit">Submit Inquiry</button>
  <p id="lead-form-status" role="status"></p>
</form>
<script>
(function () {
  var form = document.getElementById('lead-form');
  var status = document.getElementById('lead-form-status');
  var loadedAt = Date.now();
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(form).entries());
    data._render_time = loadedAt;
    fetch('${websiteUrl}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (res) {
      status.textContent = res.ok ? 'Thank you! We will contact you shortly.'
                                  : 'Sorry, something went wrong. Please call us.';
      if (res.ok) form.reset();
    }).catch(function () {
      status.textContent = 'Sorry, something went wrong. Please call us.';
    });
  });
})();
</script>`;

  const tabButton = (id: typeof activeTab, label: string) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-3 py-1.5 rounded-xl transition-all ${activeTab === id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Company & Marketplace Settings</h2>
          <p className="text-xs text-slate-500 mt-0.5">Lead sources, API credentials, GST profile and bank details. Every change here is written to the audit trail.</p>
        </div>

        <div className="flex items-center p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-bold">
          {tabButton('integrations', 'Marketplace APIs')}
          {tabButton('communications', 'SMS, WhatsApp & Mail')}
          {tabButton('profile', 'Profile & GST')}
          {tabButton('custom_fields', 'Custom Fields')}
        </div>
      </div>

      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2 shadow-sm ${
            notice.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          {notice.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" /> : <AlertCircle className="h-5 w-5 text-rose-500 flex-shrink-0" />}
          <span className="font-bold flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* TAB: Communication gateways */}
      {activeTab === 'communications' && <CommunicationSettingsTab tenantId={tenantId || currentUser?.tenant_id || ''} />}

      {/* TAB: Marketplace & inbound lead APIs */}
      {activeTab === 'integrations' && !integrationsLoaded && <div className="py-16 text-center text-xs text-slate-400">Loading integration settings…</div>}

      {activeTab === 'integrations' && integrationsLoaded && (
        <form onSubmit={handleSaveIntegrations} className="space-y-5 text-xs">
          {/* IndiaMART */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            {cardHeader('indiamart', 'IM', 'bg-red-50 text-red-600 border-red-200', 'IndiaMART Lead Manager', 'Buyer enquiries by Push API (instant) and/or Pull API (scheduled).')}
            {im.is_enabled ? (
              <div className="space-y-4">
                {urlBox(
                  'indiamart',
                  'Push API listener URL',
                  'Enter this address as the Push API / webhook URL in your IndiaMART Lead Manager CRM integration. IndiaMART needs an https address that answers within a few seconds.'
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-semibold text-slate-700">Pull API CRM key (optional)</label>
                      {revealButton('indiamart')}
                    </div>
                    <SecretInput value={im.crm_key} onChange={(v) => setProvider('indiamart', { crm_key: v })} placeholder="glusr_crm_key from IndiaMART" />
                    <p className="text-[10px] text-slate-400 mt-1">Only needed for the Pull API. It lets the CRM fetch enquiries itself as a back-up to the push.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                      <input type="checkbox" checked={im.auto_sync} onChange={(e) => setProvider('indiamart', { auto_sync: e.target.checked })} className="rounded h-4 w-4" />
                      <span>Fetch new enquiries automatically (Pull API)</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleSyncIndiamart}
                      disabled={syncing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                      <span>{syncing ? 'Fetching…' : 'Fetch now'}</span>
                    </button>
                    <p className="text-[10px] text-slate-400">
                      {im.last_sync_at ? `Last fetch: ${formatIndianDateTime(im.last_sync_at)}${im.last_sync_status ? ` - ${im.last_sync_status}` : ''}` : 'Not fetched yet.'} IndiaMART
                      allows one fetch every 5 minutes; save a new key before fetching.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              disabledNote('Disabled: IndiaMART calls to your listener address are refused. Switch it on if you receive buyer enquiries from IndiaMART.')
            )}
          </div>

          {/* Meta / Facebook */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            {cardHeader('facebook', 'FB', 'bg-blue-50 text-blue-600 border-blue-200', 'Meta / Facebook Lead Ads', 'Leads from Facebook and Instagram lead forms.')}
            {fb.is_enabled ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">1. Callback URL</label>
                    <div className="relative">
                      <input type="text" readOnly value={webhookUrl('facebook')} className="w-full border border-blue-200 rounded-xl pl-3 pr-24 py-2 bg-blue-50/40 text-blue-950 font-mono text-[11px] select-all font-semibold" />
                      <button type="button" onClick={() => copyToClipboard(webhookUrl('facebook'), 'fb_url')} className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px]">
                        {copiedKey === 'fb_url' ? 'Copied!' : 'Copy URL'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Meta for Developers → your app → Webhooks → Page → Callback URL.</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-semibold text-slate-700">2. Verify token</label>
                      <button type="button" onClick={() => setRegenProvider('facebook')} className="text-[10px] text-rose-600 hover:text-rose-800 font-semibold">
                        Regenerate
                      </button>
                    </div>
                    <div className="relative">
                      <input type="text" readOnly value={fb.verify_token} className="w-full border border-blue-200 rounded-xl pl-3 pr-24 py-2 bg-blue-50/40 text-blue-950 font-mono text-[11px] select-all font-semibold" />
                      <button type="button" onClick={() => copyToClipboard(fb.verify_token, 'fb_tok')} className="absolute right-1.5 top-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold text-[10px]">
                        {copiedKey === 'fb_tok' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Paste it in the "Verify token" box of the same Meta screen.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-semibold text-slate-700">3. App Secret</label>
                      {revealButton('facebook')}
                    </div>
                    <SecretInput value={fb.secret_key} onChange={(v) => setProvider('facebook', { secret_key: v })} placeholder="From Meta app → Settings → Basic" />
                    <p className="text-[10px] text-slate-400 mt-1">Used to check Meta's signature on every call. Calls without a valid signature are rejected.</p>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">4. Page Access Token</label>
                    <SecretInput value={fb.api_key} onChange={(v) => setProvider('facebook', { api_key: v })} placeholder="Long-lived page token with leads_retrieval" />
                    <p className="text-[10px] text-slate-400 mt-1">Used to read the lead's details from Meta after a notification arrives.</p>
                  </div>
                </div>
                {fb.status === 'Action Required' && (
                  <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                    Both the App Secret and the Page Access Token are needed before Meta leads can be received.
                  </p>
                )}
              </div>
            ) : (
              disabledNote('Disabled. Switch it on if you run lead ads on Facebook or Instagram.')
            )}
          </div>

          {/* TradeIndia */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            {cardHeader('tradeindia', 'TI', 'bg-amber-50 text-amber-600 border-amber-200', 'TradeIndia', 'Enquiries pushed from your TradeIndia account or a connector.')}
            {ti.is_enabled ? (
              <div className="space-y-4">
                {urlBox('tradeindia', 'Webhook URL', 'Give this address to TradeIndia (or your connector) as the URL that receives new enquiries by POST.')}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">TradeIndia user / profile ID (for your reference)</label>
                    <input type="text" maxLength={100} value={ti.account_id} onChange={(e) => setProvider('tradeindia', { account_id: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-semibold text-slate-700">TradeIndia API key (optional)</label>
                      {revealButton('tradeindia')}
                    </div>
                    <SecretInput value={ti.api_key} onChange={(v) => setProvider('tradeindia', { api_key: v })} />
                  </div>
                </div>
              </div>
            ) : (
              disabledNote('Disabled. Switch it on if you receive enquiries from TradeIndia.')
            )}
          </div>

          {/* Justdial */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            {cardHeader('justdial', 'JD', 'bg-orange-50 text-orange-600 border-orange-200', 'Justdial', 'Leads pushed from Justdial.')}
            {jd.is_enabled ? (
              <div className="space-y-4">
                {urlBox('justdial', 'Webhook URL', 'Give this address to your Justdial account manager as the lead push URL.')}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Registered mobile / account (for your reference)</label>
                    <input type="text" maxLength={100} value={jd.account_id} onChange={(e) => setProvider('justdial', { account_id: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-semibold text-slate-700">Justdial API key (optional)</label>
                      {revealButton('justdial')}
                    </div>
                    <SecretInput value={jd.api_key} onChange={(v) => setProvider('justdial', { api_key: v })} />
                  </div>
                </div>
              </div>
            ) : (
              disabledNote('Disabled. Switch it on if you receive leads from Justdial.')
            )}
          </div>

          {/* Website forms */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
            {cardHeader('website', 'WEB', 'bg-emerald-50 text-emerald-600 border-emerald-200', 'Website & Landing-Page Forms', 'Contact forms on your own website, WordPress, or any tool that can send a POST request.')}
            {web.is_enabled ? (
              <div className="space-y-4">
                {urlBox('website', 'Form endpoint', 'Send the form fields to this address by POST (JSON or a normal HTML form).')}

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Websites allowed to use this endpoint</label>
                  <input
                    type="text"
                    maxLength={1000}
                    placeholder="yourcompany.com, shop.yourcompany.com"
                    value={web.allowed_domains}
                    onChange={(e) => setProvider('website', { allowed_domains: e.target.value })}
                    className={inputClass}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Comma separated. Strongly recommended: forms on any other website are then refused, even if someone copies the address above.
                    Leave empty only while testing.
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">Server-to-server signing secret</span>
                    <div className="flex items-center gap-3">
                      {revealButton('website')}
                      <button type="button" onClick={() => setRegenProvider('website')} className="text-[10px] text-rose-600 hover:text-rose-800 font-semibold">
                        Regenerate
                      </button>
                    </div>
                  </div>
                  <code className="block p-2 rounded-lg bg-white border border-slate-200 font-mono text-[11px] text-slate-700">{web.secret_key || 'Not created yet'}</code>
                  <p className="text-[10px] text-slate-500">
                    For your own back-end only (never put it in a web page): send <span className="font-mono">Authorization: Bearer &lt;secret&gt;</span> or{' '}
                    <span className="font-mono">X-Webhook-Signature: sha256=&lt;HMAC of the body&gt;</span>. Signed calls skip the allowed-website check.
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <span className="font-bold text-slate-800 block">Fields the endpoint understands</span>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                    {['name', 'phone *', 'email *', 'company', 'city', 'state', 'gstin', 'product', 'message', 'submission_id'].map((field) => (
                      <span key={field} className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">{field}</span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">* a phone number or an e-mail address is required. New leads arrive unassigned, in the open pool.</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Test command (cURL / Postman)</span>
                    <button type="button" disabled={!websiteUrl} onClick={() => copyToClipboard(sampleCurl, 'curl_cmd')} className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-[10px] flex items-center gap-1 disabled:opacity-50">
                      <Copy className="h-3 w-3" />
                      <span>{copiedKey === 'curl_cmd' ? 'Copied!' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono text-indigo-200 bg-slate-950 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap border border-slate-800">{sampleCurl}</pre>
                  <p className="text-[10px] text-slate-400">With "allowed websites" filled in, a test from the command line needs the signing secret instead (see above).</p>
                </div>

                <button type="button" onClick={() => setShowEmbedCode(!showEmbedCode)} className="text-xs text-indigo-600 hover:text-indigo-800 font-bold">
                  {showEmbedCode ? '▼ Hide website form code' : '▶ Show ready-to-paste website form code'}
                </button>
                {showEmbedCode && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-bold text-slate-700">HTML form with spam-bot trap</span>
                      <button type="button" disabled={!websiteUrl} onClick={() => copyToClipboard(embedHtml, 'html_code')} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 text-[10px] font-bold hover:bg-slate-50 disabled:opacity-50">
                        {copiedKey === 'html_code' ? 'Copied!' : 'Copy HTML'}
                      </button>
                    </div>
                    <pre className="text-[10px] font-mono text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200 overflow-x-auto">{embedHtml}</pre>
                  </div>
                )}
              </div>
            ) : (
              disabledNote('Disabled: submissions to the form endpoint are refused. Switch it on to capture leads from your website.')
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-lg shadow-indigo-600/25 disabled:opacity-50">
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving…' : 'Save integration settings'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB: Company profile, GST and bank details */}
      {activeTab === 'profile' && !profileLoaded && <div className="py-16 text-center text-xs text-slate-400">Loading company profile…</div>}

      {activeTab === 'profile' && profileLoaded && (
        <form onSubmit={handleSaveCompany} className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6 text-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Building2 className="h-5 w-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-800">Company identity & GST details (printed on every bill)</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Company / organisation name *</label>
              <input type="text" required maxLength={200} value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Business type</label>
              <select value={companyType} onChange={(e) => setCompanyType(e.target.value)} className={`${inputClass} bg-white`}>
                <option value="manufacturing">B2B Manufacturing & Machinery</option>
                <option value="trading">Wholesale & B2B Trading</option>
                <option value="services">IT & Professional Services</option>
                <option value="real_estate">Real Estate & Construction</option>
                <option value="agency">Agency / Consulting</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">GSTIN</label>
              <input
                type="text"
                maxLength={15}
                value={gstin}
                onChange={(e) => {
                  const next = e.target.value.toUpperCase().replace(/\s/g, '');
                  setGstin(next);
                  // the PAN is characters 3-12 of a GSTIN
                  if (!gstinProblem(next) && next.length === 15) setPan(next.slice(2, 12));
                }}
                placeholder="15 characters"
                className={`${inputClass} font-mono uppercase ${gstinError ? 'border-rose-400' : ''}`}
              />
              {gstinError ? (
                <p className="text-[10px] text-rose-600 mt-1">{gstinError}</p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1">Needed before tax invoices can be issued. The check character is verified.</p>
              )}
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">State (place of business)</label>
              <select value={effectiveState} disabled={Boolean(gstinState)} onChange={(e) => setStateCode(e.target.value)} className={`${inputClass} bg-white disabled:bg-slate-100`}>
                <option value="">-- Select state --</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">{gstinState ? 'Taken from the GSTIN.' : 'Decides whether a bill carries CGST + SGST or IGST.'}</p>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">PAN</label>
              <input type="text" maxLength={10} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="ABCDE1234F" className={`${inputClass} font-mono uppercase`} />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Official e-mail</label>
              <input type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Official phone</label>
              <input type="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">City</label>
              <input type="text" maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-3">
                <label className="font-semibold text-slate-700 block mb-1">Registered address</label>
                <input type="text" maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">PIN code</label>
                <input type="text" inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} className={inputClass} />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-4">
            <h4 className="font-bold text-xs text-slate-700">Bank details & UPI (printed on tax invoices)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Bank name</label>
                <input type="text" maxLength={100} value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Branch</label>
                <input type="text" maxLength={100} value={branch} onChange={(e) => setBranch(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Account number</label>
                <input type="text" maxLength={20} autoComplete="off" value={accountNo} onChange={(e) => setAccountNo(e.target.value.replace(/\s/g, ''))} className={`${inputClass} font-mono`} />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">IFSC code</label>
                <input type="text" maxLength={11} value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="HDFC0001234" className={`${inputClass} font-mono uppercase`} />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">UPI ID</label>
                <input type="text" maxLength={320} value={upiId} onChange={(e) => setUpiId(e.target.value.trim())} placeholder="company@bank" className={inputClass} />
              </div>
            </div>
            <p className="text-[10px] text-amber-700">
              Customers pay into this account. Changes are recorded in the audit trail with who made them and from where - check the trail if
              these details ever change unexpectedly.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className="font-semibold text-slate-700 block mb-1">Default terms & conditions on bills</label>
            <textarea rows={4} maxLength={2000} value={invoiceTerms} onChange={(e) => setInvoiceTerms(e.target.value)} className={inputClass} />
          </div>

          {profileProblems.length > 0 && (
            <ul className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] list-disc pl-6 space-y-0.5">
              {profileProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving || profileProblems.length > 0} className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md disabled:opacity-50">
              {saving ? 'Saving…' : 'Save profile & GST settings'}
            </button>
          </div>
        </form>
      )}

      {/* TAB: custom fields */}
      {activeTab === 'custom_fields' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-4 text-xs">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-800">Custom lead fields</h3>
            <p className="text-[11px] text-slate-400">Extra details your business records for a lead. Saved for the whole company.</p>
          </div>

          <div className="space-y-2">
            {customFields.length === 0 && <p className="text-slate-400 italic">No custom fields yet.</p>}
            {customFields.map((cf) => (
              <div key={cf._id || cf.id || cf.field_key} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-bold text-slate-800 block truncate">{cf.field_label}</span>
                  <span className="text-[11px] text-slate-400 block font-mono truncate">key: {cf.field_key} ({cf.field_type})</span>
                </div>
                <button type="button" onClick={() => setFieldToDelete(cf)} aria-label={`Remove ${cf.field_label}`} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={handleAddCustomField} className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              type="text"
              maxLength={100}
              placeholder="Field label (e.g. Machine size)"
              value={newFieldLabel}
              onChange={(e) => {
                setNewFieldLabel(e.target.value);
                setNewFieldKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64));
              }}
              className={inputClass}
            />
            <input
              type="text"
              maxLength={64}
              placeholder="field_key"
              value={newFieldKey}
              onChange={(e) => setNewFieldKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className={`${inputClass} font-mono text-slate-600`}
            />
            <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value)} className={`${inputClass} bg-white`}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="boolean">Yes / No</option>
            </select>
            <button type="submit" disabled={!newFieldLabel.trim() || !newFieldKey} className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:opacity-40">
              Add field
            </button>
          </form>
        </div>
      )}

      {/* Confirm: new token / secret */}
      <ConfirmModal
        isOpen={Boolean(regenProvider)}
        title="Create new credentials?"
        message="The current address and token stop working immediately. Leads sent to the old address are refused until you enter the new one at the provider or on your website."
        confirmText="Yes, create new ones"
        cancelText="Cancel"
        variant="warning"
        isLoading={regenerating}
        onConfirm={handleRegenerate}
        onCancel={() => setRegenProvider(null)}
      />

      <ConfirmModal
        isOpen={Boolean(fieldToDelete)}
        title="Remove this field?"
        message={`"${fieldToDelete?.field_label || ''}" will no longer be offered on new leads. Values already saved on leads are kept.`}
        confirmText="Remove field"
        variant="danger"
        onConfirm={handleDeleteCustomField}
        onCancel={() => setFieldToDelete(null)}
      />

      {/* Step-up authentication before a stored secret is shown */}
      {revealProvider && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <form onSubmit={handleReveal} className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 space-y-4 text-slate-900">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Confirm it is you</h3>
                <p className="text-[11px] text-slate-500">Enter your password to display the stored credentials. This is recorded in the audit trail.</p>
              </div>
            </div>
            {revealError && (
              <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">{revealError}</div>
            )}
            <PasswordInput value={revealPassword} onChange={setRevealPassword} placeholder="Your password" autoComplete="current-password" autoFocus />
            <div className="flex justify-end gap-2 text-xs">
              <button type="button" onClick={() => { setRevealProvider(null); setRevealPassword(''); }} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold">
                Cancel
              </button>
              <button type="submit" disabled={revealBusy || !revealPassword} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black disabled:opacity-50">
                {revealBusy ? 'Checking…' : 'Show'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* A revealed secret: shown for one minute at most */}
      {revealed && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-slate-900 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm capitalize">{revealed.title}</h3>
              <button onClick={() => setRevealed(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            {revealed.values.map((item) => (
              <div key={item.label}>
                <span className="font-semibold text-slate-700 block mb-1">{item.label}</span>
                {item.value && (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 rounded-lg bg-slate-100 border border-slate-200 font-mono text-[11px] break-all select-all">{item.value}</code>
                    <button onClick={() => copyToClipboard(item.value, `reveal_${item.label}`)} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white font-bold text-[10px]">
                      {copiedKey === `reveal_${item.label}` ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <p className="text-[10px] text-slate-500">This box closes by itself after one minute. Do not paste these values into chats or e-mails.</p>
          </div>
        </div>
      )}
    </div>
  );
};
