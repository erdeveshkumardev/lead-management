/**
 * Where the API lives.
 *
 * By default the web app talks to "/api/v1" on its own address: nginx (production) and the Vite dev
 * server (development) forward that path to the API. Being on the same origin is what lets the
 * HttpOnly, SameSite=Strict session cookie work, and it needs no cross-site (CORS) access at all.
 *
 * VITE_API_URL can point at another address for special set-ups. That address must then be listed in
 * the API's BACKEND_CORS_ORIGINS, and must share the web app's site for the session cookie to be sent.
 */
export const getApiBaseUrl = (): string => {
  const configured = (import.meta.env.VITE_API_URL || '').trim();
  let url = configured || '/api/v1';

  if (typeof window !== 'undefined') {
    const { hostname, origin, protocol } = window.location;
    const pageIsLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    // a build made with a developer address must never call "localhost" from a live site
    if (!pageIsLocal && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)) url = '/api/v1';
    if (url.startsWith('/')) url = `${origin}${url}`;
    // never send credentials over plain http from a page that was loaded over https
    if (protocol === 'https:' && url.startsWith('http://')) url = `https://${url.slice(7)}`;
  }

  const [scheme, rest] = url.split('://');
  const cleaned = rest === undefined ? scheme.replace(/\/+/g, '/') : `${scheme}://${rest.replace(/\/+/g, '/')}`;
  return cleaned.replace(/\/+$/, '');
};

export const API_BASE_URL = getApiBaseUrl();

export interface CurrentUser {
  id: string;
  full_name: string;
  email: string;
  role: 'super_admin' | 'company_admin' | 'manager' | 'staff';
  tenant_id: string;
  permissions: Record<string, boolean>;
  is_first_login?: boolean;
  must_change_password?: boolean;
  mfa_enabled?: boolean;
  phone?: string;
  whatsapp_number?: string;
  designation?: string;
  department?: string;
  avatar_url?: string;
  bio?: string;
}

/** What the signed-in user may do. Mirrors the server, which is the only place where it is enforced. */
export const can = (user: CurrentUser | null | undefined, permission: string): boolean => {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'company_admin') return true;
  return Boolean(user.permissions?.[permission]);
};

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  whatsapp_number?: string;
  role: string;
  designation?: string;
  department?: string;
  bio?: string;
  avatar_url?: string;
  company_name: string;
  tenant_id: string;
  is_first_login: boolean;
  mfa_enabled?: boolean;
  last_login_at?: string;
  assigned_leads_count: number;
  receive_whatsapp_notifications: boolean;
  receive_email_notifications: boolean;
  created_at: string;
}

export interface CommunicationSettings {
  tenant_id: string;
  company_name: string;
  sms: {
    is_enabled: boolean;
    provider: string;
    api_key?: string;
    sender_id?: string;
    route?: string;
    template_id?: string;
    custom_url?: string;
    status: string;
  };
  whatsapp: {
    is_enabled: boolean;
    provider: string;
    phone_number_id?: string;
    waba_id?: string;
    access_token?: string;
    account_sid?: string;
    auth_token?: string;
    from_phone_number?: string;
    custom_webhook_url?: string;
    pending_followup_template?: string;
    status: string;
  };
  email: {
    is_enabled: boolean;
    mode: 'smtp' | 'api';
    smtp_host?: string;
    smtp_port?: number;
    smtp_user?: string;
    smtp_password?: string;
    smtp_use_tls?: boolean;
    from_name?: string;
    from_email?: string;
    api_provider?: string;
    api_key?: string;
    status: string;
  };
}

export interface TenantInfo {
  id: string;
  company_name: string;
  company_type: string;
  plan_name: string;
  max_users_limit: number;
  gstin?: string;
}

export interface FollowUpItem {
  id?: string;
  scheduled_at: string;
  follow_up_type: string;
  note: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  assigned_to_user_id?: string;
  assigned_to_user_name?: string;
  created_at?: string;
  completed_at?: string;
  completion_note?: string;
}

