import React, { useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface SecretInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
  id?: string;
}

const MASK = '••••';

/**
 * Text box for an API key or other credential.
 *
 * The server never sends a stored secret back: it sends a mask such as "••••••••abcd". Clicking into a
 * masked box empties it so a new value can be typed. Leaving it empty puts the mask back, and a mask is
 * read by the server as "keep what is stored" - so a secret is never wiped or half-overwritten by accident.
 */
export const SecretInput: React.FC<SecretInputProps> = ({ value, onChange, placeholder, className = '', disabled, maxLength = 1000, id }) => {
  const savedMask = useRef('');
  const [visible, setVisible] = useState(false);
  const masked = value.includes(MASK);

  return (
    <div className="relative">
      <input
        id={id}
        // a stored value is shown as its mask (so the last characters are readable); typed values are hidden
        type={masked || visible ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => {
          if (masked) {
            savedMask.current = value;
            onChange('');
          }
        }}
        onBlur={() => {
          if (!value && savedMask.current) onChange(savedMask.current);
        }}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border border-slate-200 rounded-xl pl-3 pr-10 py-2 font-mono bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 ${className}`}
      />
      {!masked && value && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? 'Hide value' : 'Show value'}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-2 text-slate-400 hover:text-slate-600"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
      {masked && <p className="text-[10px] text-emerald-700 mt-1">Saved (encrypted). Click to replace it.</p>}
    </div>
  );
};
