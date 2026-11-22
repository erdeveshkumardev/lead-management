import React, { useState } from 'react';
import { api, apiMessage, isApiError } from '../services/api';
import { PasswordInput } from './PasswordInput';
import {
  Zap,
  Mail,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  KeyRound,
} from 'lucide-react';

interface LoginPageProps {
  /**
   * The session itself is published by the API client. The password that was just typed is handed
   * over (kept in memory only) so a first sign-in can replace a temporary password without retyping it.
   */
  onLoginSuccess?: (passwordUsed: string) => void;
  /** Shown above the form, e.g. "Your session has ended". */
  notice?: string;
}

type View = 'credentials' | 'mfa' | 'forgot';

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, notice }) => {
  const [view, setView] = useState<View>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const switchView = (next: View) => {
    setView(next);
    setErrorMsg('');
    setInfoMsg('');
    setMfaCode('');
    setUseRecoveryCode(false);
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    const res = await api.login(email, password);
    setLoading(false);

    if (isApiError(res)) {
      setErrorMsg(apiMessage(res, 'Invalid email or password.'));
      return;
    }
    if (res.mfa_required && res.mfa_token) {
      // password accepted: a second factor is required before any session is issued
      setMfaToken(res.mfa_token);
      setView('mfa');
      return;
    }
    if (res.user) {
      const used = password;
      setPassword('');
      onLoginSuccess?.(used);
      return;
    }
    setErrorMsg('Sign-in failed. Please try again.');
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    const res = await api.verifyMfa(mfaToken, mfaCode);
    setLoading(false);
    if (isApiError(res)) {
      setErrorMsg(apiMessage(res, 'Invalid verification code.'));
      setMfaCode('');
      if (res.http_status === 401 && /expired/i.test(res.detail)) {
        setMfaToken('');
        setView('credentials');
      }
      return;
    }
    if (res.user) {
      const used = password;
      setPassword('');
      setMfaToken('');
      onLoginSuccess?.(used);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    const res = await api.forgotPassword(email);
    setLoading(false);
    if (isApiError(res)) {
      setErrorMsg(apiMessage(res));
      return;
    }
    // Deliberately the same message whether or not the address has an account.
    setInfoMsg(
      'If this address has an account, a reset link has been sent and is valid for a short time. ' +
        'No e-mail? Ask your company administrator to reset your password from Team & Permissions.'
    );
  };

  const inputClass =
    'login-input dark-input w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-medium';
  const primaryButton =
    'w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all transform hover:-translate-y-0.5 disabled:opacity-50';

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-indigo-600 selection:text-white relative overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Left Hero Pane */}
        {/* phones and tablets: only the brand line, so the sign-in form is on the first screen */}
        <div className="lg:col-span-5 p-5 sm:p-8 lg:p-10 bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-950 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800/80">
          <div>
            {/* Brand Header */}
            <div className="flex items-center space-x-3 lg:mb-8">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-xl shadow-indigo-500/25">
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xl font-black text-white tracking-tight">Lead-to-Cash</span>
                <span className="block text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                  Enterprise LMS & Billing
                </span>
              </div>
            </div>

            <div className="hidden lg:block space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                <span>Enterprise Multi-Tenant Platform</span>
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                Turn Every Inquiry Into Verified GST Bills
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Automated multi-source lead ingestion from IndiaMART, TradeIndia, Facebook, custom funnels, and 1-click GST tax invoices.
              </p>
            </div>
          </div>

          {/* Highlights */}
          <div className="hidden lg:block mt-8 pt-6 border-t border-slate-800/80 space-y-2.5 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Dedicated Multi-Tenant Isolation</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-indigo-400" />
              <span>Real-Time Sales Pipeline Tracking</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-400" />
              <span>Strict Role-Based Access Control</span>
            </div>
          </div>
        </div>

        {/* Right Form Pane */}
        <div className="lg:col-span-7 p-5 sm:p-8 lg:p-10 bg-slate-900/60 flex flex-col justify-center space-y-6">
          <div>
            <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {view === 'credentials' && 'Sign In to Your Account'}
              {view === 'mfa' && 'Two-Factor Verification'}
              {view === 'forgot' && 'Reset Your Password'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {view === 'credentials' && 'Please enter your authorized corporate email and password.'}
              {view === 'mfa' &&
                (useRecoveryCode
                  ? 'Enter one of the recovery codes you saved when you turned on two-factor sign-in.'
                  : 'Enter the 6-digit code from your authenticator app.')}
              {view === 'forgot' && 'Enter your account e-mail and we will send you a reset link.'}
            </p>
          </div>

          {notice && !errorMsg && !infoMsg && view === 'credentials' && (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-200 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-400" />
              <span>{notice}</span>
            </div>
          )}

          {errorMsg && (
            <div role="alert" className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoMsg && (
            <div role="status" className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-200 text-xs flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400 mt-0.5" />
              <span>{infoMsg}</span>
            </div>
          )}

          {/* Step 1: e-mail and password */}
          {view === 'credentials' && (
            <form onSubmit={handleCredentials} className="space-y-4 text-xs">
              <div>
                <label htmlFor="login-email" className="text-slate-200 font-bold block mb-1.5 text-xs">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="username"
                    maxLength={254}
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="text-slate-200 font-bold block text-xs">Password</label>
                  <button type="button" onClick={() => switchView('forgot')} className="text-[11px] font-bold text-indigo-300 hover:text-indigo-200">
                    Forgot password?
                  </button>
                </div>
                <PasswordInput id="login-password" dark value={password} onChange={setPassword} placeholder="••••••••••••" autoComplete="current-password" />
              </div>

              <button type="submit" disabled={loading} className={primaryButton}>
                <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {/* Step 2: second factor */}
          {view === 'mfa' && (
            <form onSubmit={handleMfa} className="space-y-4 text-xs">
              <div>
                <label htmlFor="login-mfa" className="text-slate-200 font-bold block mb-1.5 text-xs">
                  {useRecoveryCode ? 'Recovery code' : 'Verification code'}
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    id="login-mfa"
                    type="text"
                    required
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode={useRecoveryCode ? 'text' : 'numeric'}
                    maxLength={useRecoveryCode ? 20 : 6}
                    placeholder={useRecoveryCode ? 'XXXXX-XXXXX' : '123456'}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(useRecoveryCode ? e.target.value.trim() : e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`${inputClass} ${useRecoveryCode ? '' : 'tracking-[0.3em] text-sm font-bold'}`}
                  />
                </div>
              </div>

              <button type="submit" disabled={loading || mfaCode.length < 6} className={primaryButton}>
                <ShieldCheck className="h-4 w-4" />
                <span>{loading ? 'Verifying...' : 'Verify & Sign In'}</span>
              </button>

              <div className="flex items-center justify-between text-[11px] font-bold">
                <button type="button" onClick={() => { setPassword(''); setMfaToken(''); switchView('credentials'); }} className="text-slate-400 hover:text-slate-200 flex items-center gap-1">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to sign in</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setUseRecoveryCode((v) => !v); setMfaCode(''); setErrorMsg(''); }}
                  className="text-indigo-300 hover:text-indigo-200"
                >
                  {useRecoveryCode ? 'Use the authenticator app' : 'Lost your phone? Use a recovery code'}
                </button>
              </div>
            </form>
          )}

          {/* Forgot password */}
          {view === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4 text-xs">
              <div>
                <label htmlFor="forgot-email" className="text-slate-200 font-bold block mb-1.5 text-xs">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="username"
                    maxLength={254}
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <button type="submit" disabled={loading || !email} className={primaryButton}>
                <span>{loading ? 'Sending...' : 'Send reset link'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button type="button" onClick={() => switchView('credentials')} className="text-[11px] font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to sign in</span>
              </button>
            </form>
          )}

          {/* Secure Footer Information */}
          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500/80" />
              <span>Encrypted connection &middot; Two-factor sign-in supported</span>
            </div>
            <span>v3.0 Secure</span>
          </div>
        </div>
      </div>
    </div>
  );
};
