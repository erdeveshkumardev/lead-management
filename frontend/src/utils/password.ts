/**
 * Mirrors the server's password policy so people get instant feedback while typing.
 * The server remains the authority: it re-checks every password and also rejects known common ones.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRule {
  label: string;
  ok: boolean;
}

export const passwordRules = (password: string, email?: string, fullName?: string): PasswordRule[] => {
  const pw = password || '';
  const lowered = pw.toLowerCase();
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  const emailLocal = (email || '').split('@')[0].toLowerCase();
  const nameParts = (fullName || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 4);
  const personal = (emailLocal.length >= 4 && lowered.includes(emailLocal)) || nameParts.some((part) => lowered.includes(part));

  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: pw.length >= PASSWORD_MIN_LENGTH && pw.length <= PASSWORD_MAX_LENGTH },
    { label: 'Three of these: lowercase, UPPERCASE, number, symbol', ok: classes >= 3 },
    { label: 'Does not contain the word "password"', ok: pw.length > 0 && !lowered.includes('password') },
    { label: 'Does not contain your name or e-mail', ok: pw.length > 0 && !personal },
  ];
};

export const passwordIsAcceptable = (password: string, email?: string, fullName?: string): boolean =>
  passwordRules(password, email, fullName).every((rule) => rule.ok);
