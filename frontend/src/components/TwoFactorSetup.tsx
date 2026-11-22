import React, { useState } from 'react';
import { api, apiMessage, isApiError } from '../services/api';
import { AlertCircle, CheckCircle2, Copy, Download, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';

interface TwoFactorSetupProps {
  /** Called after the person has confirmed they stored their recovery codes. */
  onCompleted: () => void;
  onCancel?: () => void;
}

type Step = 'intro' | 'scan' | 'codes';

/**
 * Enrols the signed-in user in two-factor authentication (authenticator app / TOTP):
 * scan the QR code, prove it works with one code, then store the one-time recovery codes.
 */
export const TwoFactorSetup: React.FC<TwoFactorSetupProps> = ({ onCompleted, onCancel }) => {
  const [step, setStep] = useState<Step>('intro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const begin = async () => {
    setBusy(true);
    setError('');
    const res = await api.mfaSetup();
    setBusy(false);
    if (isApiError(res) || !res.qr_code) {
      setError(apiMessage(res, 'Could not start two-factor setup.'));
      return;
    }
    setQrCode(res.qr_code);
    setSecret(res.secret);
    setStep('scan');
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await api.mfaEnable(code);
    setBusy(false);
    if (isApiError(res)) {
      setError(apiMessage(res, 'That code was not accepted.'));
      return;
    }
    setRecoveryCodes(Array.isArray(res.recovery_codes) ? res.recovery_codes : []);
    setCode('');
    setStep('codes');
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy is not available in this browser. Please write the codes down.');
    }
  };

  const downloadCodes = () => {
    const blob = new Blob(
      [`Lead-to-Cash recovery codes\nEach code works once. Keep them somewhere safe and private.\n\n${recoveryCodes.join('\n')}\n`],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lead-to-cash-recovery-codes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="space-y-4 text-slate-900">
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      {step === 'intro' && (
        <div className="space-y-4">
          <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-start gap-3">
            <Smartphone className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-xs text-indigo-950 space-y-1">
              <p className="font-bold">You need an authenticator app on your phone</p>
              <p className="text-indigo-800">
                Google Authenticator, Microsoft Authenticator, Authy or any app that supports time-based codes. After setup you will
                enter a 6-digit code from the app every time you sign in.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50">
                Not now
              </button>
            )}
            <button
              type="button"
              onClick={begin}
              disabled={busy}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{busy ? 'Preparing…' : 'Start setup'}</span>
            </button>
          </div>
        </div>
      )}

      {step === 'scan' && (
        <form onSubmit={confirm} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div className="flex justify-center">
              <img src={qrCode} alt="QR code for your authenticator app" className="h-44 w-44 rounded-2xl border border-slate-200 bg-white p-2" />
            </div>
            <div className="text-xs text-slate-600 space-y-2">
              <p>
                <strong className="text-slate-900">1.</strong> Open your authenticator app and scan this QR code.
              </p>
              <p>
                <strong className="text-slate-900">2.</strong> Cannot scan? Enter this key by hand:
              </p>
              <code className="block p-2 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-mono text-slate-900 break-all select-all">
                {secret}
              </code>
              <p>
                <strong className="text-slate-900">3.</strong> Type the 6-digit code the app shows.
              </p>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Code from the app</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-sm font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50">
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{busy ? 'Checking…' : 'Turn on two-factor sign-in'}</span>
            </button>
          </div>
        </form>
      )}

      {step === 'codes' && (
        <div className="space-y-4">
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 font-bold">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>Two-factor sign-in is on. Other devices have been signed out.</span>
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-2">
            <p className="font-bold">Save these recovery codes now. They are shown only once.</p>
            <p className="text-amber-800">
              If you lose your phone, each code lets you sign in one time. Without them, only an administrator can restore your access.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {recoveryCodes.map((item) => (
                <code key={item} className="px-2 py-1.5 rounded-lg bg-white border border-amber-200 font-mono text-[12px] text-slate-900 text-center select-all">
                  {item}
                </code>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={copyCodes} className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-[11px] flex items-center gap-1.5 hover:bg-amber-100">
                <Copy className="h-3.5 w-3.5" />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button type="button" onClick={downloadCodes} className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-[11px] flex items-center gap-1.5 hover:bg-amber-100">
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 rounded cursor-pointer" />
            <span>I have stored these recovery codes in a safe place</span>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!saved}
              onClick={onCompleted}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md shadow-indigo-600/20 disabled:opacity-50"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
