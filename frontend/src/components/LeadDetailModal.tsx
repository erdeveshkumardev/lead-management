import React, { useState, useEffect, useCallback } from 'react';
import { Lead, api, apiMessage, can, isApiError, CurrentUser, TeamMember, Invoice, PipelineStage } from '../services/api';
import { RecordPaymentModal } from './RecordPaymentModal';
import { PdfDownloadButton } from './PdfDownloadButton';
import { canTakePayment, documentShortLabel, money, paymentStatusMeta } from '../utils/billing';
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
  ArrowRight,
  Eye,
  CreditCard
} from 'lucide-react';
import { InvoiceViewModal } from './InvoiceViewModal';

interface LeadDetailModalProps {
  lead: Lead;
  currentUser?: CurrentUser | null;
  tenantId?: string;
  /** The company's own pipeline stages (falls back to the standard set). */
  stages?: PipelineStage[];
  onClose: () => void;
  onConvertToBill: (lead: Lead) => void;
  onLeadUpdated: () => void;
}

const DEFAULT_STAGES = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST'];

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  lead: initialLead,
  currentUser,
  stages,
  onClose,
  onConvertToBill,
  onLeadUpdated,
}) => {
  // Lists carry a light summary of each lead; the full record (timeline, follow-ups) is loaded here.
  const [lead, setLead] = useState<Lead>(initialLead);
  const leadId = initialLead._id || initialLead.id || '';
  const [actionError, setActionError] = useState('');

  const [activeTab, setActiveTab] = useState<'timeline' | 'details' | 'followups' | 'invoices'>('timeline');
  const [activityNote, setActivityNote] = useState('');
  const [activityType, setActivityType] = useState('CALL_LOG');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Invoices & Billing State for this Lead
  const [leadInvoices, setLeadInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState('');

  // What this person may do here (the server enforces the same rules)
  const canEdit = can(currentUser, 'leads_create_edit');
  const canAssign = can(currentUser, 'leads_assign');
  const canBill = can(currentUser, 'billing_convert');
  const canViewBills = can(currentUser, 'billing_view');
  const canTakePayments = can(currentUser, 'billing_payments');

  // Staff assignment
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(initialLead.assigned_to_user_id || 'unassigned');
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
  const [showFollowUpTypeDropdown, setShowFollowUpTypeDropdown] = useState(false);

  const [showCompletePrompt, setShowCompletePrompt] = useState(false);
  const [completionRemark, setCompletionRemark] = useState('');
  const [isCompletingFollowUp, setIsCompletingFollowUp] = useState(false);

  const stageOptions = stages && stages.length > 0 ? stages.map((st) => ({ id: st.id, label: st.label })) : DEFAULT_STAGES.map((id) => ({ id, label: id.replace(/_/g, ' ') }));

  /** Applies a server answer: shows the refusal, or takes over the updated lead and tells the parent screen. */
  const applyResult = (res: any, fallback: string): boolean => {
    if (isApiError(res)) {
      setActionError(apiMessage(res, fallback));
      return false;
    }
    setActionError('');
    if (res && res.lead) setLead(res.lead);
    onLeadUpdated();
    return true;
  };

  const refreshLead = useCallback(async () => {
    if (!leadId) return;
    const fresh = await api.getLead(leadId);
    if (!isApiError(fresh) && fresh && (fresh._id || fresh.id)) setLead(fresh);
  }, [leadId]);

  useEffect(() => {
    setLead(initialLead);
    refreshLead();
  }, [leadId, refreshLead]);

  useEffect(() => {
    setSelectedStaffId(lead.assigned_to_user_id || 'unassigned');
  }, [lead.assigned_to_user_id]);

  // people a lead can be handed to (only loaded for those who may assign)
  useEffect(() => {
    if (!canAssign) return;
    let alive = true;
    api.getTeamMembers().then((res) => {
      if (!alive || isApiError(res)) return;
      setTeamMembers(Array.isArray(res?.members) ? res.members.filter((m: TeamMember) => m.is_active) : []);
    });
    return () => {
      alive = false;
    };
  }, [canAssign]);

  const loadLeadInvoices = useCallback(async () => {
    if (!canViewBills || !leadId) {
      setLeadInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    // only documents raised for this lead (matched by id on the server, never by name or phone)
    const res = await api.getInvoices(undefined, '', { lead_id: leadId, limit: 100 });
    setLeadInvoices(Array.isArray(res.items) ? res.items : []);
    setLoadingInvoices(false);
  }, [canViewBills, leadId]);

  useEffect(() => {
    loadLeadInvoices();
  }, [loadLeadInvoices]);

  const handleQuickMarkAsPaid = async (inv: Invoice) => {
    if (markingPaidId) return;
    setMarkingPaidId(inv._id);
    const res = await api.markInvoiceAsPaid(inv._id, 'UPI');
    setMarkingPaidId('');
    if (isApiError(res)) {
      setActionError(apiMessage(res, 'The invoice could not be marked as paid.'));
      return;
    }
    setActionError('');
    loadLeadInvoices();
    refreshLead();
    onLeadUpdated();
  };

  const handleAssignLead = async (targetUserId: string) => {
    setIsAssigning(true);
    const res = await api.assignLead(leadId, targetUserId === 'unassigned' ? null : targetUserId);
    setIsAssigning(false);
    if (applyResult(res, 'The lead could not be assigned.')) setSelectedStaffId(targetUserId);
    else setSelectedStaffId(lead.assigned_to_user_id || 'unassigned');
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
    const defaultNote = followUpNote.trim() || `Follow-up ${followUpType.toUpperCase()} with customer`;
    // the picker gives local time; it is sent as an exact instant so the server never has to guess the zone
    const dateObj = new Date(followUpDate);
    const isoScheduledAt = isNaN(dateObj.getTime()) ? followUpDate : dateObj.toISOString();

    const res = await api.scheduleFollowUp(leadId, { scheduled_at: isoScheduledAt, follow_up_type: followUpType, note: defaultNote });
    setIsSchedulingFollowUp(false);
    if (applyResult(res, 'The follow-up could not be scheduled.')) {
      setShowFollowUpForm(false);
      setFollowUpNote('');
    }
  };

  const handleCompleteFollowUp = async () => {
    setIsCompletingFollowUp(true);
    const res = await api.completeFollowUp(leadId, { note: completionRemark });
    setIsCompletingFollowUp(false);
    if (applyResult(res, 'The follow-up could not be completed.')) {
      setShowCompletePrompt(false);
      setCompletionRemark('');
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
    const res = await api.addLeadActivity(leadId, activityType, activityNote.trim());
    setIsSubmitting(false);
    if (applyResult(res, 'The activity could not be saved.')) setActivityNote('');
  };

  const handleStageChange = async (newStage: string) => {
    if (newStage === lead.stage) return;
    applyResult(await api.updateLeadStage(leadId, newStage, `Manual stage change to ${newStage}`), 'The stage could not be changed.');
  };

  const handleCategoryChange = async (category: string) => {
    if ((lead.category || 'WARM').toUpperCase() === category) return;
    applyResult(await api.updateLeadCategory(leadId, category), 'The category could not be changed.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto" style={{ colorScheme: 'light' }}>
      {/* phones: the whole dialog scrolls; larger screens: the header stays and only the body scrolls */}
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[96vh] sm:max-h-[92vh] flex flex-col overflow-y-auto sm:overflow-hidden text-slate-900" style={{ colorScheme: 'light' }}>
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50 shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-base shrink-0">
              {(lead.full_name || '?').charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                  {(lead.source || 'manual').toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Created on {formatIndianDate(lead.created_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canBill && !lead.conversion_info?.is_converted && (
              <button
                onClick={() => onConvertToBill(lead)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors whitespace-nowrap"
              >
                <Receipt className="h-3.5 w-3.5" />
                <span><span className="hidden sm:inline">Convert to </span>Bill</span>
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

        {actionError && (
          <div role="alert" className="px-6 py-2.5 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError('')} aria-label="Dismiss" className="text-rose-400 hover:text-rose-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Stage Selector Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-100/60 border-b border-slate-200 flex items-center justify-between gap-3 overflow-x-auto text-xs shrink-0">
          <span className="font-semibold text-slate-500 shrink-0">Pipeline Stage:</span>
          <div className="flex gap-1.5">
            {stageOptions.map((st) => (
              <button
                key={st.id}
                disabled={!canEdit}
                onClick={() => handleStageChange(st.id)}
                className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-all whitespace-nowrap disabled:cursor-not-allowed ${
                  lead.stage === st.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200 disabled:opacity-60'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* CRM Lead Category Selector Bar */}
        <div className="px-4 sm:px-6 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <span className="font-semibold text-slate-500">CRM Category:</span>
          <div className="flex gap-2">
            {[
              { id: 'HOT', label: '🔥 Hot (4h SLA)', activeClass: 'bg-rose-500 text-white' },
              { id: 'WARM', label: '☀️ Warm (24h SLA)', activeClass: 'bg-amber-500 text-white' },
              { id: 'COLD', label: '❄️ Cold (72h SLA)', activeClass: 'bg-blue-500 text-white' },
            ].map((cat) => (
              <button
                key={cat.id}
                disabled={!canEdit}
                onClick={() => handleCategoryChange(cat.id)}
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
        <div className="px-4 sm:px-6 py-2.5 bg-indigo-50/60 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
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
                style={{ color: '#0f172a', backgroundColor: '#ffffff', colorScheme: 'light' }}
                className="text-xs font-semibold bg-white text-slate-800 border border-indigo-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <option value="unassigned" style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>-- Unassign / Open Pool --</option>
                {teamMembers
                  .filter((member) => member.role !== 'company_admin' && member.role !== 'super_admin')
                  .map((member) => (
                    <option key={member._id} value={member._id} style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>
                      {member.full_name} ({member.designation || member.role.replace('_', ' ').toUpperCase()})
                    </option>
                  ))}
              </select>
              {isAssigning && (
                <span className="text-[11px] text-indigo-600 font-bold animate-pulse">Saving...</span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-slate-400 italic">Assigning leads needs the "assign leads" permission</span>
          )}
        </div>

        {/* Follow-up Section & Action Banner */}
        <div className="px-4 sm:px-6 py-3 bg-amber-50/60 border-b border-amber-200 shrink-0">
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

                <div className={`flex items-center gap-2 ${canEdit ? '' : 'hidden'}`}>
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
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors cursor-pointer ${canEdit ? '' : 'hidden'}`}
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
                maxLength={2000}
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
                    Follow-up Type:
                  </label>
                  {/* Custom CSS dropdown — avoids OS dark-mode override on native <select> options */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowFollowUpTypeDropdown((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-white border-2 border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm cursor-pointer hover:border-indigo-400 transition-colors"
                      style={{ colorScheme: 'light' }}
                    >
                      <span className="text-slate-900 font-bold">
                        {followUpType === 'call' && '📞 Phone Call'}
                        {followUpType === 'whatsapp' && '💬 WhatsApp Message'}
                        {followUpType === 'meeting' && '👥 In-person / Online Meeting'}
                        {followUpType === 'email' && '✉️ Formal Email'}
                        {followUpType === 'site_visit' && '🏢 Site / Factory Visit'}
                      </span>
                      <svg className={`h-4 w-4 text-slate-500 transition-transform shrink-0 ml-2 ${showFollowUpTypeDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showFollowUpTypeDropdown && (
                      <div
                        className="absolute z-50 mt-1 w-full bg-white border-2 border-indigo-200 rounded-xl shadow-2xl overflow-hidden"
                        style={{ colorScheme: 'light' }}
                      >
                        {[
                          { id: 'call',       label: '📞 Phone Call' },
                          { id: 'whatsapp',   label: '💬 WhatsApp Message' },
                          { id: 'meeting',    label: '👥 In-person / Online Meeting' },
                          { id: 'email',      label: '✉️ Formal Email' },
                          { id: 'site_visit', label: '🏢 Site / Factory Visit' },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => { setFollowUpType(opt.id); setShowFollowUpTypeDropdown(false); }}
                            className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                              followUpType === opt.id
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white text-slate-900 hover:bg-indigo-50 hover:text-indigo-700'
                            }`}
                            style={{ colorScheme: 'light' }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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
                  maxLength={2000}
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
        <div className="px-4 sm:px-6 border-b border-slate-200 flex gap-4 text-xs font-semibold overflow-x-auto whitespace-nowrap shrink-0">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 border-b-2 transition-colors shrink-0 ${
              activeTab === 'timeline'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Activity Timeline ({lead.timeline?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('followups')}
            className={`py-3 border-b-2 transition-colors shrink-0 ${
              activeTab === 'followups'
                ? 'border-amber-600 text-amber-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Follow-ups ({lead.follow_ups?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('invoices')}
            className={`py-3 border-b-2 transition-colors shrink-0 flex items-center gap-1.5 ${canViewBills ? '' : 'hidden'} ${
              activeTab === 'invoices'
                ? 'border-indigo-600 text-indigo-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>Invoices & Bills ({leadInvoices.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 border-b-2 transition-colors shrink-0 ${
              activeTab === 'details'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Customer & Custom Fields
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 sm:overflow-y-auto sm:flex-1 space-y-6">
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs ${canEdit ? '' : 'hidden'}`}
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

                      {fu.status === 'PENDING' && canEdit && (
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
          ) : activeTab === 'invoices' ? (
            /* Invoices & Bills View */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">Commercial Quotations & Tax Invoices</h4>
                  <p className="text-xs text-slate-500">Official GST documents and payment receipts issued for {lead.full_name}</p>
                </div>
                <button
                  onClick={() => onConvertToBill(lead)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer ${canBill ? '' : 'hidden'}`}
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>+ Generate New Bill / Quotation</span>
                </button>
              </div>

              {loadingInvoices ? (
                <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
                  <p className="text-xs">Loading billing documents...</p>
                </div>
              ) : leadInvoices.length === 0 ? (
                <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <Receipt className="h-8 w-8 text-slate-300 mx-auto" />
                  <p className="font-semibold text-xs text-slate-600">No invoices or quotations generated yet</p>
                  <p className="text-[11px] text-slate-400">Click the button above to generate a 1-click GST Tax Invoice or Commercial Quotation.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {leadInvoices.map((inv) => {
                    const status = paymentStatusMeta(inv.payment_status);
                    const isBill = inv.document_type === 'TAX_INVOICE';
                    return (
                      <div
                        key={inv._id}
                        className={`p-4 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-indigo-300 transition-all space-y-3 ${
                          inv.payment_status === 'CANCELLED' ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                              {inv.invoice_number}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isBill ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-purple-50 text-purple-700 border border-purple-200'
                            }`}>
                              {documentShortLabel(inv.document_type)}
                            </span>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${status.className}`}>{status.label}</span>
                          </div>

                          <span className="text-xs text-slate-400">
                            Date: <b>{formatIndianDate(inv.invoice_date)}</b>
                          </span>
                        </div>

                        {/* Amount Bar */}
                        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                          <div>
                            <span className="text-slate-400 text-[10px] block font-medium">Grand Total</span>
                            <span className="font-bold text-slate-900 font-mono">{money(inv.financials?.grand_total)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 text-[10px] block font-medium">Paid</span>
                            <span className="font-bold text-emerald-700 font-mono">{isBill ? money(inv.financials?.paid_amount) : '—'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 text-[10px] block font-medium">Balance Due</span>
                            <span className={`font-mono font-bold ${isBill && inv.financials?.balance_due > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                              {isBill ? money(inv.financials?.balance_due) : '—'}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] text-slate-500 font-medium truncate max-w-[45%]">
                            {inv.items?.length || 0} items ({inv.items?.map((it) => it.name).join(', ')})
                          </span>

                          <div className="flex items-center gap-2">
                            {/* Payments are taken against live tax invoices only */}
                            {canTakePayments && canTakePayment(inv) && (
                              <>
                                <button
                                  type="button"
                                  disabled={Boolean(markingPaidId)}
                                  onClick={() => handleQuickMarkAsPaid(inv)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                                  title="Record the full balance as received by UPI"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>{markingPaidId === inv._id ? 'Saving…' : 'Mark Paid'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPaymentInvoice(inv)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
                                >
                                  <CreditCard className="h-3 w-3" />
                                  <span>Record Payment</span>
                                </button>
                              </>
                            )}

                            <button
                              type="button"
                              onClick={() => setViewingInvoice(inv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors cursor-pointer"
                            >
                              <Eye className="h-3 w-3" />
                              <span>View</span>
                            </button>

                            <PdfDownloadButton invoiceId={inv._id} invoiceNumber={inv.invoice_number} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                  {[lead.city, lead.state].filter(Boolean).join(', ') || 'Not recorded'}
                  {lead.pincode ? ` - ${lead.pincode}` : ''}
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-400 font-medium">GSTIN</span>
                <p className="font-semibold text-slate-800 font-mono">{lead.gstin || 'Unregistered / not recorded'}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-400 font-medium">Billing address</span>
                <p className="font-semibold text-slate-800">{lead.address || 'Not recorded'}</p>
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
                <h4 className="font-bold text-slate-800 mb-2">Additional details</h4>
                {lead.custom_fields && Object.keys(lead.custom_fields).length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    {Object.entries(lead.custom_fields).map(([k, v]) => (
                      <div key={k} className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 uppercase tracking-wider">{k.replace(/_/g, ' ')}</span>
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
              <form onSubmit={handleAddActivity} className={`p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 ${canEdit ? '' : 'hidden'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">Log Interaction</span>
                  <div className="flex flex-wrap gap-1">
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
                    maxLength={5000}
                    value={activityNote}
                    onChange={(e) => setActivityNote(e.target.value)}
                    placeholder="Enter call notes, WhatsApp conversation summary..."
                    className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
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
                        <span className="font-bold text-slate-700 text-[11px]">{(item.activity_type || '').replace(/_/g, ' ')}</span>
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

      {/* Invoice View Modal */}
      {viewingInvoice && (
        <InvoiceViewModal
          invoice={viewingInvoice}
          currentUser={currentUser}
          onClose={() => setViewingInvoice(null)}
          onRecordPayment={(inv) => setPaymentInvoice(inv)}
          onChanged={() => {
            loadLeadInvoices();
            refreshLead();
            onLeadUpdated();
          }}
        />
      )}

      {/* Record Payment Modal for Lead Invoices */}
      {paymentInvoice && (
        <RecordPaymentModal
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
          onRecorded={() => {
            setPaymentInvoice(null);
            loadLeadInvoices();
            refreshLead();
            onLeadUpdated();
          }}
        />
      )}
    </div>
  );
};
