import React, { useState, useEffect, useCallback } from 'react';
import { api, apiMessage, CurrentUser, isApiError, UserProfile } from '../services/api';
import { PasswordChecklist, PasswordInput } from './PasswordInput';
import { TwoFactorSetup } from './TwoFactorSetup';
import { passwordIsAcceptable } from '../utils/password';
import { formatIndianDateTime } from '../utils/dateUtils';
import { 
  X, 
  User, 
  Mail, 
  Phone, 
  MessageSquare, 
  Building2, 
  ShieldCheck, 
  Lock, 
  KeyRound, 
  CheckCircle2, 
  AlertCircle, 
  Bell, 
  Eye, 
  EyeOff, 
  Save, 
  Briefcase, 
  Layers,
  LogOut,
  MonitorSmartphone,
  ShieldOff
} from 'lucide-react';

interface UserProfileModalProps {
  currentUser: CurrentUser;
  onClose: () => void;
  /** Optional: the session itself is refreshed by the API client. */
  onUserUpdated?: (updated: CurrentUser) => void;
  onLogout?: () => void;
  initialTab?: 'profile' | 'security' | 'notifications';
}

interface ActiveSession {
  id: string;
  ip?: string | null;
  user_agent?: string | null;
  created_at: string;
  expires_at: string;
  current: boolean;
}

