import React, { useState, useEffect, useRef } from 'react';
import { api, CommunicationSettings, apiMessage, isApiError } from '../services/api';
import { safeHttpsUrl, WHATSAPP_HOSTS } from '../utils/links';
import { 
  Mail, 
  MessageSquare, 
  PhoneCall, 
  Save, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  Server, 
  Key, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  ExternalLink,
  Sparkles,
  RefreshCw,
  Bell
} from 'lucide-react';

interface CommunicationSettingsTabProps {
  tenantId: string;
}

export const CommunicationSettingsTab: React.FC<CommunicationSettingsTabProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusAlert, setStatusAlert] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Active channel sub-tab: 'email' | 'whatsapp' | 'sms'
  const [channelTab, setChannelTab] = useState<'email' | 'whatsapp' | 'sms'>('email');

  // Email Config State
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailMode, setEmailMode] = useState<'smtp' | 'api'>('smtp');
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpUseTls, setSmtpUseTls] = useState(true);
  const [emailFromName, setEmailFromName] = useState('LeadCRM');
  const [emailFromAddress, setEmailFromAddress] = useState('');
  const [emailApiProvider, setEmailApiProvider] = useState('resend');
  const [emailApiKey, setEmailApiKey] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);

  // WhatsApp Config State
  const [waEnabled, setWaEnabled] = useState(false);
  const [waProvider, setWaProvider] = useState<'cloud_api' | 'twilio' | 'custom_webhook'>('cloud_api');
  const [waPhoneId, setWaPhoneId] = useState('');
  const [waWabaId, setWaWabaId] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waTwilioSid, setWaTwilioSid] = useState('');
  const [waTwilioAuth, setWaTwilioAuth] = useState('');
  const [waFromPhone, setWaFromPhone] = useState('');
  const [waCustomUrl, setWaCustomUrl] = useState('');
  const [waTemplate, setWaTemplate] = useState('Hello {staff_name}, you have {pending_count} pending follow-up(s) waiting in LeadCRM today. Please review: {crm_url}');
  const [showWaToken, setShowWaToken] = useState(false);

  // SMS Config State
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsProvider, setSmsProvider] = useState('custom_http');
  const [smsApiKey, setSmsApiKey] = useState('');
  const [smsSenderId, setSmsSenderId] = useState('');
  const [smsRoute, setSmsRoute] = useState('dlt');
  const [smsCustomUrl, setSmsCustomUrl] = useState('');
  const [showSmsKey, setShowSmsKey] = useState(false);

  // Test message state
  const [testRecipient, setTestRecipient] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message?: string; error?: string; whatsapp_link?: string } | null>(null);

  // Stored secrets come back masked ("••••••••abcd"). Clicking into such a box empties it so a new value
  // can be typed; leaving it empty puts the mask back, which the server reads as "keep what is stored".
  const savedMasks = useRef<Record<string, string>>({});
  const secretHandlers = (key: string, value: string, setValue: (next: string) => void) => ({
    onFocus: () => {
      if (value.includes('••••')) {
        savedMasks.current[key] = value;
        setValue('');
      }
    },
    onBlur: () => {
      if (!value && savedMasks.current[key]) setValue(savedMasks.current[key]);
    },
    autoComplete: 'new-password',
    spellCheck: false,
  });

  // Load Settings from Server
  const loadSettings = async () => {
    setLoading(true);
    try {
      const data: CommunicationSettings = await api.getCommunicationSettings();
      if (isApiError(data)) {
        setStatusAlert({ type: 'error', text: apiMessage(data, 'Communication settings could not be loaded.') });
      } else if (data) {
        // Email
        if (data.email) {
          setEmailEnabled(data.email.is_enabled ?? false);
          setEmailMode(data.email.mode || 'smtp');
          setSmtpHost(data.email.smtp_host || 'smtp.gmail.com');
          setSmtpPort(data.email.smtp_port || 587);
          setSmtpUser(data.email.smtp_user || '');
          setSmtpPassword(data.email.smtp_password || '');
          setSmtpUseTls(data.email.smtp_use_tls ?? true);
          setEmailFromName(data.email.from_name || 'LeadCRM');
          setEmailFromAddress(data.email.from_email || '');
          setEmailApiProvider(data.email.api_provider || 'resend');
          setEmailApiKey(data.email.api_key || '');
        }
        // WhatsApp
        if (data.whatsapp) {
          setWaEnabled(data.whatsapp.is_enabled ?? false);
          setWaProvider((data.whatsapp.provider as any) || 'cloud_api');
          setWaPhoneId(data.whatsapp.phone_number_id || '');
          setWaWabaId(data.whatsapp.waba_id || '');
          setWaAccessToken(data.whatsapp.access_token || '');
          setWaTwilioSid(data.whatsapp.account_sid || '');
          setWaTwilioAuth(data.whatsapp.auth_token || '');
          setWaFromPhone(data.whatsapp.from_phone_number || '');
          setWaCustomUrl(data.whatsapp.custom_webhook_url || '');
          if (data.whatsapp.pending_followup_template) {
            setWaTemplate(data.whatsapp.pending_followup_template);
          }
        }
        // SMS
        if (data.sms) {
          setSmsEnabled(data.sms.is_enabled ?? false);
          setSmsProvider(data.sms.provider || 'custom_http');
          setSmsApiKey(data.sms.api_key || '');
          setSmsSenderId(data.sms.sender_id || '');
          setSmsRoute(data.sms.route || 'dlt');
          setSmsCustomUrl(data.sms.custom_url || '');
        }
      }
    } catch (err) {
      console.error('Failed to load communication settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) loadSettings();
  }, [tenantId]);

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusAlert(null);

    const payload = {
      email: {
        is_enabled: emailEnabled,
        mode: emailMode,
        smtp_host: smtpHost,
        smtp_port: Number(smtpPort),
        smtp_user: smtpUser,
        smtp_password: smtpPassword,
        smtp_use_tls: smtpUseTls,
        from_name: emailFromName,
        from_email: emailFromAddress,
        api_provider: emailApiProvider,
        api_key: emailApiKey
      },
      whatsapp: {
        is_enabled: waEnabled,
        provider: waProvider,
        phone_number_id: waPhoneId,
        waba_id: waWabaId,
        access_token: waAccessToken,
        account_sid: waTwilioSid,
        auth_token: waTwilioAuth,
        from_phone_number: waFromPhone,
        custom_webhook_url: waCustomUrl,
        pending_followup_template: waTemplate
      },
      sms: {
        is_enabled: smsEnabled,
        provider: smsProvider,
        api_key: smsApiKey,
        sender_id: smsSenderId,
        route: smsRoute,
        custom_url: smsCustomUrl
      }
    };

    try {
      const res = await api.updateCommunicationSettings(undefined, payload);
      if (res && res.status === 'success') {
        savedMasks.current = {};
        await loadSettings(); // shows the freshly masked values instead of what was typed
        setStatusAlert({ type: 'success', text: 'Communication settings saved. Credentials are stored encrypted.' });
      } else {
        setStatusAlert({ type: 'error', text: res?.detail || res?.message || 'Failed to save settings.' });
      }
    } catch (err: any) {
      setStatusAlert({ type: 'error', text: err?.message || 'Network error while saving settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestChannel = async (channel: 'email' | 'whatsapp' | 'sms') => {
    if (!testRecipient) {
      setTestResult({ status: 'error', error: `Please enter a test ${channel === 'email' ? 'email address' : 'phone number'}.` });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testCommunication(undefined, {
        channel,
        recipient: testRecipient.trim(),
        message: testMessage || undefined
      });
      if (isApiError(res)) {
        setTestResult({ status: 'error', error: apiMessage(res, 'The test message could not be sent.') });
      } else if (res.status === 'not_configured') {
        setTestResult({ status: 'error', error: res.message || 'This channel is not configured yet. Save its settings first.' });
      } else {
        setTestResult(res);
      }
    } catch (err: any) {
      setTestResult({ status: 'error', error: err?.message || 'Test request failed.' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center text-xs text-slate-500 space-y-2">
        <RefreshCw className="h-6 w-6 text-indigo-600 animate-spin mx-auto" />
        <p>Loading Communication API Configuration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Channel Switcher */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">Communication & Notification Gateways</h3>
          <p className="text-[11px] text-slate-500">
            Configure SMTP/API Email, WhatsApp Cloud API, and SMS gateways for staff alerts and client notifications.
          </p>
        </div>

        <div className="flex items-center p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => { setChannelTab('email'); setTestResult(null); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
              channelTab === 'email'
                ? 'bg-white text-indigo-700 shadow-xs font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            <span>Email (SMTP / API)</span>
            {emailEnabled && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          </button>
          <button
            type="button"
            onClick={() => { setChannelTab('whatsapp'); setTestResult(null); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
              channelTab === 'whatsapp'
                ? 'bg-white text-emerald-700 shadow-xs font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>WhatsApp Gateway</span>
            {waEnabled && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          </button>
          <button
            type="button"
            onClick={() => { setChannelTab('sms'); setTestResult(null); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
              channelTab === 'sms'
                ? 'bg-white text-blue-700 shadow-xs font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PhoneCall className="h-3.5 w-3.5" />
            <span>SMS Gateway</span>
            {smsEnabled && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          </button>
        </div>
      </div>

      {statusAlert && (
        <div className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2 ${
          statusAlert.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          {statusAlert.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          )}
          <span>{statusAlert.text}</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 1: EMAIL (SMTP / API) */}
      {/* ============================================================== */}
      {channelTab === 'email' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6 text-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold border border-indigo-100">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-black text-sm text-slate-900">Email Gateway (Welcome Mails & Temp Passwords)</h4>
                <p className="text-[11px] text-slate-400">
                  Used when Super Admin creates companies or Company Admin adds staff members with temporary passwords.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 select-none">
              <span>{emailEnabled ? 'Enabled' : 'Disabled'}</span>
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="h-5 w-5 text-indigo-600 rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Mode Selector */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-800 block">Dispatch Mode:</label>
            <div className="flex gap-3">
              <label className={`flex-1 p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                emailMode === 'smtp'
                  ? 'border-indigo-600 bg-indigo-50/40 text-indigo-950 font-bold shadow-xs'
                  : 'border-slate-200 hover:border-slate-300 text-slate-700'
              }`}>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="emailMode"
                    value="smtp"
                    checked={emailMode === 'smtp'}
                    onChange={() => setEmailMode('smtp')}
                    className="text-indigo-600"
                  />
                  <span>SMTP Server (Gmail, Hostinger, Outlook, Zoho, SES)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 pl-5">
                  Standard mail server credentials with TLS authentication.
                </p>
              </label>

              <label className={`flex-1 p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                emailMode === 'api'
                  ? 'border-indigo-600 bg-indigo-50/40 text-indigo-950 font-bold shadow-xs'
                  : 'border-slate-200 hover:border-slate-300 text-slate-700'
              }`}>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="emailMode"
                    value="api"
                    checked={emailMode === 'api'}
                    onChange={() => setEmailMode('api')}
                    className="text-indigo-600"
                  />
                  <span>Cloud Email API (Resend, SendGrid)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 pl-5">
                  High deliverability cloud REST API using API tokens.
                </p>
              </label>
            </div>
          </div>

          {/* SMTP Fields */}
          {emailMode === 'smtp' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="font-bold text-slate-700 block mb-1">SMTP Server Host</label>
                <input
                  type="text"
                  placeholder="e.g. smtp.gmail.com or smtp.hostinger.com"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">SMTP Port</label>
                <input
                  type="number"
                  placeholder="587 (TLS) or 465 (SSL)"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">SMTP Username / Email</label>
                <input
                  type="text"
                  placeholder="e.g. sales@yourcompany.com"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">SMTP App Password</label>
                <div className="relative">
                  <input
                    type={showSmtpPass ? 'text' : 'password'}
                    placeholder="Enter password or app password"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                    {...secretHandlers('smtp_password', smtpPassword, setSmtpPassword)}
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSmtpPass(!showSmtpPass)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showSmtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Sender Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Your Company CRM"
                  value={emailFromName}
                  onChange={(e) => setEmailFromName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">From Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. no-reply@yourcompany.com"
                  value={emailFromAddress}
                  onChange={(e) => setEmailFromAddress(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={smtpUseTls}
                    onChange={(e) => setSmtpUseTls(e.target.checked)}
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <span>Use STARTTLS Encryption (Recommended for Port 587)</span>
                </label>
              </div>
            </div>
          )}

          {/* Cloud API Fields */}
          {emailMode === 'api' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Email API Provider</label>
                <select
                  value={emailApiProvider}
                  onChange={(e) => setEmailApiProvider(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="resend">Resend (resend.com)</option>
                  <option value="sendgrid">SendGrid (sendgrid.com)</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">API Key / Bearer Token</label>
                <input
                  type="text"
                  placeholder="re_12345... or SG.12345..."
                  value={emailApiKey}
                  onChange={(e) => setEmailApiKey(e.target.value)}
                  {...secretHandlers('email_api_key', emailApiKey, setEmailApiKey)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">From Name</label>
                <input
                  type="text"
                  placeholder="e.g. Apex CRM"
                  value={emailFromName}
                  onChange={(e) => setEmailFromName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Verified Sender Email</label>
                <input
                  type="email"
                  placeholder="e.g. onboard@yourdomain.com"
                  value={emailFromAddress}
                  onChange={(e) => setEmailFromAddress(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900"
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                type="email"
                placeholder="Test email address..."
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 w-56"
              />
              <button
                type="button"
                onClick={() => handleTestChannel('email')}
                disabled={testing || !testRecipient}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{testing ? 'Testing...' : 'Test Send Email'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving...' : 'Save Email Settings'}</span>
            </button>
          </div>

          {testResult && (
            <div className={`p-3 rounded-xl border text-xs ${
              testResult.status === 'success' || testResult.status === 'simulated'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <span className="font-bold block">Test Dispatch Outcome:</span>
              <p>{testResult.message || testResult.error || (testResult.status === 'success' ? 'Sent.' : 'Not sent.')}</p>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: WHATSAPP (META CLOUD API / TWILIO / WEBHOOK) */}
      {/* ============================================================== */}
      {channelTab === 'whatsapp' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6 text-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold border border-emerald-100">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-black text-sm text-slate-900">WhatsApp Gateway (Follow-up Alerts to Staff)</h4>
                <p className="text-[11px] text-slate-400">
                  Sends automated WhatsApp notifications to staff members with pending follow-ups count and details.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 select-none">
              <span>{waEnabled ? 'Enabled' : 'Disabled'}</span>
              <input
                type="checkbox"
                checked={waEnabled}
                onChange={(e) => setWaEnabled(e.target.checked)}
                className="h-5 w-5 text-emerald-600 rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Provider Selection */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-800 block">WhatsApp Provider:</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { id: 'cloud_api', label: 'Meta WhatsApp Cloud API', desc: 'Direct from Meta Developers (Official, Free tier 1k/month)' },
                { id: 'twilio', label: 'Twilio for WhatsApp', desc: 'Enterprise Twilio Sandbox or Dedicated Sender' },
                { id: 'custom_webhook', label: 'Custom HTTP Webhook', desc: 'Forward payload to your custom bot / WhatsApp instance' },
              ].map((p) => (
                <label
                  key={p.id}
                  className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                    waProvider === p.id
                      ? 'border-emerald-600 bg-emerald-50/40 text-emerald-950 font-bold shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="waProvider"
                      value={p.id}
                      checked={waProvider === p.id}
                      onChange={() => setWaProvider(p.id as any)}
                      className="text-emerald-600"
                    />
                    <span>{p.label}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 pl-5">{p.desc}</p>
                </label>
              ))}
            </div>
          </div>

          {/* Meta Cloud API Fields */}
          {waProvider === 'cloud_api' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Phone Number ID</label>
                <input
                  type="text"
                  placeholder="e.g. 104829104829104"
                  value={waPhoneId}
                  onChange={(e) => setWaPhoneId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">WhatsApp Business Account ID (WABA ID)</label>
                <input
                  type="text"
                  placeholder="e.g. 29384729384729"
                  value={waWabaId}
                  onChange={(e) => setWaWabaId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="font-bold text-slate-700 block mb-1">Permanent Access Token (System User Token)</label>
                <div className="relative">
                  <input
                    type={showWaToken ? 'text' : 'password'}
                    placeholder="EAAGm... (Permanent token from Meta Business Manager)"
                    value={waAccessToken}
                    onChange={(e) => setWaAccessToken(e.target.value)}
                    {...secretHandlers('wa_access_token', waAccessToken, setWaAccessToken)}
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowWaToken(!showWaToken)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showWaToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Twilio Fields */}
          {waProvider === 'twilio' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Twilio Account SID</label>
                <input
                  type="text"
                  placeholder="AC..."
                  value={waTwilioSid}
                  onChange={(e) => setWaTwilioSid(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Twilio Auth Token</label>
                <input
                  type="password"
                  placeholder="Auth Token"
                  value={waTwilioAuth}
                  onChange={(e) => setWaTwilioAuth(e.target.value)}
                  {...secretHandlers('wa_auth_token', waTwilioAuth, setWaTwilioAuth)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">From WhatsApp Number</label>
                <input
                  type="text"
                  placeholder="e.g. +14155238886"
                  value={waFromPhone}
                  onChange={(e) => setWaFromPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Custom Webhook Fields */}
          {waProvider === 'custom_webhook' && (
            <div className="pt-2">
              <label className="font-bold text-slate-700 block mb-1">Custom Webhook URL</label>
              <input
                type="url"
                placeholder="https://your-bot.com/api/send-whatsapp"
                value={waCustomUrl}
                onChange={(e) => setWaCustomUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* Follow-up WhatsApp Template Preview */}
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-2">
            <span className="font-bold text-xs text-emerald-950 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              <span>Staff Follow-up Reminder Message Format:</span>
            </span>
            <div className="bg-white p-3 rounded-xl border border-emerald-200 text-[11px] font-sans text-slate-800 leading-relaxed space-y-1">
              <p>🔔 <strong>LeadCRM Follow-up Reminder</strong></p>
              <p>Namaste <strong>Rajesh Sharma</strong> Ji! 👋</p>
              <p>Aapke paas aaj <strong>4 pending follow-up(s)</strong> hain jin par customer ko connect karna hai:</p>
              <p className="font-mono text-[10px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                1. Suresh Patel (9876543210) - PHONE CALL<br />
                2. Anita Mehra (9825012345) - WHATSAPP<br />
                ... aur 2 aur leads
              </p>
              <p className="text-emerald-700 font-semibold">👉 CRM Dashboard check karein: https://leadcrm.travistas.in</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                type="tel"
                placeholder="Test phone (e.g. 9876543210)..."
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 w-56 font-mono"
              />
              <button
                type="button"
                onClick={() => handleTestChannel('whatsapp')}
                disabled={testing || !testRecipient}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{testing ? 'Sending...' : 'Test WhatsApp'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving...' : 'Save WhatsApp Settings'}</span>
            </button>
          </div>

          {testResult && (
            <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
              testResult.status === 'success' || testResult.status === 'simulated'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <span className="font-bold block">Test Message Outcome:</span>
              <p>{testResult.message || testResult.error || (testResult.status === 'success' ? 'Sent.' : 'Not sent.')}</p>
              {safeHttpsUrl(testResult.whatsapp_link, WHATSAPP_HOSTS) && (
                <div className="pt-1">
                  <a
                    href={safeHttpsUrl(testResult.whatsapp_link, WHATSAPP_HOSTS) || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-xs"
                  >
                    <span>Click to Open Test Message in WhatsApp Web / App &rarr;</span>
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: SMS GATEWAY */}
      {/* ============================================================== */}
      {channelTab === 'sms' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6 text-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold border border-blue-100">
                <PhoneCall className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-black text-sm text-slate-900">SMS Gateway Configuration</h4>
                <p className="text-[11px] text-slate-400">
                  Connect Fast2SMS, MSG91, Twilio, or any custom Indian DLT approved SMS gateway.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 select-none">
              <span>{smsEnabled ? 'Enabled' : 'Disabled'}</span>
              <input
                type="checkbox"
                checked={smsEnabled}
                onChange={(e) => setSmsEnabled(e.target.checked)}
                className="h-5 w-5 text-blue-600 rounded cursor-pointer"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="font-bold text-slate-700 block mb-1">SMS Provider</label>
              <select
                value={smsProvider}
                onChange={(e) => setSmsProvider(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="custom_http">Custom HTTP Gateway / Any Vendor</option>
                <option value="fast2sms">Fast2SMS India</option>
                <option value="msg91">MSG91</option>
                <option value="twilio">Twilio Programmable SMS</option>
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">API Key / Auth Token</label>
              <div className="relative">
                <input
                  type={showSmsKey ? 'text' : 'password'}
                  placeholder="Enter SMS vendor API Key"
                  value={smsApiKey}
                  onChange={(e) => setSmsApiKey(e.target.value)}
                  {...secretHandlers('sms_api_key', smsApiKey, setSmsApiKey)}
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowSmsKey(!showSmsKey)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showSmsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">DLT Sender ID (6 Characters)</label>
              <input
                type="text"
                placeholder="e.g. APEXMC"
                value={smsSenderId}
                onChange={(e) => setSmsSenderId(e.target.value)}
                maxLength={6}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono uppercase text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Route / Channel</label>
              <input
                type="text"
                placeholder="e.g. dlt, q, or transactional"
                value={smsRoute}
                onChange={(e) => setSmsRoute(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="font-bold text-slate-700 block mb-1">Custom HTTP URL Endpoint</label>
              <input
                type="text"
                placeholder="https://api.sms.com/send?apikey={API_KEY}&to={TO}&msg={MESSAGE}"
                value={smsCustomUrl}
                onChange={(e) => setSmsCustomUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Supported dynamic tags: <code className="bg-slate-100 px-1 py-0.5 rounded">{'{API_KEY}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded">{'{TO}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded">{'{MESSAGE}'}</code>.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                type="tel"
                placeholder="Test phone (e.g. 9876543210)..."
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 w-56 font-mono"
              />
              <button
                type="button"
                onClick={() => handleTestChannel('sms')}
                disabled={testing || !testRecipient}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{testing ? 'Sending...' : 'Test Send SMS'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs shadow-md shadow-blue-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving...' : 'Save SMS Settings'}</span>
            </button>
          </div>

          {testResult && (
            <div className={`p-3 rounded-xl border text-xs ${
              testResult.status === 'success' || testResult.status === 'simulated'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <span className="font-bold block">Test SMS Outcome:</span>
              <p>{testResult.message || testResult.error || (testResult.status === 'success' ? 'Sent.' : 'Not sent.')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
