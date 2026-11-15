import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { 
  Building2, 
  Users, 
  Plus, 
  ShieldCheck, 
  TrendingUp, 
  Receipt, 
  Search, 
  X, 
  Sliders, 
  CheckCircle2, 
  AlertTriangle,
  Lock,
  Sparkles,
  Edit,
  Power,
  Radio,
  Eye,
  Check,
  AlertCircle
} from 'lucide-react';

export const SuperAdminPortal: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCompanyForLimit, setSelectedCompanyForLimit] = useState<any>(null);

  // Edit Company State
  const [selectedCompanyForEdit, setSelectedCompanyForEdit] = useState<any>(null);
  const [editCompName, setEditCompName] = useState('');
  const [editCompType, setEditCompType] = useState('manufacturing');
  const [editCompPlan, setEditCompPlan] = useState('Professional');
  const [editCompLimit, setEditCompLimit] = useState<number>(5);
  const [editCompStatus, setEditCompStatus] = useState('ACTIVE');
  const [editCompGstin, setEditCompGstin] = useState('');
  const [editCompPhone, setEditCompPhone] = useState('');
  const [editCompEmail, setEditCompEmail] = useState('');
  const [editCompCity, setEditCompCity] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // View Integrations Read-Only State (Super admin bs dekh paye)
  const [selectedCompanyForIntegrations, setSelectedCompanyForIntegrations] = useState<any>(null);
  const [integrationsData, setIntegrationsData] = useState<any>(null);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);

  // New Company Form
  const [companyName, setCompanyName] = useState('');
  const [companyType, setCompanyType] = useState('manufacturing');
  const [maxUsers, setMaxUsers] = useState<number>(5);
  const [planName, setPlanName] = useState('Professional');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('password123');
  const [gstin, setGstin] = useState('');
  const [city, setCity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Update Limit Form
  const [editLimit, setEditLimit] = useState<number>(5);
  const [editStatus, setEditStatus] = useState<string>('ACTIVE');
  const [editPlan, setEditPlan] = useState<string>('Professional');
  const [isUpdating, setIsUpdating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, compRes] = await Promise.all([
        api.getSuperAdminStats(),
        api.getSuperAdminCompanies()
      ]);
      setStats(statsRes);
      if (Array.isArray(compRes)) setCompanies(compRes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const res = await api.createCompany({
        company_name: companyName,
        company_type: companyType,
        max_users_limit: Number(maxUsers),
        plan_name: planName,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        gstin: gstin || undefined,
        city: city || undefined,
      });

      if (res.status === 'success') {
        setSuccessMsg(res.message);
        setShowCreateModal(false);
        setCompanyName('');
        setAdminName('');
        setAdminEmail('');
        setGstin('');
        loadData();
        setTimeout(() => setSuccessMsg(''), 4000);
      } else {
        setErrorMsg(res.detail || 'Failed to create company.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Full Edit Modal
  const handleOpenEditModal = (c: any) => {
    setSelectedCompanyForEdit(c);
    setEditCompName(c.company_name || '');
    setEditCompType(c.company_type || 'manufacturing');
    setEditCompPlan(c.plan_name || 'Professional');
    setEditCompLimit(c.max_users_limit || 5);
    setEditCompStatus(c.status || 'ACTIVE');
    setEditCompGstin(c.gstin || '');
    setEditCompPhone(c.phone || '');
    setEditCompEmail(c.email || '');
    setEditCompCity(c.city || '');
  };

  // Save Full Edit
  const handleSaveCompanyEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyForEdit) return;
    setIsEditing(true);
    try {
      const res = await api.editCompanyFull(selectedCompanyForEdit.id, {
        company_name: editCompName,
        company_type: editCompType,
        plan_name: editCompPlan,
        max_users_limit: Number(editCompLimit),
        status: editCompStatus,
        gstin: editCompGstin,
        phone: editCompPhone,
        email: editCompEmail,
        city: editCompCity
      });

      if (res.status === 'success') {
        setSuccessMsg(res.message);
        setSelectedCompanyForEdit(null);
        loadData();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsEditing(false);
    }
  };

  // Quick 1-Click Activate / Inactivate (Suspend)
  const handleToggleStatus = async (c: any) => {
    const nextStatus = c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.toggleCompanyStatus(c.id, nextStatus);
      loadData();
      setSuccessMsg(`Company '${c.company_name}' is now ${nextStatus === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE (Suspended)'}`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  // Open Read-Only Integrations Inspector for Super Admin
  const handleOpenIntegrations = async (c: any) => {
    setSelectedCompanyForIntegrations(c);
    setLoadingIntegrations(true);
    try {
      const res = await api.getSuperAdminCompanyIntegrations(c.id);
      setIntegrationsData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingIntegrations(false);
    }
  };

  const handleUpdateLimitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyForLimit) return;
    setIsUpdating(true);
    try {
      await api.updateCompanyLicensing(selectedCompanyForLimit.id, {
        max_users_limit: Number(editLimit),
        status: editStatus,
        plan_name: editPlan
      });
      setSelectedCompanyForLimit(null);
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdating(false);
    }
  };

  const filteredCompanies = companies.filter((c) =>
    c.company_name?.toLowerCase().includes(search.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
    (c.city && c.city.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Top Banner / Super Admin Command Center */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white border border-indigo-500/20 shadow-2xl">
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold mb-2">
              <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
              <span>Lead-to-Cash Central Authority</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Platform Tenants & User Licensing Manager
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
              Create and manage client companies, activate or suspend access, define team user limits, and monitor live lead sources & billing.
            </p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-bold text-xs shadow-lg shadow-indigo-500/25 transition-all transform hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" />
            <span>Create New Company</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* 4 Super Admin High-Level Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Companies</span>
            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Building2 className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{stats?.total_companies || companies.length}</span>
            <span className="text-xs text-emerald-600 font-bold">{stats?.active_companies || companies.filter(c => c.status === 'ACTIVE').length} Active</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Platform Users</span>
            <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{stats?.total_platform_users || 0}</span>
            <span className="text-xs text-blue-600 font-bold">Licensed Seats</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Leads Ingested</span>
            <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{stats?.total_leads_processed || 0}</span>
            <span className="text-xs text-slate-400">All Sources</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Platform Billing</span>
            <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">
              ₹{Number(stats?.total_platform_billing_volume || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-amber-600 font-bold">Gross Invoiced</span>
          </div>
        </div>
      </div>

      {/* Companies Management Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Table Header Controls */}
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50/60">
          <div>
            <h3 className="font-bold text-base text-slate-900">Client Companies & Tenant Directory</h3>
            <p className="text-xs text-slate-500">Edit company profiles, activate/inactivate tenants, and view API integrations.</p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search company or admin email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">Loading companies directory...</div>
        ) : filteredCompanies.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-xs space-y-2">
            <Building2 className="h-10 w-10 mx-auto text-slate-300" />
            <p>No companies found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-4">Company Profile</th>
                  <th className="p-4">Business Type</th>
                  <th className="p-4">Plan</th>
                  <th className="p-4">Licensed Seat Limit</th>
                  <th className="p-4 text-center">Status & Quick Toggle</th>
                  <th className="p-4 text-center">Marketplace APIs</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCompanies.map((c) => {
                  const usedPct = c.max_users_limit > 0 ? (c.current_users / c.max_users_limit) * 100 : 0;
                  const isFull = c.current_users >= c.max_users_limit;
                  const isActive = c.status === 'ACTIVE';

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-4">
                        <div className="font-extrabold text-sm text-slate-900">{c.company_name}</div>
                        <div className="text-[11px] text-slate-500">{c.email || 'Admin: N/A'}</div>
                        {c.gstin && <span className="text-[10px] text-slate-400 font-mono">GST: {c.gstin}</span>}
                      </td>

                      <td className="p-4">
                        <span className="capitalize font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                          {c.company_type?.replace('_', ' ')}
                        </span>
                      </td>

                      <td className="p-4">
                        <span className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
                          {c.plan_name}
                        </span>
                      </td>

                      <td className="p-4 w-44">
                        <div className="space-y-1">
                          <div className="flex justify-between font-bold text-[11px]">
                            <span className={isFull ? 'text-amber-600' : 'text-slate-700'}>
                              {c.current_users} / {c.max_users_limit} Seats
                            </span>
                            <span className="text-slate-400">{usedPct.toFixed(0)}%</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isFull ? 'bg-amber-500' : 'bg-indigo-600'
                              }`}
                              style={{ width: `${Math.min(100, usedPct)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Status + 1-Click Activate / Inactive Toggle */}
                      <td className="p-4 text-center">
                        <div className="inline-flex flex-col items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}>
                            {isActive ? 'ACTIVE' : 'INACTIVE (Suspended)'}
                          </span>

                          <button
                            onClick={() => handleToggleStatus(c)}
                            title={isActive ? 'Click to Inactivate/Suspend Company' : 'Click to Activate Company'}
                            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-colors ${
                              isActive
                                ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            <Power className="h-3 w-3" />
                            <span>{isActive ? 'Make Inactive' : 'Activate'}</span>
                          </button>
                        </div>
                      </td>

                      {/* Read-Only Integrations Button (Super Admin can only view) */}
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleOpenIntegrations(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-600" />
                          <span>View APIs</span>
                        </button>
                      </td>

                      {/* Actions: Edit Company Full & Manage Limits */}
                      <td className="p-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditModal(c)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors shadow-sm"
                            title="Edit Company Details"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedCompanyForLimit(c);
                              setEditLimit(c.max_users_limit);
                              setEditStatus(c.status);
                              setEditPlan(c.plan_name);
                            }}
                            className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors shadow-sm"
                            title="Adjust Team Seat Limits"
                          >
                            <span>Quota</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Full Edit Company Modal */}
      {selectedCompanyForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Edit className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">Edit Company Profile & Settings</h3>
                  <p className="text-[11px] text-slate-500">Update company identity, subscription plan, and user limits.</p>
                </div>
              </div>
              <button onClick={() => setSelectedCompanyForEdit(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCompanyEdit} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Company / Organization Name *</label>
                <input
                  type="text"
                  required
                  value={editCompName}
                  onChange={(e) => setEditCompName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Business Type</label>
                  <select
                    value={editCompType}
                    onChange={(e) => setEditCompType(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800"
                  >
                    <option value="manufacturing">B2B Manufacturing</option>
                    <option value="trading">B2B Trading / Wholesale</option>
                    <option value="services">IT & Professional Services</option>
                    <option value="real_estate">Real Estate & Construction</option>
                    <option value="agency">Agency / Marketing</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Subscription Plan</label>
                  <select
                    value={editCompPlan}
                    onChange={(e) => setEditCompPlan(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800"
                  >
                    <option value="Starter">Starter</option>
                    <option value="Professional">Professional</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Max Users Quota *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={editCompLimit}
                    onChange={(e) => setEditCompLimit(Number(e.target.value))}
                    className="w-full border border-indigo-200 bg-indigo-50/40 rounded-xl px-3 py-2 font-bold text-indigo-900"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Account Status</label>
                  <select
                    value={editCompStatus}
                    onChange={(e) => setEditCompStatus(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800 font-bold"
                  >
                    <option value="ACTIVE">ACTIVE (Enabled)</option>
                    <option value="SUSPENDED">SUSPENDED (Inactive)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">GSTIN Number</label>
                  <input
                    type="text"
                    value={editCompGstin}
                    onChange={(e) => setEditCompGstin(e.target.value)}
                    placeholder="24ABCDE1234F1Z5"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 uppercase"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">City / Region</label>
                  <input
                    type="text"
                    value={editCompCity}
                    onChange={(e) => setEditCompCity(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Official Email</label>
                  <input
                    type="email"
                    value={editCompEmail}
                    onChange={(e) => setEditCompEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Official Phone</label>
                  <input
                    type="text"
                    value={editCompPhone}
                    onChange={(e) => setEditCompPhone(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCompanyForEdit(null)}
                  className="px-4 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditing}
                  className="px-5 py-2.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md disabled:opacity-50"
                >
                  {isEditing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Read-Only Integrations Inspector (Super Admin bs dekh paye) */}
      {selectedCompanyForIntegrations && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Eye className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">Marketplace APIs Monitor</h3>
                  <p className="text-[11px] text-slate-500">
                    Read-only view for Super Admin. Credentials are maintained by {selectedCompanyForIntegrations.company_name}.
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedCompanyForIntegrations(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingIntegrations ? (
              <div className="py-12 text-center text-slate-400 text-xs">Loading integration status...</div>
            ) : integrationsData ? (
              <div className="space-y-3 text-xs">
                {/* IndiaMART */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                      IndiaMART
                    </span>
                    <div>
                      <div className="font-bold text-slate-900">Push API & Webhook</div>
                      <div className="text-[10px] text-slate-400">
                        {integrationsData.integrations?.indiamart?.has_key ? 'API Key Configured by Company' : 'No API Key Entered'}
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    integrationsData.integrations?.indiamart?.is_enabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-200 text-slate-600 border-slate-300'
                  }`}>
                    {integrationsData.integrations?.indiamart?.is_enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                {/* Facebook Lead Ads */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      Facebook
                    </span>
                    <div>
                      <div className="font-bold text-slate-900">Meta Lead Ads Webhook</div>
                      <div className="text-[10px] text-slate-400">
                        {integrationsData.integrations?.facebook?.has_key ? 'Access Token Configured' : 'Not Connected'}
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    integrationsData.integrations?.facebook?.is_enabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-200 text-slate-600 border-slate-300'
                  }`}>
                    {integrationsData.integrations?.facebook?.is_enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                {/* TradeIndia */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      TradeIndia
                    </span>
                    <div>
                      <div className="font-bold text-slate-900">Inquiry Feed API</div>
                      <div className="text-[10px] text-slate-400">
                        {integrationsData.integrations?.tradeindia?.has_key ? 'Profile ID & Key Configured' : 'Not Configured'}
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    integrationsData.integrations?.tradeindia?.is_enabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-200 text-slate-600 border-slate-300'
                  }`}>
                    {integrationsData.integrations?.tradeindia?.is_enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                {/* Justdial */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                      Justdial
                    </span>
                    <div>
                      <div className="font-bold text-slate-900">Lead Push API</div>
                      <div className="text-[10px] text-slate-400">
                        {integrationsData.integrations?.justdial?.has_key ? 'API Key Configured' : 'Not Configured'}
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    integrationsData.integrations?.justdial?.is_enabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-200 text-slate-600 border-slate-300'
                  }`}>
                    {integrationsData.integrations?.justdial?.is_enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                {/* Website Ingestion */}
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Website
                    </span>
                    <div>
                      <div className="font-bold text-slate-900">Custom Webhook Ingestion</div>
                      <div className="text-[10px] text-slate-400">
                        Unique Endpoint: /api/v1/webhooks/website/{selectedCompanyForIntegrations.id}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                    Active
                  </span>
                </div>
              </div>
            ) : null}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedCompanyForIntegrations(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Create New Company */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">Register New Client Company</h3>
                  <p className="text-[11px] text-slate-500">Create tenant, assign user limits, and generate Admin login.</p>
                </div>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateCompany} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="font-semibold text-slate-700 block mb-1">Company / Business Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Reliance Industrial Gears"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Business Model Type</label>
                  <select
                    value={companyType}
                    onChange={(e) => setCompanyType(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="manufacturing">B2B Manufacturing</option>
                    <option value="trading">B2B Trading / Wholesale</option>
                    <option value="services">IT & Professional Services</option>
                    <option value="real_estate">Real Estate & Construction</option>
                    <option value="agency">Agency / Marketing</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Max Users Allowed (Quota) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={maxUsers}
                    onChange={(e) => setMaxUsers(Number(e.target.value))}
                    className="w-full border border-indigo-300 bg-indigo-50/40 font-bold text-indigo-900 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Initial Company Admin Credentials */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                  Company Admin Login Credentials
                </span>

                <div>
                  <label className="text-slate-600 block mb-1">Admin Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Vikram Patel"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-800"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-600 block mb-1">Admin Email *</label>
                    <input
                      type="email"
                      required
                      placeholder="admin@company.com"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1">Password *</label>
                    <input
                      type="text"
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-800 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-700 font-semibold block mb-1">GSTIN Number</label>
                  <input
                    type="text"
                    placeholder="24ABCDE1234F1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 uppercase"
                  />
                </div>
                <div>
                  <label className="text-slate-700 font-semibold block mb-1">City</label>
                  <input
                    type="text"
                    placeholder="e.g. Ahmedabad"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Registering...' : 'Register Company & Issue Limit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Edit User Quota */}
      {selectedCompanyForLimit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-900">Manage Company Licensing</h3>
              </div>
              <button onClick={() => setSelectedCompanyForLimit(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <span className="text-slate-400 font-medium">Company:</span>
              <p className="font-bold text-slate-900 text-sm">{selectedCompanyForLimit.company_name}</p>
              <p className="text-slate-500 text-[11px] mt-0.5">Current Active Users: <strong>{selectedCompanyForLimit.current_users}</strong></p>
            </div>

            <form onSubmit={handleUpdateLimitSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Maximum Users Allowed (Team Seats Quota)
                </label>
                <input
                  type="number"
                  min={selectedCompanyForLimit.current_users || 1}
                  required
                  value={editLimit}
                  onChange={(e) => setEditLimit(Number(e.target.value))}
                  className="w-full border border-indigo-300 bg-indigo-50/30 rounded-xl px-3 py-2 text-base font-black text-indigo-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Company admin cannot create more users than this allowed seat limit.
                </span>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Subscription Plan</label>
                <select
                  value={editPlan}
                  onChange={(e) => setEditPlan(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800"
                >
                  <option value="Starter">Starter (Up to 3 Users)</option>
                  <option value="Professional">Professional (Up to 10 Users)</option>
                  <option value="Enterprise">Enterprise (Unlimited / Custom)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tenant Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800 font-semibold"
                >
                  <option value="ACTIVE">ACTIVE (Full Platform Access)</option>
                  <option value="SUSPENDED">SUSPENDED (Block Company Login)</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCompanyForLimit(null)}
                  className="px-4 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50"
                >
                  {isUpdating ? 'Saving...' : 'Update Quota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
