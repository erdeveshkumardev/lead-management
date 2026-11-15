const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8002/api/v1';

export const DEFAULT_TENANT_ID = 'demo_tenant_01';

export interface CurrentUser {
  id: string;
  full_name: string;
  email: string;
  role: 'super_admin' | 'company_admin' | 'manager' | 'staff';
  tenant_id: string;
  permissions: Record<string, boolean>;
}

export interface TenantInfo {
  id: string;
  company_name: string;
  company_type: string;
  plan_name: string;
  max_users_limit: number;
  gstin?: string;
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
  pincode?: string;
  address?: string;
  gstin?: string;
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
  timeline: Array<{
    activity_type: string;
    note: string;
    performed_by_name?: string;
    timestamp: string;
  }>;
  created_at: string;
}

export interface Invoice {
  _id: string;
  invoice_number: string;
  document_type: 'QUOTATION' | 'TAX_INVOICE' | 'PROFORMA';
  lead_id?: string;
  seller: {
    name: string;
    company_name: string;
    gstin?: string;
    phone?: string;
  };
  customer: {
    name: string;
    company_name?: string;
    gstin?: string;
    phone?: string;
    state?: string;
  };
  invoice_date: string;
  due_date?: string;
  items: Array<{
    name: string;
    hsn_sac_code?: string;
    quantity: number;
    unit: string;
    unit_price: number;
    taxable_amount: number;
    gst_rate: number;
    total_amount: number;
  }>;
  financials: {
    taxable_subtotal: number;
    total_cgst: number;
    total_sgst: number;
    total_igst: number;
    total_tax: number;
    grand_total: number;
    paid_amount: number;
    balance_due: number;
  };
  payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  payments: Array<any>;
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

export const api = {
  // Auth & Roles
  login: async (email: string, password = 'password123') => {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: (email || '').trim(), password: password || 'password123' })
    });
    return res.json();
  },

  getDemoAccounts: async () => {
    const res = await fetch(`${API_BASE_URL}/auth/demo-accounts`);
    return res.json();
  },

  // Super Admin
  getSuperAdminStats: async () => {
    const res = await fetch(`${API_BASE_URL}/super-admin/stats`);
    return res.json();
  },

  getSuperAdminCompanies: async () => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies`);
    return res.json();
  },

  createCompany: async (payload: any) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  updateCompanyLicensing: async (tenantId: string, payload: any) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  editCompanyFull: async (tenantId: string, payload: any) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${tenantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  toggleCompanyStatus: async (tenantId: string, status: 'ACTIVE' | 'SUSPENDED') => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${tenantId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    return res.json();
  },

  getSuperAdminCompanyIntegrations: async (tenantId: string) => {
    const res = await fetch(`${API_BASE_URL}/super-admin/companies/${tenantId}/integrations`);
    return res.json();
  },

  // Company API Integrations (IndiaMART, Facebook, TradeIndia, Justdial, Website)
  getCompanyIntegrations: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/integrations`);
    return res.json();
  },

  updateCompanyIntegrations: async (tenantId = DEFAULT_TENANT_ID, integrations: Record<string, any>) => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/integrations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrations })
    });
    return res.json();
  },

  regenerateIntegrationKeys: async (tenantId = DEFAULT_TENANT_ID, provider = 'website') => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/integrations/regenerate-keys?provider=${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    return res.json();
  },

  updateTenantProfile: async (tenantId = DEFAULT_TENANT_ID, payload: any) => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  // Company Team & Permissions
  getTeamMembers: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/team/members?tenant_id=${tenantId}`);
    return res.json();
  },

  addTeamMember: async (tenantId: string, payload: any) => {
    const res = await fetch(`${API_BASE_URL}/team/members?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  updateMemberPermissions: async (userId: string, tenantId: string, permissions: Record<string, boolean>) => {
    const res = await fetch(`${API_BASE_URL}/team/members/${userId}/permissions?tenant_id=${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions })
    });
    return res.json();
  },

  deleteTeamMember: async (userId: string, tenantId: string) => {
    const res = await fetch(`${API_BASE_URL}/team/members/${userId}?tenant_id=${tenantId}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  // Analytics
  getDashboardMetrics: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/analytics/dashboard?tenant_id=${tenantId}`);
    return res.json();
  },

  // Leads
  getLeads: async (
    tenantId = DEFAULT_TENANT_ID,
    search = '',
    stage = '',
    source = '',
    category = '',
    dateFilter = '',
    startDate = '',
    endDate = '',
    assignedTo = ''
  ) => {
    const params = new URLSearchParams({ tenant_id: tenantId });
    if (search) params.append('search', search);
    if (stage && stage !== 'all') params.append('stage', stage);
    if (source && source !== 'all') params.append('source', source);
    if (category && category !== 'all') params.append('category', category);
    if (assignedTo && assignedTo !== 'all') params.append('assigned_to', assignedTo);
    if (dateFilter && dateFilter !== 'all') params.append('date_filter', dateFilter);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const res = await fetch(`${API_BASE_URL}/leads/?${params.toString()}`);
    return res.json();
  },

  assignLead: async (
    leadId: string,
    userId: string | null,
    note?: string,
    assignedByName?: string,
    tenantId = DEFAULT_TENANT_ID
  ) => {
    const res = await fetch(`${API_BASE_URL}/leads/${leadId}/assign?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        note,
        assigned_by_name: assignedByName
      })
    });
    return res.json();
  },

  updateLeadCategory: async (leadId: string, category: string, note?: string, tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/leads/${leadId}/category?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, note })
    });
    return res.json();
  },

  getKanbanBoard: async (
    tenantId = DEFAULT_TENANT_ID,
    dateFilter?: string,
    startDate?: string,
    endDate?: string
  ) => {
    const params = new URLSearchParams({ tenant_id: tenantId });
    if (dateFilter && dateFilter !== 'all') params.append('date_filter', dateFilter);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const res = await fetch(`${API_BASE_URL}/leads/kanban?${params.toString()}`);
    return res.json();
  },

  createLead: async (tenantId = DEFAULT_TENANT_ID, payload: any) => {
    const res = await fetch(`${API_BASE_URL}/leads/?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  updateLeadStage: async (leadId: string, stage: string, note?: string, tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/leads/${leadId}/stage?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, note })
    });
    return res.json();
  },

  addLeadActivity: async (leadId: string, activity_type: string, note: string, tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/leads/${leadId}/activity?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_type, note })
    });
    return res.json();
  },

  // Invoices & Billing
  convertLeadToBill: async (leadId: string, payload: any, tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/invoices/from-lead/${leadId}?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  getInvoices: async (tenantId = DEFAULT_TENANT_ID, docType = '') => {
    const params = new URLSearchParams({ tenant_id: tenantId });
    if (docType) params.append('document_type', docType);
    const res = await fetch(`${API_BASE_URL}/invoices/?${params.toString()}`);
    return res.json();
  },

  recordPayment: async (invoiceId: string, payload: any, tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/invoices/${invoiceId}/payments?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  getInvoicePdfUrl: (invoiceId: string, tenantId = DEFAULT_TENANT_ID) => {
    return `${API_BASE_URL}/invoices/${invoiceId}/pdf?tenant_id=${tenantId}`;
  },

  // Products
  getProducts: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/products/?tenant_id=${tenantId}`);
    return res.json();
  },

  createProduct: async (tenantId = DEFAULT_TENANT_ID, payload: any) => {
    const res = await fetch(`${API_BASE_URL}/products/?tenant_id=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  // Custom Fields & Tenant Profile
  getTenant: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}`);
    return res.json();
  },

  getCustomFields: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/custom-fields`);
    return res.json();
  },

  // Custom Pipeline Stages per Company
  getPipelineStages: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/stages`);
    return res.json();
  },

  updatePipelineStages: async (tenantId = DEFAULT_TENANT_ID, stages: PipelineStage[]) => {
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/stages`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stages })
    });
    return res.json();
  },

  // -------------------------------------------------------------
  // SUPER ADMIN & COMPANY MASTERS
  // -------------------------------------------------------------
  getGlobalMasters: async () => {
    const res = await fetch(`${API_BASE_URL}/masters/global`);
    return res.json();
  },

  createGlobalMaster: async (payload: { master_type: string; code: string; name: string; extra_data?: any; display_order?: number }) => {
    const res = await fetch(`${API_BASE_URL}/masters/global`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  deleteGlobalMaster: async (itemId: string) => {
    const res = await fetch(`${API_BASE_URL}/masters/global/${itemId}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  getCompanyMasters: async (tenantId = DEFAULT_TENANT_ID) => {
    const res = await fetch(`${API_BASE_URL}/masters/company/${tenantId}`);
    return res.json();
  },

  updateCompanyMasters: async (tenantId = DEFAULT_TENANT_ID, masters: Record<string, any>) => {
    const res = await fetch(`${API_BASE_URL}/masters/company/${tenantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masters })
    });
    return res.json();
  }
};
