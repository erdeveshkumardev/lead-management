/**
 * Links that arrive in data (API answers, saved settings) are only ever rendered when they are plain
 * https links to the expected place. This keeps "javascript:" and similar URLs out of the page.
 */
export const safeHttpsUrl = (value: unknown, allowedHosts?: string[]): string | null => {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (allowedHosts && !allowedHosts.includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
};

export const WHATSAPP_HOSTS = ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'];
