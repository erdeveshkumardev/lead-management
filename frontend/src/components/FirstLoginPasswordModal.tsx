import React, { useState } from 'react';
import { api, apiMessage, CurrentUser, isApiError } from '../services/api';
import { PasswordChecklist, PasswordInput } from './PasswordInput';
import { passwordIsAcceptable } from '../utils/password';
import { ShieldCheck, KeyRound, AlertCircle, Sparkles, LogOut } from 'lucide-react';

interface FirstLoginPasswordModalProps {
  currentUser: CurrentUser;
  /**
   * The temporary password the person just signed in with, if the app still has it in memory.
   * After a page reload it is gone, and the form asks for it instead.
   */
  knownCurrentPassword?: string;
  onPasswordChanged?: () => void;
  onLogout: () => void;
}

/**
 * Blocks the application until a temporary password (first sign-in, or an administrator reset)
 * has been replaced. The server enforces the same rule: every other API call is refused until then.
 */
export const FirstLoginPasswordModal: React.FC<FirstLoginPasswordModalProps> = ({
  currentUser,
  knownCurrentPassword = '',
  onPasswordChanged,
  onLogout,
}) => {
  const [currentPassword, setCurrentPassword] = useState(knownCurrentPassword);
  const [askCurrent, setAskCurrent] = useState(!knownCurrentPassword);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const ready =
    currentPassword.length > 0 &&
    passwordIsAcceptable(newPassword, currentUser.email, currentUser.full_name) &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!ready) return;

    setLoading(true);
    const res = await api.changePassword({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    });
    setLoading(false);

    if (isApiError(res)) {
      setErrorMsg(apiMessage(res, 'Failed to update password.'));
      if (/current password/i.test(res.detail)) {
        // the remembered temporary password was not right: let the person type it
        setCurrentPassword('');
        setAskCurrent(true);
      }
      return;
    }
    // The API client has already stored the new session, which closes this dialog.
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onPasswordChanged?.();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto" style={{ colorScheme: 'light' }}>
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden text-slate-900 my-auto">
        {/* Header Banner */}
        <div className="p-6 bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-600 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
          <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-sm mx-auto flex items-center justify-center mb-3 shadow-lg border border-white/20">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-black uppercase tracking-wider mb-2">
            <Sparkles className="h-3 w-3 text-amber-300" />
            <span>Password change required</span>
          </span>
          <h3 className="text-xl font-black tracking-tight text-white">Create Your Own Password</h3>
          <p className="text-xs text-indigo-100 mt-1 max-w-xs mx-auto">
            Welcome, <strong>{currentUser.full_name}</strong>. You signed in with a temporary password. Replace it with one only you know
            before you continue.
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4">
          {errorMsg && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {askCurrent && (
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Temporary password <span className="text-rose-500">*</span>
                </label>
                <PasswordInput value={currentPassword} onChange={setCurrentPassword} placeholder="The password you signed in with" autoComplete="current-password" />
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                New password <span className="text-rose-500">*</span>
              </label>
              <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="Choose a strong password" autoComplete="new-password" autoFocus={!askCurrent} />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Confirm new password <span className="text-rose-500">*</span>
              </label>
              <PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="Type it again" autoComplete="new-password" />
            </div>

            <PasswordChecklist password={newPassword} confirm={confirmPassword} email={currentUser.email} fullName={currentUser.full_name} />

            <button
              type="submit"
              disabled={loading || !ready}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{loading ? 'Saving new password...' : 'Save password & continue'}</span>
            </button>
          </form>

          <div className="text-center pt-2 border-t border-slate-100">
            <button type="button" onClick={onLogout} className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer inline-flex items-center gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
