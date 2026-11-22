import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { passwordRules } from '../utils/password';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** "current-password" lets a password manager fill it; "new-password" lets it suggest one. */
  autoComplete?: 'current-password' | 'new-password' | 'off';
  dark?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
}

/** Password box with a show / hide button. Never stores or logs what is typed. */
export const PasswordInput: React.FC<PasswordInputProps> = ({
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  dark = false,
  required = true,
  autoFocus = false,
  id,
  disabled = false,
}) => {
  const [visible, setVisible] = useState(false);
  const inputClass = dark
    ? 'login-input dark-input w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-medium'
    : 'w-full pl-10 pr-10 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xs font-semibold';

  return (
    <div className="relative">
      <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        required={required}
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={128}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((v) => !v)}
        className={`absolute right-3 top-2.5 ${dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};

interface PasswordChecklistProps {
  password: string;
  confirm?: string;
  email?: string;
  fullName?: string;
  dark?: boolean;
}

/** Live checklist of the password rules the server enforces. */
export const PasswordChecklist: React.FC<PasswordChecklistProps> = ({ password, confirm, email, fullName, dark = false }) => {
  const rules = passwordRules(password, email, fullName);
  if (confirm !== undefined) {
    rules.push({ label: 'Both passwords match', ok: password.length > 0 && password === confirm });
  }
  return (
    <div
      className={`p-3 rounded-xl border text-[11px] space-y-1 ${
        dark ? 'bg-slate-950/60 border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
      }`}
    >
      <span className={`font-bold block ${dark ? 'text-slate-200' : 'text-slate-700'}`}>Password requirements</span>
      {rules.map((rule) => (
        <p key={rule.label} className={rule.ok ? 'text-emerald-600 font-bold' : dark ? 'text-slate-400' : 'text-slate-400'}>
          {rule.ok ? '✓' : '○'} {rule.label}
        </p>
      ))}
    </div>
  );
};
