/**
 * GSTIN helpers for instant feedback in forms. The server validates again (it is the authority).
 */
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const normalizeGstin = (value: string | null | undefined): string => (value || '').replace(/\s/g, '').toUpperCase();

/** Check character (15th) for the first 14 characters of a GSTIN. */
export const gstinChecksumChar = (first14: string): string => {
  let total = 0;
  for (let idx = 0; idx < first14.length; idx += 1) {
    const value = GSTIN_CHARS.indexOf(first14[idx]);
    if (value < 0) return '';
    const product = value * (idx % 2 ? 2 : 1);
    total += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (total % 36)) % 36];
};

/** Returns a readable problem, or '' when the GSTIN looks right (or is empty and optional). */
export const gstinProblem = (value: string | null | undefined, required = false): string => {
  const gstin = normalizeGstin(value);
  if (!gstin) return required ? 'GSTIN is required.' : '';
  if (gstin.length !== 15) return 'A GSTIN has exactly 15 characters.';
  if (!GSTIN_RE.test(gstin)) return 'GSTIN format is not right (2-digit state code, PAN, entity code, Z, check character).';
  if (gstinChecksumChar(gstin.slice(0, 14)) !== gstin[14]) return 'GSTIN check character does not match - please re-check the number.';
  return '';
};

/** Two-digit GST state code embedded in a GSTIN, or ''. */
export const stateCodeFromGstin = (value: string | null | undefined): string => {
  const gstin = normalizeGstin(value);
  return gstin.length === 15 && /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : '';
};

export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
