import React, { useState } from 'react';
import { api, CurrentUser, TenantInfo } from '../services/api';
import { 
  Zap, 
  Lock, 
  Mail, 
  ArrowRight, 
  ShieldCheck, 
  Sparkles,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: CurrentUser, tenant: TenantInfo | null) => void;
}

const formatErrorMessage = (err: any): string => {
  if (!err) return 'Invalid email or password.';
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) {
    return err.map((item) => (typeof item === 'object' && item?.msg ? item.msg : String(item))).join('. ');
  }
  if (typeof err === 'object') {
    if (err.msg) return String(err.msg);
    if (err.message) return String(err.message);
    if (err.detail) return formatErrorMessage(err.detail);
    return JSON.stringify(err);
  }
  return String(err);
};

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (loginEmail = email, loginPass = password) => {
    if (!loginEmail || !loginPass) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await api.login(loginEmail, loginPass);
      if (res && res.user) {
        // Save session
        localStorage.setItem('leadcrm_user', JSON.stringify(res.user));
        if (res.tenant) {
          localStorage.setItem('leadcrm_tenant', JSON.stringify(res.tenant));
        } else {
          localStorage.removeItem('leadcrm_tenant');
        }
        onLoginSuccess(res.user, res.tenant || null);
      } else {
        setErrorMsg(formatErrorMessage(res?.detail || res?.message || 'Invalid email or password.'));
      }
    } catch (err: any) {
      setErrorMsg(formatErrorMessage(err?.message || 'Failed to connect to authentication server.'));
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLogin(email, password);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-indigo-600 selection:text-white relative overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Left Hero Pane */}
        <div className="lg:col-span-5 p-8 sm:p-10 bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-950 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800/80">
          <div>
            {/* Brand Header */}
            <div className="flex items-center space-x-3 mb-8">
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

            <div className="space-y-4">
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
          <div className="mt-8 pt-6 border-t border-slate-800/80 space-y-2.5 text-xs text-slate-300">
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
        <div className="lg:col-span-7 p-8 sm:p-10 bg-slate-900/60 flex flex-col justify-center space-y-6">
          <div>
            <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Sign In to Your Account</h3>
            <p className="text-xs text-slate-400 mt-1">
              Please enter your authorized corporate email and password.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Secure Form */}
          <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-200 font-bold block mb-1.5 text-xs">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="login-input dark-input w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-medium"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-200 font-bold block mb-1.5 text-xs">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="login-input dark-input w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Secure Footer Information */}
          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500/80" />
              <span>256-bit Encrypted Session</span>
            </div>
            <span>v2.5 Enterprise</span>
          </div>
        </div>
      </div>
    </div>
  );
};