/** Short, readable label for a browser's user-agent string. */
const describeDevice = (userAgent?: string | null): string => {
  const ua = userAgent || '';
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const system = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
  return `${browser} on ${system}`;
};

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  currentUser,
  onClose,
  onUserUpdated,
  onLogout,
  initialTab = 'profile'
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'notifications'>(initialTab);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Profile Form State
  const [fullName, setFullName] = useState(currentUser.full_name || '');
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [whatsappNumber, setWhatsappNumber] = useState(currentUser.whatsapp_number || currentUser.phone || '');
  const [designation, setDesignation] = useState(currentUser.designation || '');
  const [department, setDepartment] = useState(currentUser.department || '');
  const [bio, setBio] = useState('');
  const [receiveWhatsapp, setReceiveWhatsapp] = useState(true);
  const [receiveEmail, setReceiveEmail] = useState(true);

  // Security Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Two-factor sign-in and signed-in devices
  const [mfaEnabled, setMfaEnabled] = useState(Boolean(currentUser.mfa_enabled));
  const [mfaMode, setMfaMode] = useState<'idle' | 'setup' | 'disable'>('idle');
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const isSuperAdmin = currentUser.role === 'super_admin';

  const loadSessions = useCallback(async () => {
    setSessions(await api.getSessions());
  }, []);

  useEffect(() => {
    setMfaEnabled(Boolean(currentUser.mfa_enabled));
  }, [currentUser.mfa_enabled]);

  useEffect(() => {
    if (activeTab === 'security') loadSessions();
  }, [activeTab, loadSessions]);

  // Masters Dropdown States
  const [departmentsList, setDepartmentsList] = useState<string[]>([
    "Sales & Business Development",
    "Presales & Estimation",
    "Accounts & Billing",
    "Technical Support",
    "Management"
  ]);
  const [designationsList, setDesignationsList] = useState<string[]>([
    "Sales Executive",
    "Senior BDA",
    "Team Leader",
    "Sales Manager",
    "General Manager"
  ]);

  // Load my profile (the server identifies the person from the session, not from an id sent by the browser)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getUserProfile().then((res) => {
      if (!alive) return;
      if (!isApiError(res) && res && res.id) {
        setProfile(res);
        setFullName(res.full_name || '');
        setPhone(res.phone || '');
        setWhatsappNumber(res.whatsapp_number || res.phone || '');
        setDesignation(res.designation || '');
        setDepartment(res.department || '');
        setBio(res.bio || '');
        setReceiveWhatsapp(res.receive_whatsapp_notifications ?? true);
        setReceiveEmail(res.receive_email_notifications ?? true);
        setMfaEnabled(Boolean(res.mfa_enabled));
      }
      setLoading(false);
    });

    // Designation & department lists come from the company masters (the platform owner has no company)
    if (!isSuperAdmin) {
      api.getCompanyMasters().then((masters) => {
        if (!alive || !masters || isApiError(masters)) return;
        if (Array.isArray(masters.departments) && masters.departments.length > 0) setDepartmentsList(masters.departments);
        if (Array.isArray(masters.designations) && masters.designations.length > 0) setDesignationsList(masters.designations);
      });
    }
    return () => {
      alive = false;
    };
  }, [currentUser.id, isSuperAdmin]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setAlertMsg(null);

    const res = await api.updateUserProfile(undefined, {
      full_name: fullName,
      phone: phone,
      whatsapp_number: whatsappNumber,
      designation: designation,
      department: department,
      bio: bio,
      receive_whatsapp_notifications: receiveWhatsapp,
      receive_email_notifications: receiveEmail
    });
    setSaving(false);

    if (isApiError(res)) {
      setAlertMsg({ type: 'error', text: apiMessage(res, 'Failed to update profile.') });
      return;
    }
    setAlertMsg({ type: 'success', text: 'Profile updated successfully!' });
    if (onUserUpdated && res.user) onUserUpdated({ ...currentUser, ...res.user });
  };

  const passwordReady =
    currentPassword.length > 0 &&
    passwordIsAcceptable(newPassword, currentUser.email, currentUser.full_name) &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);
    if (!passwordReady) return;

    setChangingPassword(true);
    const res = await api.changePassword({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword
    });
    setChangingPassword(false);

    if (isApiError(res)) {
      setAlertMsg({ type: 'error', text: apiMessage(res, 'Failed to change password.') });
      return;
    }
    setAlertMsg({ type: 'success', text: 'Password changed. Every other device has been signed out.' });
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    loadSessions();
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);
    setMfaBusy(true);
    const res = await api.mfaDisable(mfaPassword, mfaCode);
    setMfaBusy(false);
    if (isApiError(res)) {
      setAlertMsg({ type: 'error', text: apiMessage(res, 'Two-factor sign-in could not be turned off.') });
      return;
    }
    setMfaPassword('');
    setMfaCode('');
    setMfaMode('idle');
    setMfaEnabled(false);
    setAlertMsg({ type: 'success', text: 'Two-factor sign-in has been turned off.' });
    loadSessions();
  };

  const handleRevokeSession = async (sessionId: string) => {
    const res = await api.revokeSession(sessionId);
    if (isApiError(res)) {
      setAlertMsg({ type: 'error', text: apiMessage(res, 'That device could not be signed out.') });
      return;
    }
    loadSessions();
  };

  const handleSignOutEverywhere = async () => {
    // this ends the current session too, so the application returns to the sign-in screen
    await api.logoutEverywhere();
    onLogout?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto" style={{ colorScheme: 'light' }}>
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden text-slate-900 flex flex-col max-h-[92vh]">
        {/* Header Profile Bar */}
        <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center space-x-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-cyan-400 text-white flex items-center justify-center font-black text-2xl shadow-xl shadow-indigo-500/25 border-2 border-white/20">
              {fullName?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black text-white tracking-tight truncate">{fullName}</h3>
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  {currentUser.role.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 truncate">{currentUser.email}</p>
              <p className="text-[11px] text-indigo-300 mt-1 flex items-center gap-1.5 font-semibold">
                <Building2 className="h-3.5 w-3.5" />
                <span>{profile?.company_name || (isSuperAdmin ? 'Platform Administration' : 'Company workspace')}</span>
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex space-x-2 mt-6 pt-4 border-t border-white/10 text-xs font-bold">
            <button
              onClick={() => { setActiveTab('profile'); setAlertMsg(null); }}
              className={`px-4 py-2 rounded-xl transition-all cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-white text-indigo-950 shadow-md font-black'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              👤 Personal Profile
            </button>
            <button
              onClick={() => { setActiveTab('security'); setAlertMsg(null); }}
              className={`px-4 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'security'
                  ? 'bg-white text-indigo-950 shadow-md font-black'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Password & Security</span>
            </button>
            <button
              onClick={() => { setActiveTab('notifications'); setAlertMsg(null); }}
              className={`px-4 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'notifications'
                  ? 'bg-white text-indigo-950 shadow-md font-black'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Alerts & WhatsApp</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {alertMsg && (
            <div className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
              alertMsg.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}>
              {alertMsg.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
              )}
              <span>{alertMsg.text}</span>
            </div>
          )}

          {/* TAB 1: PERSONAL PROFILE */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Corporate Email <span className="text-[10px] text-slate-400 font-normal">(Read-only)</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="email"
                      disabled
                      value={currentUser.email}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-100 border-2 border-slate-200 text-slate-500 text-xs font-semibold cursor-not-allowed"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Phone / Mobile Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="tel"
                      placeholder="e.g. 9876543210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    WhatsApp Number <span className="text-[10px] text-emerald-600 font-bold">(For Follow-up Alerts)</span>
                  </label>
                  <div className="relative">
                    <MessageSquare className="absolute left-3.5 top-3 h-4 w-4 text-emerald-600" />
                    <input
                      type="tel"
                      placeholder="e.g. 9876543210"
                      value={whatsappNumber}
                      onChange={(e) => setWhatsappNumber(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-emerald-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Designation <span className="text-[10px] text-indigo-600 font-bold">(From Masters)</span>
                  </label>
                  <div className="relative">
                    <Briefcase className="absolute left-3.5 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
                    <select
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                      style={{ colorScheme: 'light' }}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="">-- Select Designation --</option>
                      {designation && !designationsList.includes(designation) && (
                        <option value={designation}>{designation}</option>
                      )}
                      {designationsList.map((des, idx) => (
                        <option key={idx} value={des}>{des}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Department <span className="text-[10px] text-indigo-600 font-bold">(From Masters)</span>
                  </label>
                  <div className="relative">
                    <Layers className="absolute left-3.5 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      style={{ colorScheme: 'light' }}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="">-- Select Department --</option>
                      {department && !departmentsList.includes(department) && (
                        <option value={department}>{department}</option>
                      )}
                      {departmentsList.map((dep, idx) => (
                        <option key={idx} value={dep}>{dep}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Bio / Notes</label>
                <textarea
                  rows={2}
                  placeholder="Short note about your responsibilities or profile..."
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>{saving ? 'Saving...' : 'Save Profile Changes'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: PASSWORD, TWO-FACTOR SIGN-IN AND DEVICES */}
          {activeTab === 'security' && (
            <div className="space-y-6 max-w-lg mx-auto">
              {/* --- change password --- */}
              <form onSubmit={handleChangePassword} className="space-y-4">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-indigo-600" />
                  <span>Change password</span>
                </h4>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Current password</label>
                  <PasswordInput value={currentPassword} onChange={setCurrentPassword} placeholder="Enter current password" autoComplete="current-password" />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    New password <span className="text-rose-500">*</span>
                  </label>
                  <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="Choose a strong password" autoComplete="new-password" />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Confirm new password <span className="text-rose-500">*</span>
                  </label>
                  <PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="Type it again" autoComplete="new-password" />
                </div>

                {newPassword.length > 0 && (
                  <PasswordChecklist password={newPassword} confirm={confirmPassword} email={currentUser.email} fullName={currentUser.full_name} />
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={changingPassword || !passwordReady}
                    className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>{changingPassword ? 'Updating...' : 'Update Password'}</span>
                  </button>
                </div>
              </form>

              {/* --- two-factor sign-in --- */}
              <div className="pt-5 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-indigo-600" />
                    <span>Two-factor sign-in</span>
                  </h4>
                  <span
                    className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                      mfaEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {mfaEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>

                {mfaMode === 'idle' && !mfaEnabled && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200">
                    <p className="text-[11px] text-slate-600">
                      Adds a 6-digit code from your phone to every sign-in, so a stolen password alone is not enough.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setAlertMsg(null); setMfaMode('setup'); }}
                      className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs"
                    >
                      Turn on
                    </button>
                  </div>
                )}

                {mfaMode === 'setup' && (
                  <TwoFactorSetup
                    onCancel={() => setMfaMode('idle')}
                    onCompleted={() => {
                      setMfaMode('idle');
                      setMfaEnabled(true);
                      loadSessions();
                    }}
                  />
                )}

                {mfaMode === 'idle' && mfaEnabled && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-emerald-50/60 border border-emerald-200">
                    <p className="text-[11px] text-emerald-900">
                      Your account asks for a code from your authenticator app at every sign-in.
                      {isSuperAdmin ? ' Your role requires it, so it has to be set up again straight away if you turn it off.' : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setAlertMsg(null); setMfaMode('disable'); }}
                      className="shrink-0 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold text-xs flex items-center gap-1.5"
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                      <span>Turn off</span>
                    </button>
                  </div>
                )}

                {mfaMode === 'disable' && (
                  <form onSubmit={handleDisableMfa} className="space-y-3 p-3 rounded-2xl bg-rose-50/50 border border-rose-200">
                    <p className="text-[11px] text-rose-800 font-bold">Confirm it is you to turn two-factor sign-in off.</p>
                    <PasswordInput value={mfaPassword} onChange={setMfaPassword} placeholder="Your password" autoComplete="current-password" />
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      placeholder="6-digit code from the app"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-rose-400"
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => { setMfaMode('idle'); setMfaPassword(''); setMfaCode(''); }} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs bg-white">
                        Cancel
                      </button>
                      <button type="submit" disabled={mfaBusy || !mfaPassword || mfaCode.length !== 6} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs disabled:opacity-50">
                        {mfaBusy ? 'Checking…' : 'Turn off two-factor sign-in'}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* --- signed-in devices --- */}
              <div className="pt-5 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <MonitorSmartphone className="h-4 w-4 text-indigo-600" />
                    <span>Signed-in devices</span>
                  </h4>
                  <button
                    type="button"
                    onClick={handleSignOutEverywhere}
                    className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold text-[11px] flex items-center gap-1.5"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Sign out everywhere</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {sessions.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 text-[11px]">
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 block truncate">
                          {describeDevice(item.user_agent)}
                          {item.current && <span className="ml-2 text-[10px] font-black text-emerald-700">THIS DEVICE</span>}
                        </span>
                        <span className="text-slate-500 block truncate">
                          IP {item.ip || 'unknown'} · signed in {formatIndianDateTime(item.created_at)}
                        </span>
                      </div>
                      {!item.current && (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(item.id)}
                          className="shrink-0 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 font-bold"
                        >
                          Sign out
                        </button>
                      )}
                    </div>
                  ))}
                  {sessions.length === 0 && <p className="text-[11px] text-slate-400">No other active sessions.</p>}
                </div>
                <p className="text-[10px] text-slate-400">Do not recognise a device? Sign it out, then change your password.</p>
              </div>
            </div>
          )}

          {/* TAB 3: NOTIFICATIONS & WHATSAPP */}
          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-emerald-950">WhatsApp Follow-up Alerts</span>
                    <input
                      type="checkbox"
                      checked={receiveWhatsapp}
                      onChange={(e) => setReceiveWhatsapp(e.target.checked)}
                      className="h-4 w-4 text-emerald-600 rounded cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-emerald-800 mt-1">
                    Receive automatic WhatsApp reminders whenever follow-ups assigned to you are pending or scheduled.
                  </p>
                  <div className="mt-2 text-[10px] text-emerald-900 bg-white/70 px-2.5 py-1 rounded-lg border border-emerald-200 inline-block font-mono">
                    Target WhatsApp: {whatsappNumber || phone || 'Not configured'}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
                  <Mail className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-blue-950">Email Notifications</span>
                    <input
                      type="checkbox"
                      checked={receiveEmail}
                      onChange={(e) => setReceiveEmail(e.target.checked)}
                      className="h-4 w-4 text-blue-600 rounded cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-blue-800 mt-1">
                    Receive emails when new leads are assigned to you, or when quotations/bills are generated.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>{saving ? 'Saving...' : 'Save Notification Preferences'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