export interface Lead {
  _id: string;
  id?: string;
  tenant_id: string;
  source: string;
  source_lead_id?: string;
  full_name: string;
  phone: string;
  email?: string;
  company_name?: string;
  city?: string;
  state?: string;
  state_code?: string;
  pincode?: string;
  address?: string;
  gstin?: string;
  lost_reason?: string;
  product_inquired?: string;
  inquiry_message?: string;
  deal_value: number;
  stage: string;
  priority: string;
  category?: 'HOT' | 'WARM' | 'COLD' | string;
  assigned_to_user_id?: string;
  assigned_to_user_name?: string;
  custom_fields: Record<string, any>;
  conversion_info: {
    is_converted: boolean;
    quotation_id?: string;
    invoice_id?: string;
    invoice_number?: string;
    converted_at?: string;
  };
  next_follow_up?: FollowUpItem | null;
  follow_ups?: FollowUpItem[];
  timeline: Array<{
    activity_type: string;
    note: string;
    performed_by_name?: string;
    timestamp: string;
  }>;
  created_at: string;
}

export interface InvoicePayment {
  payment_id: string;
  amount: number;
  payment_mode: string;
  reference_number?: string;
  note?: string;
  paid_at: string;
  recorded_by_name?: string;
  is_reversed?: boolean;
  reversal_reason?: string;
}

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'NOT_APPLICABLE';

export interface Invoice {
  _id: string;
  tenant_id?: string;
  invoice_number: string;
  document_type: 'QUOTATION' | 'TAX_INVOICE' | 'PROFORMA';
  lead_id?: string;
  seller: {
    name: string;
    company_name: string;
    gstin?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    state_code?: string;
  };
  customer: {
    name: string;
    company_name?: string;
    gstin?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    state_code?: string;
  };
  invoice_date: string;
  due_date?: string;
  place_of_supply_code?: string;
  place_of_supply_name?: string;
  is_interstate?: boolean;
  amount_in_words?: string;
  items: Array<{
    name: string;
    description?: string;
    hsn_sac_code?: string;
    quantity: number;
    unit: string;
    unit_price: number;
    discount_amount?: number;
    taxable_amount: number;
    gst_rate: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    total_amount: number;
  }>;
  financials: {
    taxable_subtotal: number;
    total_discount?: number;
    total_cgst: number;
    total_sgst: number;
    total_igst: number;
    total_tax: number;
    round_off?: number;
    grand_total: number;
    paid_amount: number;
    balance_due: number;
  };
  payment_status: PaymentStatus;
  payments: InvoicePayment[];
  terms_and_conditions?: string;
  notes?: string;
  cancellation_reason?: string;
  converted_invoice_id?: string;
  source_quotation_id?: string;
  created_by_name?: string;
}

export interface Product {
  _id: string;
  name: string;
  sku?: string;
  hsn_sac_code?: string;
  unit: string;
  unit_price: number;
  gst_rate: number;
}

export interface PipelineStage {
  id: string;
  label: string;
  color: string;
  order: number;
}

export interface TeamMember {
  _id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  role: 'company_admin' | 'manager' | 'staff' | string;
  designation?: string;
  department?: string;
  phone?: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
  assigned_leads_count: number;
  created_at: string;
}

// =====================================================================================================
//  Secure session handling
//
//  * The short-lived access token is kept in memory only. It is never written to localStorage or
//    sessionStorage, so a script-injection bug cannot walk away with a long-lived credential.
//  * The refresh token is an HttpOnly, SameSite=Strict cookie: JavaScript cannot read it at all.
//    After a page reload the app silently asks the server for a new access token with that cookie.
//  * The tenant is decided by the server from the session. Nothing the browser sends can select
//    another company's data, so tenant ids are not passed as request parameters any more.
// =====================================================================================================
export interface SessionState {
  user: CurrentUser;
  tenant: TenantInfo | null;
  mustChangePassword: boolean;
  mfaEnrollmentRequired: boolean;
  features: Record<string, boolean>;
}

export interface ApiError {
  error: true;
  http_status: number;
  detail: string;
  code?: string;
}

let accessToken: string | null = null;
let session: SessionState | null = null;
type RefreshOutcome = 'ok' | 'signed-out' | 'unavailable';
let refreshInFlight: Promise<RefreshOutcome> | null = null;
const sessionListeners = new Set<(state: SessionState | null) => void>();

