import React, { useEffect, useState } from 'react';
import { api, apiMessage, can, CurrentUser, isApiError, TeamMember } from '../../services/api';
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
  CheckCircle2,
  KeyRound,
  ShieldOff,
  UserCheck,
  Copy
} from 'lucide-react';

interface TeamManagerProps {
  tenantId?: string;
  currentUser?: CurrentUser | null;
}

const PERMISSION_DEFINITIONS = [
  { key: 'leads_view_all', label: 'View All Company Leads', desc: 'Sees every lead of the company. Without it: only the leads assigned to them.' },
  { key: 'leads_create_edit', label: 'Create & Edit Leads', desc: 'Add inquiries, change stage and category, log calls and follow-ups.' },
  { key: 'leads_assign', label: 'Assign Leads', desc: 'Hand leads to team members and take them back into the open pool.' },
  { key: 'leads_delete', label: 'Delete & Restore Leads', desc: 'Move leads to the recycle bin and restore them.' },
  { key: 'leads_export', label: 'Export Leads (CSV)', desc: 'Download customer contact data. Every export is written to the audit trail.' },
  { key: 'leads_import', label: 'Import Leads (CSV)', desc: 'Upload leads in bulk from a spreadsheet.' },
  { key: 'billing_convert', label: 'Create Quotations & Tax Invoices', desc: 'Convert a lead into a quotation, proforma or GST tax invoice.' },
  { key: 'billing_view', label: 'View Invoices & Download PDFs', desc: 'See the billing ledger (their own documents unless they can view all leads).' },
  { key: 'billing_payments', label: 'Record & Reverse Payments', desc: 'Enter customer payments and reverse wrong entries.' },
  { key: 'billing_cancel', label: 'Cancel Invoices', desc: 'Cancel an issued document with a reason (documents are never deleted).' },
  { key: 'products_manage', label: 'Manage Product Catalog', desc: 'Add or change items, HSN/SAC codes and GST rates.' },
  { key: 'analytics_view', label: 'Company Analytics', desc: 'Team-wide performance and revenue figures on the dashboard.' },
  { key: 'team_manage', label: 'Manage Team Members', desc: 'Add people, reset passwords and two-factor sign-in, change permissions.' },
  { key: 'settings_manage', label: 'Company Settings & Integrations', desc: 'Company profile, bank details, pipeline stages, marketplace API keys and webhooks.' },
  { key: 'audit_view', label: 'Security & Audit Log', desc: 'See who did what, when and from where.' },
];

type MemberRow = TeamMember & { mfa_enabled?: boolean; must_change_password?: boolean };
type PendingAction = { kind: 'deactivate' | 'reactivate' | 'reset_password' | 'reset_mfa'; member: MemberRow } | null;

