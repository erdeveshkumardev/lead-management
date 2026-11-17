import React, { useEffect, useState } from 'react';
import { api, TeamMember } from '../../services/api';
import { ConfirmModal } from '../../components/ConfirmModal';
import { 
  Users, 
  Plus, 
  Shield, 
  Check, 
  X, 
  Sliders, 
  AlertCircle, 
  Lock, 
  Sparkles,
  Trash2,
  CheckCircle2
} from 'lucide-react';

interface TeamManagerProps {
  tenantId: string;
}

export const TeamManager: React.FC<TeamManagerProps> = ({ tenantId }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMemberForPerms, setSelectedMemberForPerms] = useState<TeamMember | null>(null);

  // Add Member Form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password123');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'company_admin' | 'manager' | 'staff'>('staff');
  const [designation, setDesignation] = useState('Sales Executive');
  const [customDesignation, setCustomDesignation] = useState('');
  const [department, setDepartment] = useState('Sales & Business Development');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [newMemberCredentials, setNewMemberCredentials] = useState<{ name: string; email: string; temp_password: string } | null>(null);

  // Permission toggles
  const [permsState, setPermsState] = useState<Record<string, boolean>>({});
  const [isSavingPerms, setIsSavingPerms] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadTeam = async () => {
    setLoading(true);
    try {
      const res = await api.getTeamMembers(tenantId);
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeam();
  }, [tenantId]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');
    const effectiveDesignation = designation === 'custom' ? customDesignation.trim() : designation;

    try {
      const res = await api.addTeamMember(tenantId, {
        full_name: fullName,
        email,
        password,
        phone: phone || undefined,
        role,
        designation: effectiveDesignation || undefined,
        department: department || undefined,
      });

      if (res.status === 'success') {
        setSuccessMsg(res.message);
        setShowAddModal(false);
        setNewMemberCredentials({
          name: fullName,
          email,
          temp_password: res.temp_password || password
        });
        setFullName('');
        setEmail('');
        setPhone('');
        setCustomDesignation('');
        loadTeam();
      } else {
        setErrorMsg(res.detail || 'Failed to add team member.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPermsModal = (member: TeamMember) => {
    setSelectedMemberForPerms(member);
    setPermsState({ ...(member.permissions || {}) });
  };

  const handleTogglePerm = (key: string) => {
    setPermsState((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSavePermissions = async () => {
    if (!selectedMemberForPerms) return;
    setIsSavingPerms(true);
    try {
      await api.updateMemberPermissions(selectedMemberForPerms._id, tenantId, permsState);
      setSelectedMemberForPerms(null);
      loadTeam();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingPerms(false);
    }
  };

  const handleDeleteMember = (memberId: string) => {
    setDeletingMemberId(memberId);
  };

  const confirmDeleteMember = async () => {
    if (!deletingMemberId) return;
    setIsDeleting(true);
    try {
      await api.deleteTeamMember(deletingMemberId, tenantId);
      setDeletingMemberId(null);
      loadTeam();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const currentCount = data?.current_users_count || 0;
  const maxLimit = data?.max_users_limit || 5;
  const isSeatFull = currentCount >= maxLimit;
  const usedPct = maxLimit > 0 ? (currentCount / maxLimit) * 100 : 0;

  const PERMISSION_DEFINITIONS = [
    { key: 'leads_view_all', label: 'View All Company Leads', desc: 'Can see all leads across entire company vs only leads assigned to self' },
    { key: 'leads_create_edit', label: 'Create & Edit Leads', desc: 'Can add new inquiries, update status, and log activity notes' },
    { key: 'leads_delete', label: 'Delete Leads', desc: 'Permission to delete lead records from database' },
    { key: 'billing_convert', label: 'Convert Leads to Bills', desc: 'Can click 1-Click Convert to Bill and generate GST Tax Invoices & Quotations' },
    { key: 'billing_view', label: 'View All Invoices & Ledger', desc: 'Access to download PDF invoices and view customer balances' },
    { key: 'billing_payments', label: 'Record Payments', desc: 'Permission to record incoming customer payments, UTR, and issue receipts' },
    { key: 'team_manage', label: 'Manage Team Members', desc: 'Permission to add staff and manage team seats' },
    { key: 'products_manage', label: 'Manage Product Catalog', desc: 'Add or modify items, HSN/SAC codes, and GST rates' },
    { key: 'analytics_view', label: 'Access Financial Analytics', desc: 'View revenue dashboard, collection rates, and pipeline performance' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header & Seats Usage Bar */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold mb-1">
            <Users className="h-3 w-3" />
            <span>Company Team & Permission Manager</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">User Seats & Granular Permissions</h2>
          <p className="text-xs text-slate-500">
            Control roles (Managers, Staff/Sales Reps) and customize exact action permissions per user.
          </p>
        </div>

        {/* Quota Widget */}
        <div className="w-full sm:w-80 bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
          <div className="flex justify-between items-center text-xs font-bold">
            <span className="text-slate-700">Team Seats Allowed:</span>
            <span className={isSeatFull ? 'text-amber-600' : 'text-blue-700'}>
              {currentCount} of {maxLimit} Seats Used
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isSeatFull ? 'bg-amber-500' : 'bg-gradient-to-r from-blue-600 to-indigo-600'
              }`}
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] text-slate-400">
            <span>{data?.remaining_seats} remaining seats</span>
            {isSeatFull && <span className="text-amber-600 font-bold">Limit Reached</span>}
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Credentials & Email Dispatch Notice Banner */}
      {newMemberCredentials && (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex items-start justify-between gap-3 text-xs shadow-sm">
          <div className="space-y-1">
            <span className="font-bold text-emerald-950 flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Team Member Added & Welcome Email Dispatched!</span>
            </span>
            <p className="text-emerald-800">
              An invitation email has been sent to <strong>{newMemberCredentials.email}</strong> with their login link and temporary password.
            </p>
            <div className="mt-2 bg-white px-3 py-1.5 rounded-xl border border-emerald-300 inline-block font-mono text-slate-800">
              Temporary Password: <strong className="text-indigo-600 select-all font-bold">{newMemberCredentials.temp_password}</strong>
            </div>
            <p className="text-[11px] text-emerald-700 italic block pt-0.5">
              💡 When they sign in for the first time, a setup prompt will guide them to set their permanent password in their profile.
            </p>
          </div>
          <button 
            onClick={() => setNewMemberCredentials(null)} 
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Team Members List */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
          <div>
            <h3 className="font-bold text-sm text-slate-900">Active Team Members</h3>
            <p className="text-[11px] text-slate-500">Click 'Permissions' to toggle exact module access.</p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            disabled={isSeatFull}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            <span>Add Team Member</span>
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-xs">Loading team members...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-4">User</th>
                  <th className="p-4">Designation & Dept</th>
                  <th className="p-4">Role</th>
                  <th className="p-4 text-center">Assigned Leads</th>
                  <th className="p-4">Email & Phone</th>
                  <th className="p-4">Active Permissions</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.members?.map((member: TeamMember) => {
                  const isAdmin = member.role === 'company_admin';
                  const activePermsCount = Object.values(member.permissions || {}).filter(Boolean).length;

                  return (
                    <tr key={member._id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-slate-900 text-sm">{member.full_name}</div>
                        <span className="text-[10px] text-slate-400">
                          Joined {new Date(member.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      </td>

                      <td className="p-4">
                        <div className="font-semibold text-slate-800 text-xs">
                          {member.designation || (member.role === 'company_admin' ? 'Company Director / Admin' : member.role === 'manager' ? 'Sales Manager' : 'Sales Executive')}
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {member.department || 'Sales & Business Development'}
                        </span>
                      </td>

                      <td className="p-4">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider border ${
                          isAdmin
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : member.role === 'manager'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {member.role.replace('_', ' ')}
                        </span>
                      </td>

                      <td className="p-4 text-center">
                        <span className="inline-flex items-center gap-1 font-bold text-xs text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-200">
                          <span>👤</span>
                          <span>{member.assigned_leads_count || 0} Leads</span>
                        </span>
                      </td>

                      <td className="p-4 text-slate-700 font-medium">
                        <div>{member.email}</div>
                        {member.phone && <div className="text-[10px] text-slate-400">{member.phone}</div>}
                      </td>

                      <td className="p-4">
                        {isAdmin ? (
                          <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
                            Full Admin Rights
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-600">
                            {activePermsCount} Modules Enabled
                          </span>
                        )}
                      </td>

                      <td className="p-4 text-center">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Active
                        </span>
                      </td>

                      <td className="p-4 text-right space-x-2">
                        {!isAdmin && (
                          <button
                            onClick={() => handleOpenPermsModal(member)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors shadow-sm"
                          >
                            <Sliders className="h-3.5 w-3.5" />
                            <span>Permissions</span>
                          </button>
                        )}
                        {!isAdmin && (
                          <button
                            onClick={() => handleDeleteMember(member._id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Remove Member"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add Team Member */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">Add Team Member</h3>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {isSeatFull ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 space-y-2">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span>User Limit Reached ({maxLimit}/{maxLimit} Seats)</span>
                </div>
                <p>
                  Your company plan has reached the maximum allowed team members set by the Super Administrator. Please request Super Admin to increase your user quota.
                </p>
              </div>
            ) : (
              <form onSubmit={handleAddMember} className="space-y-3 text-xs">
                {errorMsg && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
                    {errorMsg}
                  </div>
                )}

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Login Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="rahul@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Initial Password *</label>
                    <input
                      type="text"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Role Type (Access Level) *</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as any)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-xs"
                    >
                      <option value="staff">Staff / Sales Executive (Lead Operations)</option>
                      <option value="manager">Team Manager (Lead Assignment & Team View)</option>
                      <option value="company_admin">Company Admin (Full Company Access)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Designation / Title *</label>
                    <select
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium text-xs"
                    >
                      <option value="Sales Executive">Sales Executive</option>
                      <option value="Senior BDA">Senior BDA (Business Development Associate)</option>
                      <option value="Team Leader">Team Leader</option>
                      <option value="Sales Manager">Sales Manager</option>
                      <option value="General Manager">General Manager</option>
                      <option value="Telecaller / CRM Executive">Telecaller / CRM Executive</option>
                      <option value="Accounts & Billing Executive">Accounts & Billing Executive</option>
                      <option value="Technical Support Engineer">Technical Support Engineer</option>
                      <option value="custom">✍️ Other / Custom Designation...</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Department</label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium text-xs"
                    >
                      <option value="Sales & Business Development">Sales & Business Development</option>
                      <option value="Presales & Estimation">Presales & Estimation</option>
                      <option value="Accounts & Billing">Accounts & Billing</option>
                      <option value="Technical Support">Technical Support</option>
                      <option value="Management & Operations">Management & Operations</option>
                    </select>
                  </div>
                </div>

                {designation === 'custom' && (
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Specify Custom Designation *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Regional Sales Head / Key Account Manager"
                      value={customDesignation}
                      onChange={(e) => setCustomDesignation(e.target.value)}
                      className="w-full border border-blue-300 bg-blue-50/40 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                    />
                  </div>
                )}

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 text-xs"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Creating...' : 'Create Member'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Granular Permission Manager */}
      {selectedMemberForPerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 space-y-4 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-indigo-600" />
                <div>
                  <h3 className="font-bold text-base text-slate-900">Permission Manager</h3>
                  <p className="text-xs text-slate-500">
                    Configuring access for <strong className="text-slate-800">{selectedMemberForPerms.full_name}</strong> ({selectedMemberForPerms.role})
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedMemberForPerms(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-3 pr-1 kanban-col text-xs">
              {PERMISSION_DEFINITIONS.map((perm) => {
                const isEnabled = !!permsState[perm.key];

                return (
                  <div
                    key={perm.key}
                    onClick={() => handleTogglePerm(perm.key)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isEnabled
                        ? 'bg-indigo-50/60 border-indigo-200'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold text-slate-900 flex items-center gap-2">
                        <span>{perm.label}</span>
                        {isEnabled && (
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                            Enabled
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">{perm.desc}</p>
                    </div>

                    {/* Toggle Switch */}
                    <div
                      className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                        isEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                      }`}
                    >
                      <div
                        className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                          isEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Changes take effect immediately on next login.</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMemberForPerms(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={isSavingPerms}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 disabled:opacity-50"
                >
                  {isSavingPerms ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern React Confirmation Modal for Team Member Deletion */}
      <ConfirmModal
        isOpen={Boolean(deletingMemberId)}
        title="Remove Team Member?"
        message="Are you sure you want to remove this team member? They will immediately lose access to the company CRM and any assigned leads will remain safely in the system."
        confirmText="Remove Member"
        cancelText="Cancel"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={confirmDeleteMember}
        onCancel={() => setDeletingMemberId(null)}
      />
    </div>
  );
};