const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/mfa/verify', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password'];

export const isApiError = (value: any): value is ApiError =>
  Boolean(value && typeof value === 'object' && value.error === true && typeof value.http_status === 'number');

/** Human readable message for any API result (error or not). */
export const apiMessage = (value: any, fallback = 'Something went wrong. Please try again.'): string => {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value.detail === 'string') return value.detail;
  if (typeof value.message === 'string') return value.message;
  return fallback;
};

export const getSession = (): SessionState | null => session;

export const onSessionChange = (listener: (state: SessionState | null) => void): (() => void) => {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
};

const publishSession = (): void => {
  sessionListeners.forEach((listener) => listener(session));
};

const clearSession = (): void => {
  accessToken = null;
  if (session !== null) {
    session = null;
    publishSession();
  }
};

/** Stores a session payload returned by login / refresh / password change / 2FA endpoints. */
const applySessionPayload = (body: any): void => {
  if (!body || !body.user) return;
  if (body.access_token) accessToken = body.access_token;
  const mustChange = Boolean(body.must_change_password ?? body.user.must_change_password);
  session = {
    user: { ...body.user, is_first_login: mustChange, must_change_password: mustChange },
    tenant: body.tenant ?? session?.tenant ?? null,
    mustChangePassword: mustChange,
    mfaEnrollmentRequired: Boolean(body.mfa_enrollment_required),
    features: body.features ?? session?.features ?? {},
  };
  publishSession();
};

const patchSessionUser = (user: Partial<CurrentUser> | null | undefined): void => {
  if (!session || !user) return;
  session = { ...session, user: { ...session.user, ...user, is_first_login: session.mustChangePassword } };
  publishSession();
};

const tenantId = (): string => session?.tenant?.id || session?.user?.tenant_id || '';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

const rawFetch = (path: string, options: RequestOptions = {}): Promise<Response> => {
  // The custom header makes every call a "non-simple" request: browsers will not send it cross-site
  // without a CORS pre-flight, which the API only grants to this application's own origin.
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body,
    credentials: 'include', // lets the browser attach / store the HttpOnly refresh cookie
    cache: 'no-store',
  });
};

const defaultMessage = (status: number): string => {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You do not have permission to do this.';
  if (status === 404) return 'Not found.';
  if (status === 409) return 'This was changed by someone else. Please refresh and try again.';
  if (status === 413) return 'The file or request is too large.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The server had a problem. Please try again shortly.';
  return 'The request could not be completed.';
};

const toApiError = async (res: Response): Promise<ApiError> => {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const detail = data?.detail;
  let message: string;
  if (typeof detail === 'string') message = detail;
  else if (detail && typeof detail.message === 'string') message = detail.message;
  else message = defaultMessage(res.status);
  return { error: true, http_status: res.status, detail: message, code: detail && typeof detail === 'object' ? detail.code : undefined };
};

const networkError = (): ApiError => ({
  error: true,
  http_status: 0,
  detail: 'Cannot reach the server. Check your internet connection and try again.',
});

const temporarilyUnavailable = (): ApiError => ({
  error: true,
  http_status: 503,
  detail: 'The server is busy right now. Please try again in a moment.',
});

/**
 * Asks the server for a new access token using the HttpOnly refresh cookie (single flight).
 *   ok          - a new access token is in memory
 *   signed-out  - the server says the session is over (the in-memory session has been cleared)
 *   unavailable - temporary problem (no connection, server restarting, too many requests): the session
 *                 cookie is still valid, so the person must NOT be thrown back to the sign-in page
 */
const refreshSession = (): Promise<RefreshOutcome> => {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<RefreshOutcome> => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
          cache: 'no-store',
        });
        if (res.ok) {
          applySessionPayload(await res.json());
          return 'ok';
        }
        if (res.status === 401 || res.status === 403) {
          clearSession();
          return 'signed-out';
        }
        return 'unavailable';
      } catch {
        return 'unavailable';
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
};

