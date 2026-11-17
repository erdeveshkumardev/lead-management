import React, { useState } from 'react';
import { api, CurrentUser } from '../services/api';
import { Lock, ShieldCheck, KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';

interface FirstLoginPasswordModalProps {
  currentUser: CurrentUser;
  onPasswordChanged: (updatedUser: CurrentUser) => void;
  onOpenProfile?: () => void;
}

export const FirstLoginPasswordModal: React.FC<FirstLoginPasswordModalProps> = ({
  currentUser,
  onPasswordChanged,
  onOpenProfile
}) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and Confirm Password do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.changePassword({
        user_id: currentUser.id,
        new_password: newPassword,
        confirm_password: confirmPassword
      });

      if (res && res.status === 'success') {
        setSuccessMsg('✅ Password updated successfully! Redirecting...');
        const updated = { ...currentUser, is_first_login: false };
        localStorage.setItem('leadcrm_user', JSON.stringify(updated));
        setTimeout(() => {
          onPasswordChanged(updated);
        }, 1200);
      } else {
        setErrorMsg(res?.detail || res?.message || 'Failed to update password.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error while updating password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200" style={{ colorScheme: 'light' }}>
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden text-slate-900">
        {/* Header Banner */}
        <div className="p-6 bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-600 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
          <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-sm mx-auto flex items-center justify-center mb-3 shadow-lg border border-white/20">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-black uppercase tracking-wider mb-2">
            <Sparkles className="h-3 w-3 text-amber-300" />
            <span>First-Time Sign In</span>
          </span>
          <h3 className="text-xl font-black tracking-tight text-white">Create Your Permanent Password</h3>
          <p className="text-xs text-indigo-100 mt-1 max-w-xs mx-auto">
            Welcome, <strong>{currentUser.full_name}</strong>! Please replace your temporary password with a secure personal password.
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                New Permanent Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xs font-semibold"
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
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xs font-semibold"
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

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
              <span className="font-bold text-slate-700 block">Security Requirement:</span>
              <p className="flex items-center gap-1.5">
                <span className={newPassword.length >= 6 ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                  {newPassword.length >= 6 ? '✓' : '○'} At least 6 characters
                </span>
              </p>
              <p className="flex items-center gap-1.5">
                <span className={newPassword && newPassword === confirmPassword ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                  {newPassword && newPassword === confirmPassword ? '✓' : '○'} Passwords match
                </span>
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{loading ? 'Saving New Password...' : 'Save Password & Enter CRM'}</span>
            </button>
          </form>

          {onOpenProfile && (
            <div className="text-center pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onOpenProfile}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                Or Open Full Profile Page &rarr;
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
