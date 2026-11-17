import React, { useState, useEffect } from 'react';
import { api, CurrentUser, UserProfile } from '../services/api';
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
  Sparkles
} from 'lucide-react';

interface UserProfileModalProps {
  currentUser: CurrentUser;
  onClose: () => void;
  onUserUpdated?: (updated: CurrentUser) => void;
  initialTab?: 'profile' | 'security' | 'notifications';
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  currentUser,
  onClose,
  onUserUpdated,
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
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Load Profile from Server
  useEffect(() => {
    setLoading(true);
    api.getUserProfile(currentUser.id)
      .then((res) => {
        if (res && res.id) {
          setProfile(res);
          setFullName(res.full_name || '');
          setPhone(res.phone || '');
          setWhatsappNumber(res.whatsapp_number || res.phone || '');
          setDesignation(res.designation || '');
          setDepartment(res.department || '');
          setBio(res.bio || '');
          setReceiveWhatsapp(res.receive_whatsapp_notifications ?? true);
          setReceiveEmail(res.receive_email_notifications ?? true);
        }
      })
      .catch((err) => console.error('Failed to load user profile:', err))
      .finally(() => setLoading(false));
  }, [currentUser.id]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setAlertMsg(null);

    try {
      const res = await api.updateUserProfile(currentUser.id, {
        full_name: fullName,
        phone: phone,
        whatsapp_number: whatsappNumber,
        designation: designation,
        department: department,
        bio: bio,
        receive_whatsapp_notifications: receiveWhatsapp,
        receive_email_notifications: receiveEmail
      });

      if (res && res.status === 'success') {
        setAlertMsg({ type: 'success', text: 'Profile updated successfully!' });
        const updatedUser: CurrentUser = {
          ...currentUser,
          full_name: fullName,
          phone: phone,
          whatsapp_number: whatsappNumber,
          designation: designation,
          department: department
        };
        localStorage.setItem('leadcrm_user', JSON.stringify(updatedUser));
        if (onUserUpdated) onUserUpdated(updatedUser);
      } else {
        setAlertMsg({ type: 'error', text: res?.detail || res?.message || 'Failed to update profile.' });
      }
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: err?.message || 'Network error while updating profile.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);

    if (newPassword.length < 6) {
      setAlertMsg({ type: 'error', text: 'New password must be at least 6 characters long.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setAlertMsg({ type: 'error', text: 'New password and Confirm Password do not match.' });
      return;
    }

    setChangingPassword(true);
    try {
      const res = await api.changePassword({
        user_id: currentUser.id,
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword
      });

      if (res && res.status === 'success') {
        setAlertMsg({ type: 'success', text: 'Password changed successfully! You can now use your new password.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        const updatedUser = { ...currentUser, is_first_login: false };
        localStorage.setItem('leadcrm_user', JSON.stringify(updatedUser));
        if (onUserUpdated) onUserUpdated(updatedUser);
      } else {
        setAlertMsg({ type: 'error', text: res?.detail || res?.message || 'Failed to change password.' });
      }
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: err?.message || 'Network error while changing password.' });
    } finally {
      setChangingPassword(false);
    }
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
                <span>{profile?.company_name || 'LeadCRM Workspace'}</span>
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
              <span>Change Password</span>
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
                  <label className="text-xs font-bold text-slate-700 block mb-1">Designation</label>
                  <div className="relative">
                    <Briefcase className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. Sales Executive, Senior BDA"
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Department</label>
                  <div className="relative">
                    <Layers className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. Domestic Sales, Machinery Ops"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
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

          {/* TAB 2: CHANGE PASSWORD */}
          {activeTab === 'security' && (
            <form onSubmit={handleChangePassword} className="space-y-4 max-w-lg mx-auto">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-1">
                <span className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  <span>Password Security Requirements</span>
                </span>
                <p className="text-[11px] text-amber-800">
                  Password must be at least 6 characters. Use letters, numbers, and symbols for best security.
                </p>
              </div>

              {!currentUser.is_first_login && (
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Current Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      required
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  New Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Confirm New Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    placeholder="Re-enter your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <button
                  type="submit"
                  disabled={changingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>{changingPassword ? 'Updating...' : 'Update Password'}</span>
                </button>
              </div>
            </form>
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
