import React, { useState, useEffect } from 'react';
import { Lead, api, CurrentUser, TeamMember } from '../services/api';
import { formatIndianDateTime, formatIndianDate } from '../utils/dateUtils';
import { 
  X, 
  Phone, 
  Mail, 
  Building2, 
  MapPin, 
  Clock, 
  MessageSquare, 
  PhoneCall, 
  Receipt,
  FileEdit,
  Send,
  UserCheck,
  Users
} from 'lucide-react';

interface LeadDetailModalProps {
  lead: Lead;
  currentUser?: CurrentUser | null;
  tenantId?: string;
  onClose: () => void;
  onConvertToBill: (lead: Lead) => void;
  onLeadUpdated: () => void;
}

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  lead,
  currentUser,
  tenantId,
  onClose,
  onConvertToBill,
  onLeadUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'details'>('timeline');
  const [activityNote, setActivityNote] = useState('');
  const [activityType, setActivityType] = useState('CALL_LOG');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Staff Assignment State
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(lead.assigned_to_user_id || 'unassigned');
  const [isAssigning, setIsAssigning] = useState(false);

  const canAssign = !currentUser || currentUser.role === 'company_admin' || currentUser.role === 'manager' || currentUser.role === 'super_admin';

  useEffect(() => {
    setSelectedStaffId(lead.assigned_to_user_id || 'unassigned');
  }, [lead.assigned_to_user_id]);

  useEffect(() => {
    const activeTenant = lead.tenant_id || tenantId || 'demo_tenant_01';
    api.getTeamMembers(activeTenant)
      .then((res) => {
        if (res && res.members) {
          setTeamMembers(res.members.filter((m: TeamMember) => m.is_active));
        }
      })
      .catch((err) => console.error('Failed to load team members:', err));
  }, [lead.tenant_id, tenantId]);

  const handleAssignLead = async (targetUserId: string) => {
    setIsAssigning(true);
    try {
      const activeTenant = lead.tenant_id || tenantId || 'demo_tenant_01';
      const assignerName = currentUser?.full_name || 'Admin';
      const finalUserId = targetUserId === 'unassigned' ? null : targetUserId;
      await api.assignLead(
        lead._id || lead.id || '',
        finalUserId,
        undefined,
        assignerName,
        activeTenant
      );
      setSelectedStaffId(targetUserId);
      onLeadUpdated();
    } catch (err) {
      console.error('Failed to assign lead:', err);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityNote.trim()) return;

    setIsSubmitting(true);
    try {
      await api.addLeadActivity(lead._id, activityType, activityNote);
      setActivityNote('');
      onLeadUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStageChange = async (newStage: string) => {
    try {
      await api.updateLeadStage(lead._id, newStage, `Manual stage change to ${newStage}`);
      onLeadUpdated();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-base">
              {lead.full_name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">{lead.full_name}</h3>
                {(lead.category || 'WARM').toUpperCase() === 'HOT' ? (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                    🔥 HOT
                  </span>
                ) : (lead.category || 'WARM').toUpperCase() === 'COLD' ? (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    ❄️ COLD
                  </span>
                ) : (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    ☀️ WARM
                  </span>
                )}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {lead.source.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Created on {formatIndianDate(lead.created_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!lead.conversion_info?.is_converted && (
              <button
                onClick={() => onConvertToBill(lead)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
              >
                <Receipt className="h-3.5 w-3.5" />
                <span>Convert to Bill</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Stage Selector Bar */}
        <div className="px-6 py-2.5 bg-slate-100/60 border-b border-slate-200 flex items-center justify-between overflow-x-auto text-xs">
          <span className="font-semibold text-slate-500">Pipeline Stage:</span>
          <div className="flex gap-1.5">
            {['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST'].map((st) => (
              <button
                key={st}
                onClick={() => handleStageChange(st)}
                className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-all ${
                  lead.stage === st
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* CRM Lead Category Selector Bar */}
        <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-500">CRM Category:</span>
          <div className="flex gap-2">
            {[
              { id: 'HOT', label: '🔥 Hot (4h SLA)', activeClass: 'bg-rose-500 text-white' },
              { id: 'WARM', label: '☀️ Warm (24h SLA)', activeClass: 'bg-amber-500 text-white' },
              { id: 'COLD', label: '❄️ Cold (72h SLA)', activeClass: 'bg-blue-500 text-white' },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={async () => {
                  try {
                    await api.updateLeadCategory(lead._id || lead.id || '', cat.id);
                    onLeadUpdated();
                  } catch (err) {
                    console.error(err);
                  }
                }}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all ${
                  (lead.category || 'WARM').toUpperCase() === cat.id
                    ? `${cat.activeClass} shadow-xs`
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Staff Assignment Bar (Company Admin & Manager Access) */}
        <div className="px-6 py-2.5 bg-indigo-50/60 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-indigo-600 shrink-0" />
            <span className="font-bold text-slate-700">Assigned Staff:</span>
            {lead.assigned_to_user_name ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-xs bg-indigo-100 text-indigo-900 px-3 py-1 rounded-full border border-indigo-200 shadow-2xs">
                <span>👤</span>
                <span>{lead.assigned_to_user_name}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-xs bg-amber-100/70 text-amber-800 px-3 py-1 rounded-full border border-amber-300">
                <span>⚠️</span>
                <span>Unassigned (Pool)</span>
              </span>
            )}
          </div>

          {canAssign ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-600">Assign / Reassign:</span>
              <select
                disabled={isAssigning}
                value={selectedStaffId}
                onChange={(e) => handleAssignLead(e.target.value)}
                className="text-xs font-semibold bg-white text-slate-800 border border-indigo-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <option value="unassigned">-- Unassign / Open Pool --</option>
                {teamMembers.map((member) => (
                  <option key={member._id} value={member._id}>
                    {member.full_name} ({member.designation || member.role.replace('_', ' ').toUpperCase()})
                  </option>
                ))}
              </select>
              {isAssigning && (
                <span className="text-[11px] text-indigo-600 font-bold animate-pulse">Saving...</span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-slate-400 italic">Only Manager/Admin can reassign</span>
          )}
        </div>

        {/* Tab switcher */}
        <div className="px-6 border-b border-slate-200 flex gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 border-b-2 transition-colors ${
              activeTab === 'timeline'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Activity Timeline ({lead.timeline?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Customer & Custom Fields
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {activeTab === 'details' ? (
            /* Details View */
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-400 font-medium">Phone</span>
                <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-blue-600" />
                  {lead.phone}
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-400 font-medium">Email</span>
                <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-blue-600" />
                  {lead.email || 'N/A'}
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-400 font-medium">Company Name</span>
                <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-blue-600" />
                  {lead.company_name || 'Individual'}
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-400 font-medium">Location</span>
                <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-blue-600" />
                  {lead.city || ''} {lead.state || 'India'}
                </p>
              </div>

              <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-1 col-span-2">
                <span className="text-indigo-600 font-medium">Assigned Executive / Team Member</span>
                <p className="font-bold text-slate-800 flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-indigo-600" />
                  {lead.assigned_to_user_name ? (
                    <span>{lead.assigned_to_user_name}</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">Unassigned (Open Pool)</span>
                  )}
                </p>
              </div>

              {/* Dynamic Company Type Custom Fields */}
              <div className="col-span-2 pt-2">
                <h4 className="font-bold text-slate-800 mb-2">Company Specific Attributes (Dynamic NoSQL)</h4>
                {lead.custom_fields && Object.keys(lead.custom_fields).length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    {Object.entries(lead.custom_fields).map(([k, v]) => (
                      <div key={k} className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 uppercase tracking-wider">{k.replace('_', ' ')}</span>
                        <p className="font-semibold text-slate-800">{String(v)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">No custom fields defined for this lead.</p>
                )}
              </div>

              {/* Requirement message */}
              {lead.inquiry_message && (
                <div className="col-span-2 p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                  <span className="text-blue-600 font-semibold block mb-1">Inquiry / Requirement Message:</span>
                  <p className="text-slate-700">{lead.inquiry_message}</p>
                </div>
              )}
            </div>
          ) : (
            /* Timeline & Log Activity View */
            <div className="space-y-6">
              {/* Add Activity Form */}
              <form onSubmit={handleAddActivity} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">Log Interaction</span>
                  <div className="flex gap-1">
                    {[
                      { id: 'CALL_LOG', label: 'Call', icon: PhoneCall },
                      { id: 'WHATSAPP', label: 'WhatsApp', icon: MessageSquare },
                      { id: 'NOTE', label: 'Note', icon: FileEdit },
                    ].map((btn) => {
                      const Icon = btn.icon;
                      return (
                        <button
                          key={btn.id}
                          type="button"
                          onClick={() => setActivityType(btn.id)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            activityType === btn.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-slate-600 border border-slate-200'
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          <span>{btn.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={activityNote}
                    onChange={(e) => setActivityNote(e.target.value)}
                    placeholder="Enter call notes, WhatsApp conversation summary..."
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !activityNote.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Log</span>
                  </button>
                </div>
              </form>

              {/* Timeline feed */}
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {lead.timeline?.slice().reverse().map((item, idx) => (
                  <div key={idx} className="relative group">
                    {/* Dot */}
                    <div className="absolute -left-[19px] top-1.5 h-3 w-3 rounded-full bg-blue-600 border-2 border-white shadow-sm" />
                    <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="font-bold text-slate-700 text-[11px]">{item.activity_type.replace('_', ' ')}</span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                          <Clock className="h-3 w-3 text-slate-400" />
                          {formatIndianDateTime(item.timestamp)}
                        </span>
                      </div>
                      <p className="text-slate-700">{item.note}</p>
                      {item.performed_by_name && (
                        <span className="text-[10px] text-slate-400 block pt-1">By: {item.performed_by_name}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
