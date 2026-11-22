import React, { useState } from 'react';
import { api, apiMessage, isApiError } from '../services/api';
import { PasswordChecklist, PasswordInput } from './PasswordInput';
import { passwordIsAcceptable } from '../utils/password';
import { AlertCircle, ArrowRight, CheckCircle2, KeyRound, Zap } from 'lucide-react';

interface ResetPasswordPageProps {
  /** One-time token from the e-mailed link. Held in memory only; it is removed from the address bar on load. */
  token: string;
  onDone: () => void;
}

/** Screen opened from the "reset your password" e-mail link. */
export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({ token, onDone }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [done, setDone] = useState(false);

  const ready = passwordIsAcceptable(newPassword) && newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setLoading(true);
    setErrorMsg('');
    const res = await api.resetPassword(token, newPassword);
    setLoading(false);
    if (isApiError(res)) {
      setErrorMsg(apiMessage(res, 'This reset link is invalid or has expired.'));
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl p-8 space-y-6 backdrop-blur-xl">
        <div className="flex items-center space-x-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-xl shadow-indigo-500/25">
            <Zap className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xl font-black text-white tracking-tight">Lead-to-Cash</span>
            <span className="block text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Set a new password</span>
          </div>
        </div>

        {errorMsg && (
          <div role="alert" className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {done ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-200 text-xs flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400 mt-0.5" />
              <span>Your password has been changed and every device has been signed out. Sign in with the new password.</span>
            </div>
            <button
              type="button"
              onClick={onDone}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs"
            >
              <span>Go to sign in</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-200 font-bold block mb-1.5 text-xs">New password</label>
              <PasswordInput dark value={newPassword} onChange={setNewPassword} placeholder="Choose a strong password" autoComplete="new-password" autoFocus />
            </div>
            <div>
              <label className="text-slate-200 font-bold block mb-1.5 text-xs">Confirm new password</label>
              <PasswordInput dark value={confirmPassword} onChange={setConfirmPassword} placeholder="Type it again" autoComplete="new-password" />
            </div>
            <PasswordChecklist dark password={newPassword} confirm={confirmPassword} />
            <button
              type="submit"
              disabled={loading || !ready}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              <span>{loading ? 'Saving...' : 'Save new password'}</span>
            </button>
            <button type="button" onClick={onDone} className="w-full text-center text-[11px] font-bold text-slate-400 hover:text-slate-200">
              Cancel and go to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