const send = async (path: string, options: RequestOptions = {}): Promise<Response | ApiError> => {
  try {
    let res = await rawFetch(path, options);
    if (res.status === 401 && !PUBLIC_AUTH_PATHS.some((p) => path.startsWith(p))) {
      const outcome = await refreshSession();
      if (outcome === 'unavailable') return temporarilyUnavailable(); // still signed in; only this attempt failed
      if (outcome === 'ok') {
        res = await rawFetch(path, options);
        if (res.status === 401) clearSession();
      }
    }
    return res;
  } catch {
    return networkError();
  }
};

/** JSON request. Resolves with the parsed body, or with an ApiError object (it never throws). */
const request = async <T = any>(path: string, options: RequestOptions = {}): Promise<T> => {
  const res = await send(path, options);
  if (isApiError(res)) return res as unknown as T;
  if (!res.ok) return (await toApiError(res)) as unknown as T;
  if (res.status === 204) return {} as T;
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
};

/** Like request(), but list screens get an empty value instead of an error object. */
const requestOr = async <T>(path: string, fallback: T, options: RequestOptions = {}): Promise<T> => {
  const data = await request<any>(path, options);
  return isApiError(data) || data === null || data === undefined ? fallback : (data as T);
};

const filenameFrom = (header: string | null): string | null => {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header || '');
  return match ? decodeURIComponent(match[1]).replace(/[\\/:*?"<>|]/g, '_') : null;
};

/** Authenticated file download (PDF / CSV). A plain link cannot carry the access token. */
const download = async (path: string, fallbackName: string): Promise<{ ok: boolean; message?: string }> => {
  const res = await send(path);
  if (isApiError(res)) return { ok: false, message: res.detail };
  if (!res.ok) return { ok: false, message: (await toApiError(res)).detail };
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFrom(res.headers.get('Content-Disposition')) || fallbackName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { ok: true };
};

const query = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && value !== 'all') search.append(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};

