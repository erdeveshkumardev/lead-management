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
  Users,
  Calendar,
  CalendarPlus,
  CalendarCheck,
  CheckCircle2,
  AlertCircle,
  Bell,
  ArrowRight
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
  const [activeTab, setActiveTab] = useState<'timeline' | 'details' | 'followups'>('timeline');
  const [activityNote, setActivityNote] = useState('');
  const [activityType, setActivityType] = useState('CALL_LOG');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Staff Assignment State
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(lead.assigned_to_user_id || 'unassigned');
  const [isAssigning, setIsAssigning] = useState(false);

  // Follow-up Scheduling & Completion State
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(11, 0, 0, 0);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  });
  const [followUpType, setFollowUpType] = useState('call');
  const [followUpNote, setFollowUpNote] = useState('');
  const [isSchedulingFollowUp, setIsSchedulingFollowUp] = useState(false);

  const [showCompletePrompt, setShowCompletePrompt] = useState(false);
  const [completionRemark, setCompletionRemark] = useState('');
  const [isCompletingFollowUp, setIsCompletingFollowUp] = useState(false);

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

  const applyDatePreset = (preset: 'today_afternoon' | 'tomorrow_morning' | 'in_2_days' | 'next_week') => {
    const d = new Date();
    if (preset === 'today_afternoon') {
      d.setHours(d.getHours() + 3, 0, 0, 0);
    } else if (preset === 'tomorrow_morning') {
      d.setDate(d.getDate() + 1);
      d.setHours(11, 0, 0, 0);
    } else if (preset === 'in_2_days') {
      d.setDate(d.getDate() + 2);
      d.setHours(11, 0, 0, 0);
    } else if (preset === 'next_week') {
      d.setDate(d.getDate() + 7);
      d.setHours(11, 0, 0, 0);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    setFollowUpDate(`${year}-${month}-${day}T${hours}:${minutes}`);
  };

  const handleScheduleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpDate) return;

    setIsSchedulingFollowUp(true);
    try {
      const activeTenant = lead.tenant_id || tenantId || 'demo_tenant_01';
      const defaultNote = followUpNote.trim() || `Follow-up ${followUpType.toUpperCase()} with customer`;
      
      const dateObj = new Date(followUpDate);
      const isoScheduledAt = isNaN(dateObj.getTime()) ? followUpDate : dateObj.toISOString();

      const res = await api.scheduleFollowUp(
        lead._id || lead.id || '',
        {
          scheduled_at: isoScheduledAt,
          follow_up_type: followUpType,
          note: defaultNote,
          user_id: currentUser?.id,
          user_name: currentUser?.full_name,
        },
        activeTenant
      );

      if (res && res.lead) {
        Object.assign(lead, res.lead);
      } else {
        lead.next_follow_up = {
          scheduled_at: isoScheduledAt,
          follow_up_type: followUpType,
          note: defaultNote,
          status: 'PENDING'
        };
      }

      setShowFollowUpForm(false);
      setFollowUpNote('');
      onLeadUpdated();
    } catch (err) {
      console.error('Failed to schedule follow up:', err);
    } finally {
      setIsSchedulingFollowUp(false);
    }
  };

  const handleCompleteFollowUp = async () => {
    setIsCompletingFollowUp(true);
    try {
      const activeTenant = lead.tenant_id || tenantId || 'demo_tenant_01';
      await api.completeFollowUp(
        lead._id || lead.id || '',
        {
          note: completionRemark,
          completed_by_id: currentUser?.id,
          completed_by_name: currentUser?.full_name,
        },
        activeTenant
      );
      setShowCompletePrompt(false);
      setCompletionRemark('');
      onLeadUpdated();
    } catch (err) {
      console.error('Failed to complete follow up:', err);
    } finally {
      setIsCompletingFollowUp(false);
    }
  };

  const getFollowUpStatusInfo = (schedAt?: string) => {
    if (!schedAt) return null;
    const sched = new Date(schedAt);
    const now = new Date();
    const schedDate = new Date(sched.getFullYear(), sched.getMonth(), sched.getDate()).getTime();
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    if (sched < now && schedDate < nowDate) {
      return { status: 'overdue', label: '🚨 Overdue Follow-up', bg: 'bg-rose-50 border-rose-300 text-rose-800' };
    }
    if (schedDate === nowDate) {
      return { status: 'today', label: '🔔 Due Today', bg: 'bg-amber-50 border-amber-300 text-amber-800' };
    }
    return { status: 'upcoming', label: '📅 Upcoming Follow-up', bg: 'bg-emerald-50 border-emerald-300 text-emerald-800' };
  };

  const getFollowUpTypeIcon = (type?: string) => {
    switch (type?.toLowerCase()) {
      case 'call': return '📞 Phone Call';
      case 'whatsapp': return '💬 WhatsApp';
      case 'meeting': return '👥 Meeting';
      case 'email': return '✉️ Email';
      case 'site_visit': return '🏢 Site Visit';
      default: return '🔔 Follow-up';
    }
  };

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityNote.trim()) return;

    setIsSubmitting(true);
    try {
      await api.addLeadActivity(lead._id, activityType, activityNote);
      lead.next_follow_up = null; // Instantly clears active/overdue follow-up from modal!
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
      lead.stage = newStage;
      lead.next_follow_up = null; // Instantly clears active/overdue follow-up from modal!
      onLeadUpdated();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto" style={{ colorScheme: 'light' }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden text-slate-900" style={{ colorScheme: 'light' }}>
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

        {/* Follow-up Section & Action Banner */}
        <div className="px-6 py-3 bg-amber-50/60 border-b border-amber-200">
          {lead.next_follow_up && lead.next_follow_up.status === 'PENDING' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center font-bold text-sm border border-amber-300">
                    <Bell className="h-4 w-4 text-amber-700 animate-bounce" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-xs text-slate-950">
                        {getFollowUpTypeIcon(lead.next_follow_up.follow_up_type)}
                      </span>
                      {(() => {
                        const info = getFollowUpStatusInfo(lead.next_follow_up.scheduled_at);
                        return info ? (
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${info.bg}`}>
                            {info.label}
                          </span>
                        ) : null;
                      })()}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-slate-700 font-bold">Scheduled for:</span>
                      <strong className="text-slate-950 font-black text-xs bg-white px-2 py-0.5 rounded-md border border-amber-300 shadow-2xs">
                        {formatIndianDateTime(lead.next_follow_up.scheduled_at)}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCompletePrompt(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Mark as Done</span>
                  </button>
                  <button
                    onClick={() => setShowFollowUpForm(!showFollowUpForm)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    <span>{showFollowUpForm ? 'Close Form' : 'Reschedule Date'}</span>
                  </button>
                </div>
              </div>

              {lead.next_follow_up.note && (
                <div className="text-xs bg-white p-2.5 rounded-xl border border-amber-300 text-slate-900 font-semibold shadow-2xs">
                  <strong className="text-amber-950 block font-black text-[11px] mb-0.5">Follow-up Agenda / Note:</strong>
                  {lead.next_follow_up.note}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarPlus className="h-4 w-4 text-amber-700" />
                <span className="text-xs text-slate-800 font-bold">No pending follow-up scheduled.</span>
              </div>
              <button
                onClick={() => setShowFollowUpForm(!showFollowUpForm)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors cursor-pointer"
              >
                <CalendarPlus className="h-3.5 w-3.5" />
                <span>{showFollowUpForm ? 'Cancel' : 'Schedule Next Follow-up'}</span>
              </button>
            </div>
          )}

          {/* Inline Complete Follow-up Prompt */}
          {showCompletePrompt && (
            <div className="mt-3 p-3.5 bg-white rounded-2xl border-2 border-emerald-300 shadow-md space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Complete Follow-up & Record Outcome</span>
                </span>
                <button onClick={() => setShowCompletePrompt(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder="What was the outcome? (e.g. Discussed pricing, customer requested formal quote...)"
                value={completionRemark}
                onChange={(e) => setCompletionRemark(e.target.value)}
                style={{ color: '#0f172a', backgroundColor: '#ffffff' }}
                className="w-full text-xs font-bold text-slate-900 bg-white border-2 border-emerald-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowCompletePrompt(false)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  disabled={isCompletingFollowUp}
                  onClick={handleCompleteFollowUp}
                  className="px-4 py-1.5 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isCompletingFollowUp ? 'Saving...' : 'Confirm Completed'}
                </button>
              </div>
            </div>
          )}

          {/* Inline Schedule / Reschedule Follow-up Form */}
          {showFollowUpForm && (
            <form onSubmit={handleScheduleFollowUp} className="mt-3 p-4 bg-white rounded-2xl border-2 border-indigo-200 shadow-md space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                    <CalendarCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-slate-900">
                      {lead.next_follow_up?.status === 'PENDING' ? 'Reschedule Follow-up Date & Time' : 'Set Follow-up Date & Time'}
                    </h4>
                    <p className="text-[10px] text-slate-500">Pick date & time to alert the assigned sales rep</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowFollowUpForm(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Quick Date Presets */}
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase text-indigo-900 tracking-wider block">
                  ⚡ 1-Click Quick Presets:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyDatePreset('today_afternoon')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors cursor-pointer"
                  >
                    Today (+3 Hours)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('tomorrow_morning')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-colors cursor-pointer"
                  >
                    Tomorrow 11:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('in_2_days')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer"
                  >
                    In 2 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('next_week')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 transition-colors cursor-pointer"
                  >
                    Next Week
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div>
                  <label className="text-xs font-black text-slate-900 block mb-1.5">
                    Follow-up Mode / Channel:
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[
                      { id: 'call', label: '📞 Phone Call' },
                      { id: 'whatsapp', label: '💬 WhatsApp' },
                      { id: 'meeting', label: '👥 Meeting' },
                      { id: 'email', label: '✉️ Email' },
                      { id: 'site_visit', label: '🏢 Site Visit' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setFollowUpType(mode.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          followUpType === mode.id
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={followUpType}
                    onChange={(e) => setFollowUpType(e.target.value)}
                    style={{ color: '#0f172a', backgroundColor: '#ffffff', colorScheme: 'light' }}
                    className="w-full text-xs font-bold text-slate-900 bg-white border-2 border-slate-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-2xs cursor-pointer"
                  >
                    <option style={{ color: '#0f172a', backgroundColor: '#ffffff' }} value="call">📞 Phone Call</option>
                    <option style={{ color: '#0f172a', backgroundColor: '#ffffff' }} value="whatsapp">💬 WhatsApp Message</option>
                    <option style={{ color: '#0f172a', backgroundColor: '#ffffff' }} value="meeting">👥 In-person / Online Meeting</option>
                    <option style={{ color: '#0f172a', backgroundColor: '#ffffff' }} value="email">✉️ Formal Email</option>
                    <option style={{ color: '#0f172a', backgroundColor: '#ffffff' }} value="site_visit">🏢 Site / Factory Visit</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-black text-slate-900 block">
                      Date & Time (IST):
                    </label>
                    {followUpDate && (
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        ✓ {formatIndianDateTime(followUpDate, false)} IST
                      </span>
                    )}
                  </div>
                  <input
                    type="datetime-local"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    style={{ color: '#0f172a', backgroundColor: '#ffffff', colorScheme: 'light' }}
                    className="w-full text-xs font-black text-slate-900 bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-2xs cursor-pointer"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-black text-slate-900 block mb-1">
                  Agenda / Follow-up Note <span className="font-normal text-slate-500 text-[10px]">(Optional)</span>:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Call to discuss commercial quotation, verify machine technical requirements..."
                  value={followUpNote}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  style={{ color: '#0f172a', backgroundColor: '#ffffff', colorScheme: 'light' }}
                  className="w-full text-xs font-semibold text-slate-900 placeholder:text-slate-400 bg-white border-2 border-slate-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-2xs"
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <span className="text-xs text-slate-700 font-bold truncate max-w-[220px]">
                  {followUpDate ? `📅 ${formatIndianDateTime(followUpDate, false)}` : 'Select date & time'}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFollowUpForm(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSchedulingFollowUp || !followUpDate}
                    className="px-5 py-2.5 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-500/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <CalendarCheck className="h-4 w-4 text-white" />
                    <span>
                      {isSchedulingFollowUp 
                        ? 'Saving...' 
                        : (lead.next_follow_up?.status === 'PENDING' ? '🔄 Confirm Reschedule' : '💾 Set & Save Follow-up')}
                    </span>
                  </button>
                </div>
              </div>
            </form>
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
            onClick={() => setActiveTab('followups')}
            className={`py-3 border-b-2 transition-colors ${
              activeTab === 'followups'
                ? 'border-amber-600 text-amber-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Follow-ups ({lead.follow_ups?.length || 0})
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
          {activeTab === 'followups' ? (
            /* Follow-ups History View */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">Scheduled & Past Follow-ups</h4>
                  <p className="text-xs text-slate-500">Complete audit trail of sales interactions and promised next steps</p>
                </div>
                <button
                  onClick={() => setShowFollowUpForm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  <span>+ New Follow-up</span>
                </button>
              </div>

              {(!lead.follow_ups || lead.follow_ups.length === 0) ? (
                <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
                  <Calendar className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-xs">No follow-ups recorded yet</p>
                  <p className="text-[11px] text-slate-400 mt-1">Use the button above to schedule your first call or meeting.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {lead.follow_ups.slice().reverse().map((fu, idx) => (
                    <div
                      key={fu.id || idx}
                      className={`p-3.5 rounded-xl border transition-all ${
                        fu.status === 'COMPLETED'
                          ? 'bg-slate-50 border-slate-200'
                          : 'bg-amber-50/60 border-amber-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{getFollowUpTypeIcon(fu.follow_up_type)}</span>
                          {fu.status === 'COMPLETED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              <span>COMPLETED</span>
                            </span>
                          ) : (
                            (() => {
                              const info = getFollowUpStatusInfo(fu.scheduled_at);
                              return info ? (
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${info.bg}`}>
                                  {info.label}
                                </span>
                              ) : (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                                  PENDING
                                </span>
                              );
                            })()
                          )}
                        </div>
                        <span className="text-[11px] font-medium text-slate-500">
                          {formatIndianDateTime(fu.scheduled_at)}
                        </span>
                      </div>

                      <p className="text-xs text-slate-700 font-medium">{fu.note}</p>

                      {fu.status === 'COMPLETED' && (
                        <div className="mt-2 pt-2 border-t border-slate-200/80 text-[11px] text-emerald-800 bg-emerald-50/60 p-2 rounded-lg">
                          <strong>Outcome / Completion Remarks:</strong> {fu.completion_note || 'Completed on schedule.'}
                          {fu.completed_at && (
                            <span className="block text-[10px] text-slate-500 mt-0.5">
                              Finished at: {formatIndianDateTime(fu.completed_at)}
                            </span>
                          )}
                        </div>
                      )}

                      {fu.status === 'PENDING' && (
                        <div className="mt-2.5 flex justify-end">
                          <button
                            onClick={() => setShowCompletePrompt(true)}
                            className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-white hover:bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-300"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Mark Completed</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : activeTab === 'details' ? (
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