export const TeamManager: React.FC<TeamManagerProps> = ({ currentUser }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMemberForPerms, setSelectedMemberForPerms] = useState<TeamMember | null>(null);

  // Add Member Form (no password box: the server creates a strong temporary password that must be changed)
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'company_admin' | 'manager' | 'staff'>('staff');
  const [designation, setDesignation] = useState('Sales Executive');
  const [customDesignation, setCustomDesignation] = useState('');
  const [department, setDepartment] = useState('Sales & Business Development');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [pageError, setPageError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  // shown once, then gone: the server never stores a readable password
  const [credentials, setCredentials] = useState<{ name: string; email: string; temp_password: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // Permission toggles
  const [permsState, setPermsState] = useState<Record<string, boolean>>({});
  const [isSavingPerms, setIsSavingPerms] = useState(false);
  const [permsError, setPermsError] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [isActing, setIsActing] = useState(false);

  const isAdminUser = currentUser?.role === 'company_admin';

  const loadTeam = async () => {
    setLoading(true);
    const res = await api.getTeamMembers();
    if (isApiError(res)) setPageError(apiMessage(res, 'The team could not be loaded.'));
    else setData(res);
    setLoading(false);
  };

  useEffect(() => {
    loadTeam();
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');
    const effectiveDesignation = designation === 'custom' ? customDesignation.trim() : designation;

    const res = await api.addTeamMember(undefined, {
      full_name: fullName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      role,
      designation: effectiveDesignation || undefined,
      department: department || undefined,
    });
    setIsSubmitting(false);

    if (isApiError(res)) {
      setErrorMsg(apiMessage(res, 'Failed to add team member.'));
      return;
    }
    setSuccessMsg(res.message || 'Team member added.');
    setShowAddModal(false);
    setCredentials({ name: fullName.trim(), email: email.trim(), temp_password: res.temp_password || '', emailed: res.email_status === 'success' });
    setCopied(false);
    setFullName('');
    setEmail('');
    setPhone('');
    setCustomDesignation('');
    loadTeam();
  };

  const handleOpenPermsModal = (member: TeamMember) => {
    setSelectedMemberForPerms(member);
    setPermsState({ ...(member.permissions || {}) });
    setPermsError('');
  };

  const handleTogglePerm = (key: string) => {
    // nobody can hand out a permission they do not hold themselves (the server refuses it too)
    if (!can(currentUser, key)) return;
    setPermsState((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSavePermissions = async () => {
    if (!selectedMemberForPerms) return;
    setIsSavingPerms(true);
    setPermsError('');
    // only what actually changed is sent
    const before = selectedMemberForPerms.permissions || {};
    const changed: Record<string, boolean> = {};
    PERMISSION_DEFINITIONS.forEach(({ key }) => {
      if (Boolean(before[key]) !== Boolean(permsState[key])) changed[key] = Boolean(permsState[key]);
    });
    const res = Object.keys(changed).length > 0 ? await api.updateMemberPermissions(selectedMemberForPerms._id, undefined, changed) : { status: 'success' };
    setIsSavingPerms(false);
    if (isApiError(res)) {
      setPermsError(apiMessage(res, 'The permissions could not be saved.'));
      return;
    }
    setSelectedMemberForPerms(null);
    loadTeam();
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const { kind, member } = pendingAction;
    setIsActing(true);
    let res: any;
    if (kind === 'deactivate') res = await api.deleteTeamMember(member._id);
    else if (kind === 'reactivate') res = await api.updateTeamMember(member._id, { is_active: true });
    else if (kind === 'reset_password') res = await api.resetMemberPassword(member._id);
    else res = await api.resetMemberMfa(member._id);
    setIsActing(false);
    setPendingAction(null);

    if (isApiError(res)) {
      setPageError(apiMessage(res, 'The change could not be saved.'));
      return;
    }
    setPageError('');
    setSuccessMsg(res.message || 'Saved.');
    if (kind === 'reset_password' && res.temp_password) {
      setCredentials({ name: member.full_name, email: member.email, temp_password: res.temp_password, emailed: false });
      setCopied(false);
    }
    loadTeam();
  };

  const copyTempPassword = async () => {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(credentials.temp_password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const pendingText = (): { title: string; message: string; confirm: string; variant: 'danger' | 'warning' | 'primary' } => {
    const name = pendingAction?.member.full_name || 'this person';
    switch (pendingAction?.kind) {
      case 'reactivate':
        return { title: 'Reactivate account?', message: `${name} will be able to sign in again and will use one seat.`, confirm: 'Reactivate', variant: 'primary' };
      case 'reset_password':
        return {
          title: 'Reset password?',
          message: `${name} is signed out everywhere and gets a temporary password, shown to you once. They must choose their own at the next sign-in.`,
          confirm: 'Reset password',
          variant: 'warning',
        };
      case 'reset_mfa':
        return {
          title: 'Reset two-factor sign-in?',
          message: `Use this when ${name} has lost their phone. Confirm who is asking first (call them back). They are signed out and can set two-factor sign-in up again.`,
          confirm: 'Reset two-factor',
          variant: 'warning',
        };
      default:
        return {
          title: 'Deactivate team member?',
          message: `${name} is signed out immediately and can no longer sign in. Their leads and history stay in the system and the seat becomes free. You can reactivate the account later.`,
          confirm: 'Deactivate',
          variant: 'danger',
        };
    }
  };

  const currentCount = data?.current_users_count || 0;
  const maxLimit = data?.max_users_limit || 5;
  const isSeatFull = currentCount >= maxLimit;
  const usedPct = maxLimit > 0 ? (currentCount / maxLimit) * 100 : 0;

  const confirmCopy = pendingText();

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

      {pageError && (
        <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
          <span className="font-semibold flex-1">{pageError}</span>
          <button onClick={() => setPageError('')} aria-label="Dismiss" className="text-rose-400 hover:text-rose-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {successMsg && !credentials && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Temporary password: displayed once to the administrator, never stored in readable form */}
      {credentials && (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex items-start justify-between gap-3 text-xs shadow-sm">
          <div className="space-y-1.5">
            <span className="font-bold text-emerald-950 flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Sign-in details for {credentials.name}</span>
            </span>
            <p className="text-emerald-800">
              {credentials.emailed ? (
                <>A welcome e-mail with these details was sent to <strong>{credentials.email}</strong>.</>
              ) : (
                <>
                  No e-mail was sent. Give this password to <strong>{credentials.email}</strong> yourself, by phone or in person - not by e-mail or
                  group chat.
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="bg-white px-3 py-1.5 rounded-xl border border-emerald-300 font-mono text-slate-800">
                Temporary password: <strong className="text-indigo-600 select-all font-bold">{credentials.temp_password}</strong>
              </div>
              <button onClick={copyTempPassword} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-emerald-300 text-emerald-800 font-bold hover:bg-emerald-100">
                <Copy className="h-3.5 w-3.5" />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-[11px] text-emerald-700">
              It works for 7 days and must be replaced at the first sign-in. It is shown only once: after you close this box it cannot be
              displayed again (reset the password to issue a new one).
            </p>
          </div>
          <button onClick={() => { setCredentials(null); setSuccessMsg(''); }} aria-label="Close" className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Team Members List */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
          <div>
            <h3 className="font-bold text-sm text-slate-900">Team Members</h3>
            <p className="text-[11px] text-slate-500">Click 'Permissions' to toggle exact module access.</p>
          </div>

          <button
            onClick={() => { setErrorMsg(''); setShowAddModal(true); }}
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
                {data?.members?.map((member: MemberRow) => {
                  const isAdmin = member.role === 'company_admin';
                  const isSelf = member._id === currentUser?.id;
                  // a company admin manages everyone; other team managers only people below their own role
                  const manageable = !isSelf && (isAdminUser || (!isAdmin && !(member.role === 'manager' && currentUser?.role === 'manager')));
                  const activePermsCount = PERMISSION_DEFINITIONS.filter((perm) => member.permissions?.[perm.key]).length;

                  return (
                    <tr key={member._id} className={`hover:bg-slate-50/70 transition-colors ${member.is_active ? '' : 'opacity-60'}`}>
                      <td className="p-4">
                        <div className="font-bold text-slate-900 text-sm">
                          {member.full_name}
                          {isSelf && <span className="ml-1.5 text-[10px] font-black text-indigo-600">YOU</span>}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Joined {new Date(member.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
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
                        <span className={`inline-block whitespace-nowrap text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider border ${
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
                            {activePermsCount} of {PERMISSION_DEFINITIONS.length} enabled
                          </span>
                        )}
                      </td>

                      <td className="p-4 text-center space-y-1">
                        {member.is_active ? (
                          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Active
                          </span>
                        ) : (
                          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300">
                            Deactivated
                          </span>
                        )}
                        <span className={`block text-[10px] font-bold ${member.mfa_enabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                          2FA {member.mfa_enabled ? 'on' : 'off'}
                        </span>
                        {member.must_change_password && member.is_active && (
                          <span className="block text-[10px] font-bold text-amber-600">Temporary password</span>
                        )}
                      </td>

                      <td className="p-4 text-right whitespace-nowrap">
                        {!manageable ? (
                          <span className="text-[10px] text-slate-400">{isSelf ? 'Use My Profile' : '—'}</span>
                        ) : !member.is_active ? (
                          <button
                            onClick={() => setPendingAction({ kind: 'reactivate', member })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>Reactivate</span>
                          </button>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            {!isAdmin && (
                              <button
                                onClick={() => handleOpenPermsModal(member)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors shadow-sm"
                              >
                                <Sliders className="h-3.5 w-3.5" />
                                <span>Permissions</span>
                              </button>
                            )}
                            <button
                              onClick={() => setPendingAction({ kind: 'reset_password', member })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                              title="Reset password (issues a temporary password)"
                              aria-label={`Reset password of ${member.full_name}`}
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                            {member.mfa_enabled && (
                              <button
                                onClick={() => setPendingAction({ kind: 'reset_mfa', member })}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                title="Reset two-factor sign-in (lost phone)"
                                aria-label={`Reset two-factor sign-in of ${member.full_name}`}
                              >
                                <ShieldOff className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => setPendingAction({ kind: 'deactivate', member })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Deactivate account"
                              aria-label={`Deactivate ${member.full_name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 my-auto">
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
                    minLength={2}
                    maxLength={120}
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
                    maxLength={254}
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Role (access level) *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-xs"
                  >
                    <option value="staff">Staff / Sales Executive (own leads only)</option>
                    {(isAdminUser || currentUser?.role === 'super_admin') && <option value="manager">Team Manager (all leads, assignment, team view)</option>}
                    {isAdminUser && <option value="company_admin">Company Admin (full company access)</option>}
                  </select>
                </div>

                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-[11px] text-indigo-900 flex items-start gap-2">
                  <Lock className="h-4 w-4 shrink-0 text-indigo-600 mt-0.5" />
                  <span>
                    A strong temporary password is created automatically and shown to you once. It expires after 7 days and has to be replaced
                    at the first sign-in.
                  </span>
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
                    maxLength={20}
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

            {permsError && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{permsError}</span>
              </div>
            )}

            <div className="overflow-y-auto flex-1 space-y-3 pr-1 kanban-col text-xs">
              {PERMISSION_DEFINITIONS.map((perm) => {
                const isEnabled = !!permsState[perm.key];
                const grantable = can(currentUser, perm.key);

                return (
                  <div
                    key={perm.key}
                    role="switch"
                    aria-checked={isEnabled}
                    aria-disabled={!grantable}
                    title={grantable ? undefined : 'You do not have this permission yourself, so you cannot change it for others.'}
                    onClick={() => handleTogglePerm(perm.key)}
                    className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                      grantable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                    } ${
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
              <span className="text-[11px] text-slate-400 font-medium">Changes apply to their very next action. Every change is audited.</span>
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

      {/* Confirmation for deactivate / reactivate / reset password / reset two-factor */}
      <ConfirmModal
        isOpen={Boolean(pendingAction)}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmText={confirmCopy.confirm}
        cancelText="Cancel"
        variant={confirmCopy.variant}
        isLoading={isActing}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
};