/** One key per billing dialog, so a double click or a retried request can never create two documents. */
export const newIdempotencyKey = (): string => {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export interface LeadFilters {
  search?: string;
  stage?: string;
  source?: string;
  category?: string;
  dateFilter?: string;
  startDate?: string;
  endDate?: string;
  assignedTo?: string;
  followUpFilter?: string;
}

const leadFilterParams = (f: LeadFilters) => ({
  search: f.search,
  stage: f.stage,
  source: f.source,
  category: f.category,
  assigned_to: f.assignedTo,
  follow_up_filter: f.followUpFilter,
  date_filter: f.dateFilter,
  start_date: f.startDate,
  end_date: f.endDate,
});

// NOTE: several functions still accept a tenant id argument so existing screens keep compiling.
// It is ignored on purpose - the server takes the company from the signed-in session.
export const api = {
  // ---------------------------------------------------------------------------------------------
  // Authentication & session
  // ---------------------------------------------------------------------------------------------
  login: async (email: string, password: string) => {
    const res = await request('/auth/login', { method: 'POST', body: { email: (email || '').trim(), password } });
    if (!isApiError(res) && res.access_token) applySessionPayload(res);
    return res;
  },

  verifyMfa: async (mfaToken: string, code: string) => {
    const res = await request('/auth/mfa/verify', { method: 'POST', body: { mfa_token: mfaToken, code: code.trim() } });
    if (!isApiError(res) && res.access_token) applySessionPayload(res);
    return res;
  },

  /** Called once when the app loads: resumes the session from the HttpOnly cookie, if there is one. */
  restoreSession: async (): Promise<SessionState | null> => {
    // A temporary failure while the page loads (server restarting during a release, a dropped connection)
    // must not look like "signed out", so it is retried a few times before the sign-in page is shown.
    const waits = [600, 1500, 3000];
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await refreshSession();
      if (outcome !== 'unavailable' || attempt >= waits.length) break;
      await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
    }
    return session;
  },

  logout: async () => {
    try {
      await rawFetch('/auth/logout', { method: 'POST' });
    } catch {
      /* the local session is cleared regardless */
    }
    clearSession();
  },

  logoutEverywhere: async () => {
    const res = await request('/auth/logout-all', { method: 'POST' });
    clearSession();
    return res;
  },

  forgotPassword: (email: string) => request('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } }),

  resetPassword: (token: string, newPassword: string) =>
    request('/auth/reset-password', { method: 'POST', body: { token, new_password: newPassword } }),

  changePassword: async (data: { user_id?: string; current_password: string; new_password: string; confirm_password: string }) => {
    const res = await request('/profile/change-password', {
      method: 'POST',
      body: { current_password: data.current_password, new_password: data.new_password, confirm_password: data.confirm_password },
    });
    if (!isApiError(res) && res.access_token) applySessionPayload(res);
    return res;
  },

  mfaSetup: () => request<{ secret: string; otpauth_uri: string; qr_code: string } & Partial<ApiError>>('/auth/mfa/setup', { method: 'POST' }),

  mfaEnable: async (code: string) => {
    const res = await request('/auth/mfa/enable', { method: 'POST', body: { code: code.trim() } });
    if (!isApiError(res) && res.access_token) applySessionPayload(res);
    return res;
  },

  mfaDisable: async (password: string, code: string) => {
    const res = await request('/auth/mfa/disable', { method: 'POST', body: { password, code: code.trim() } });
    if (!isApiError(res) && res.access_token) applySessionPayload(res);
    return res;
  },

  getSessions: () => requestOr<any[]>('/auth/sessions', []),

  revokeSession: (sessionId: string) => request(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),

  // ---------------------------------------------------------------------------------------------
  // Platform administration (super admin)
  // ---------------------------------------------------------------------------------------------
  getSuperAdminStats: () => request('/super-admin/stats'),

  getSuperAdminCompanies: () => requestOr<any[]>('/super-admin/companies', []),

  createCompany: (payload: any) => request('/super-admin/companies', { method: 'POST', body: payload }),

  updateCompanyLicensing: (companyId: string, payload: any) =>
    request(`/super-admin/companies/${encodeURIComponent(companyId)}`, { method: 'PATCH', body: payload }),

  editCompanyFull: (companyId: string, payload: any) =>
    request(`/super-admin/companies/${encodeURIComponent(companyId)}`, { method: 'PUT', body: payload }),

  toggleCompanyStatus: (companyId: string, status: 'ACTIVE' | 'SUSPENDED') =>
    request(`/super-admin/companies/${encodeURIComponent(companyId)}/status`, { method: 'PATCH', body: { status } }),

  getSuperAdminCompanyIntegrations: (companyId: string) =>
    request(`/super-admin/companies/${encodeURIComponent(companyId)}/integrations`),

  resetCompanyAdminPassword: (companyId: string) =>
    request(`/super-admin/companies/${encodeURIComponent(companyId)}/reset-admin-password`, { method: 'POST' }),

  getPlatformAuditLogs: (params: { action?: string; status?: string; tenant_id?: string; skip?: number; limit?: number } = {}) =>
    requestOr<{ total: number; items: any[] }>(`/super-admin/audit-logs${query(params)}`, { total: 0, items: [] }),

  // ---------------------------------------------------------------------------------------------
  // Company integrations (IndiaMART, Meta, TradeIndia, Justdial, Website)
  // ---------------------------------------------------------------------------------------------
  getCompanyIntegrations: (_tenantId?: string) => request(`/tenants/${tenantId()}/integrations`),

  updateCompanyIntegrations: (_tenantId: string | undefined, integrations: Record<string, any>) =>
    request(`/tenants/${tenantId()}/integrations`, { method: 'PUT', body: { integrations } }),

  regenerateIntegrationKeys: (_tenantId?: string, provider = 'website') =>
    request(`/tenants/${tenantId()}/integrations/regenerate-keys${query({ provider })}`, { method: 'POST' }),

  /** Step-up authentication: the administrator re-enters their password to see a stored secret. */
  revealIntegrationSecrets: (provider: string, password: string) =>
    request(`/tenants/${tenantId()}/integrations/reveal`, { method: 'POST', body: { provider, password } }),

  syncIndiamartNow: () => request(`/tenants/${tenantId()}/integrations/indiamart/sync`, { method: 'POST' }),

  updateTenantProfile: (_tenantId: string | undefined, payload: any) =>
    request(`/tenants/${tenantId()}/profile`, { method: 'PUT', body: payload }),

  // ---------------------------------------------------------------------------------------------
  // Team & permissions
  // ---------------------------------------------------------------------------------------------
  getTeamMembers: (_tenantId?: string) => request('/team/members'),

  addTeamMember: (_tenantId: string | undefined, payload: any) => request('/team/members', { method: 'POST', body: payload }),

  updateTeamMember: (userId: string, payload: any) =>
    request(`/team/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: payload }),

  updateMemberPermissions: (userId: string, _tenantId: string | undefined, permissions: Record<string, boolean>) =>
    request(`/team/members/${encodeURIComponent(userId)}/permissions`, { method: 'PATCH', body: { permissions } }),

  resetMemberPassword: (userId: string) =>
    request(`/team/members/${encodeURIComponent(userId)}/reset-password`, { method: 'POST' }),

  resetMemberMfa: (userId: string) => request(`/team/members/${encodeURIComponent(userId)}/reset-mfa`, { method: 'POST' }),

  deleteTeamMember: (userId: string, _tenantId?: string) =>
    request(`/team/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  // ---------------------------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------------------------
  getDashboardMetrics: (_tenantId?: string, assignedTo?: string) =>
    request(`/analytics/dashboard${query({ assigned_to: assignedTo })}`),

  // ---------------------------------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------------------------------
  getLeads: (
    _tenantId?: string,
    search = '',
    stage = '',
    source = '',
    category = '',
    dateFilter = '',
    startDate = '',
    endDate = '',
    assignedTo = '',
    followUpFilter = '',
    paging: { skip?: number; limit?: number } = {}
  ) =>
    requestOr<{ total: number; items: Lead[] }>(
      `/leads/${query({
        ...leadFilterParams({ search, stage, source, category, dateFilter, startDate, endDate, assignedTo, followUpFilter }),
        skip: paging.skip,
        limit: paging.limit,
      })}`,
      { total: 0, items: [] }
    ),

  getLead: (leadId: string) => request<Lead & Partial<ApiError>>(`/leads/${encodeURIComponent(leadId)}`),

  getFollowupsSummary: (_tenantId?: string, assignedTo?: string) =>
    request(`/leads/followups/summary${query({ assigned_to: assignedTo })}`),

  scheduleFollowUp: (
    leadId: string,
    payload: { scheduled_at: string; follow_up_type: string; note: string; user_id?: string; user_name?: string },
    _tenantId?: string
  ) =>
    request(`/leads/${encodeURIComponent(leadId)}/followup`, {
      method: 'POST',
      body: { scheduled_at: payload.scheduled_at, follow_up_type: payload.follow_up_type, note: payload.note },
    }),

  completeFollowUp: (
    leadId: string,
    payload: { note?: string; follow_up_id?: string; completed_by_id?: string; completed_by_name?: string },
    _tenantId?: string
  ) =>
    request(`/leads/${encodeURIComponent(leadId)}/followup/complete`, {
      method: 'POST',
      body: { note: payload.note, follow_up_id: payload.follow_up_id },
    }),

  // who assigned the lead is recorded by the server from the session, not taken from the browser
  assignLead: (leadId: string, userId: string | null, note?: string, _assignedByName?: string, _tenantId?: string) =>
    request(`/leads/${encodeURIComponent(leadId)}/assign`, { method: 'POST', body: { user_id: userId, note } }),

  bulkAssignLeads: (leadIds: string[], userId: string | null, note?: string) =>
    request('/leads/bulk-assign', { method: 'POST', body: { lead_ids: leadIds, user_id: userId, note } }),

  updateLeadCategory: (leadId: string, category: string, note?: string, _tenantId?: string) =>
    request(`/leads/${encodeURIComponent(leadId)}/category`, { method: 'POST', body: { category, note } }),

  getKanbanBoard: (_tenantId?: string, assignedTo?: string, dateFilter?: string, startDate?: string, endDate?: string) =>
    requestOr<Record<string, Lead[]>>(
      `/leads/kanban${query({ assigned_to: assignedTo, date_filter: dateFilter, start_date: startDate, end_date: endDate })}`,
      {}
    ),

  createLead: (_tenantId: string | undefined, payload: any) => request('/leads/', { method: 'POST', body: payload }),

  updateLead: (leadId: string, payload: Record<string, any>) =>
    request(`/leads/${encodeURIComponent(leadId)}`, { method: 'PATCH', body: payload }),

  deleteLead: (leadId: string) => request(`/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' }),

  /** Recycle bin: leads that were deleted (they are kept on record and can be restored). */
  getDeletedLeads: (paging: { skip?: number; limit?: number } = {}) =>
    requestOr<{ total: number; items: Lead[] }>(`/leads/deleted${query(paging)}`, { total: 0, items: [] }),

  restoreLead: (leadId: string) => request(`/leads/${encodeURIComponent(leadId)}/restore`, { method: 'POST' }),

  updateLeadStage: (leadId: string, stage: string, note?: string, _tenantId?: string, lostReason?: string) =>
    request(`/leads/${encodeURIComponent(leadId)}/stage`, { method: 'POST', body: { stage, note, lost_reason: lostReason } }),

  addLeadActivity: (leadId: string, activity_type: string, note: string, _tenantId?: string) =>
    request(`/leads/${encodeURIComponent(leadId)}/activity`, { method: 'POST', body: { activity_type, note } }),

  exportLeadsCsv: (filters: LeadFilters = {}) => download(`/leads/export${query(leadFilterParams(filters))}`, 'leads.csv'),

  importLeadsCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request('/leads/import', { method: 'POST', form });
  },

  /** Administrator tool: pushes a sample marketplace lead through the real ingestion pipeline. */
  simulateLead: (source: string) => request('/leads/simulate', { method: 'POST', body: { source } }),

  sendFollowupWhatsAppAlerts: (_tenantId?: string, staffUserId?: string) =>
    request(`/leads/send-followup-whatsapp-alerts${query({ staff_user_id: staffUserId })}`, { method: 'POST' }),

  // ---------------------------------------------------------------------------------------------
  // Invoices & billing
  // ---------------------------------------------------------------------------------------------
  convertLeadToBill: (leadId: string, payload: any, _tenantId?: string, idempotencyKey?: string) =>
    request(`/invoices/from-lead/${encodeURIComponent(leadId)}`, {
      method: 'POST',
      body: payload,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),

  getInvoices: (
    _tenantId?: string,
    docType = '',
    extra: { payment_status?: string; search?: string; lead_id?: string; skip?: number; limit?: number } = {}
  ) =>
    requestOr<{ total: number; items: Invoice[] }>(`/invoices/${query({ document_type: docType, ...extra })}`, { total: 0, items: [] }),

  getInvoice: (invoiceId: string) => request<Invoice & Partial<ApiError>>(`/invoices/${encodeURIComponent(invoiceId)}`),

  recordPayment: (invoiceId: string, payload: any, _tenantId?: string) =>
    request(`/invoices/${encodeURIComponent(invoiceId)}/payments`, { method: 'POST', body: payload }),

  markInvoiceAsPaid: (invoiceId: string, paymentMode = 'UPI', _tenantId?: string, referenceNumber?: string) =>
    request(`/invoices/${encodeURIComponent(invoiceId)}/mark-as-paid${query({ payment_mode: paymentMode, reference_number: referenceNumber })}`, {
      method: 'POST',
    }),

  reversePayment: (invoiceId: string, paymentId: string, reason: string) =>
    request(`/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(paymentId)}/reverse`, {
      method: 'POST',
      body: { reason },
    }),

  cancelInvoice: (invoiceId: string, reason: string) =>
    request(`/invoices/${encodeURIComponent(invoiceId)}/cancel`, { method: 'POST', body: { reason } }),

  convertQuotationToInvoice: (invoiceId: string, payload: { due_date?: string; allow_additional_invoice?: boolean } = {}) =>
    request(`/invoices/${encodeURIComponent(invoiceId)}/convert-to-invoice`, { method: 'POST', body: payload }),

  /** Downloads the PDF with the user's session (a plain link could not be authenticated). */
  downloadInvoicePdf: (invoiceId: string, invoiceNumber?: string) =>
    download(`/invoices/${encodeURIComponent(invoiceId)}/pdf`, `${(invoiceNumber || 'document').replace(/[\\/]/g, '_')}.pdf`),

  // ---------------------------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------------------------
  getProducts: (_tenantId?: string) => requestOr<Product[]>('/products/', []),

  createProduct: (_tenantId: string | undefined, payload: any) => request('/products/', { method: 'POST', body: payload }),

  updateProduct: (productId: string, payload: any) =>
    request(`/products/${encodeURIComponent(productId)}`, { method: 'PATCH', body: payload }),

  deleteProduct: (productId: string) => request(`/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }),

  // ---------------------------------------------------------------------------------------------
  // Company profile, custom fields, pipeline stages
  // ---------------------------------------------------------------------------------------------
  getTenant: (_tenantId?: string) => request(`/tenants/${tenantId()}`),

  getCustomFields: (_tenantId?: string) => requestOr<any[]>(`/tenants/${tenantId()}/custom-fields`, []),

  addCustomField: (payload: { field_key: string; field_label: string; field_type: string; options?: string[] }) =>
    request(`/tenants/${tenantId()}/custom-fields`, { method: 'POST', body: payload }),

  deleteCustomField: (fieldId: string) =>
    request(`/tenants/${tenantId()}/custom-fields/${encodeURIComponent(fieldId)}`, { method: 'DELETE' }),

  getPipelineStages: (_tenantId?: string) => request(`/tenants/${tenantId()}/stages`),

  updatePipelineStages: (_tenantId: string | undefined, stages: PipelineStage[]) =>
    request(`/tenants/${tenantId()}/stages`, { method: 'PUT', body: { stages } }),

  // ---------------------------------------------------------------------------------------------
  // Masters
  // ---------------------------------------------------------------------------------------------
  getGlobalMasters: () => requestOr<Record<string, any[]>>('/masters/global', {}),

  getGstStates: () => requestOr<Array<{ code: string; name: string }>>('/masters/states', []),

  createGlobalMaster: (payload: { master_type: string; code: string; name: string; extra_data?: any; display_order?: number }) =>
    request('/masters/global', { method: 'POST', body: payload }),

  deleteGlobalMaster: (itemId: string) => request(`/masters/global/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),

  getCompanyMasters: (_tenantId?: string) => request(`/masters/company/${tenantId()}`),

  updateCompanyMasters: (_tenantId: string | undefined, masters: Record<string, any>) =>
    request(`/masters/company/${tenantId()}`, { method: 'PUT', body: { masters } }),

  // ---------------------------------------------------------------------------------------------
  // My profile
  // ---------------------------------------------------------------------------------------------
  getUserProfile: (_userId?: string) => request<UserProfile & Partial<ApiError>>('/profile/me'),

  updateUserProfile: async (_userId: string | undefined, data: any) => {
    const res = await request('/profile/me', { method: 'PUT', body: data });
    if (!isApiError(res) && res.user) patchSessionUser(res.user);
    return res;
  },

  // ---------------------------------------------------------------------------------------------
  // Communication gateways (SMS / WhatsApp / e-mail)
  // ---------------------------------------------------------------------------------------------
  getCommunicationSettings: (_tenantId?: string) => request<CommunicationSettings & Partial<ApiError>>('/settings/communication'),

  updateCommunicationSettings: (_tenantId: string | undefined, data: any) =>
    request('/settings/communication', { method: 'PUT', body: data }),

  testCommunication: (_tenantId: string | undefined, data: { channel: string; recipient: string; message?: string }) =>
    request('/settings/communication/test', { method: 'POST', body: data }),

  // ---------------------------------------------------------------------------------------------
  // Audit trail
  // ---------------------------------------------------------------------------------------------
  getAuditLogs: (params: { action?: string; status?: string; actor_id?: string; skip?: number; limit?: number } = {}) =>
    requestOr<{ total: number; items: any[] }>(`/audit/logs${query(params)}`, { total: 0, items: [] }),
};
