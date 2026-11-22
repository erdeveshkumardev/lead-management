import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lead, api, apiMessage, can, isApiError, CurrentUser, PipelineStage, TeamMember } from '../services/api';
import { ConfirmModal } from '../components/ConfirmModal';
import { gstinProblem, normalizeGstin } from '../utils/gst';
import { safeHttpsUrl, WHATSAPP_HOSTS } from '../utils/links';
import { formatIndianDate, formatIndianDateTime } from '../utils/dateUtils';
import { 
  Users, 
  Search, 
  Plus, 
  Filter, 
  Phone, 
  Building2, 
  Receipt,
  X,
  Calendar,
  Clock,
  CalendarRange,
  ChevronDown,
  UserCheck,
  Bell,
  CalendarPlus,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Download,
  Upload,
  Trash2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface LeadsPageProps {
  tenantId?: string;
  currentUser?: CurrentUser | null;
  /** The company's own pipeline stages (falls back to the standard set). */
  stages?: PipelineStage[];
  onLeadClick: (lead: Lead) => void;
  onConvertToBill: (lead: Lead) => void;
  onUpdateCategory?: (leadId: string, category: string) => void;
  onMoveStage?: (leadId: string, currentStage: string, nextStage: string) => void;
}

const PAGE_SIZE = 100;
const DEFAULT_STAGE_OPTIONS = [
  { id: 'NEW', label: 'New Inquiry' },
  { id: 'CONTACTED', label: 'Contacted' },
  { id: 'DEMO_SCHEDULED', label: 'Demo / Spec Sent' },
  { id: 'PROPOSAL_SENT', label: 'Proposal Sent' },
  { id: 'NEGOTIATION', label: 'Negotiation' },
  { id: 'WON', label: 'Won (Invoiced)' },
  { id: 'LOST', label: 'Lost' },
];

export const LeadsPage: React.FC<LeadsPageProps> = ({
  currentUser,
  stages,
  onLeadClick,
  onConvertToBill,
  onUpdateCategory,
  onMoveStage
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // What this person may do (the server enforces every one of these on each request)
  const viewAll = can(currentUser, 'leads_view_all');
  const isStaff = !viewAll; // sees only the leads assigned to them
  const canAssign = can(currentUser, 'leads_assign');
  const canEdit = can(currentUser, 'leads_create_edit');
  const canDelete = can(currentUser, 'leads_delete');
  const canExport = can(currentUser, 'leads_export');
  const canImport = can(currentUser, 'leads_import');
  const canBill = can(currentUser, 'billing_convert');
  const stageOptions = stages && stages.length > 0 ? stages.map((st) => ({ id: st.id, label: st.label })) : DEFAULT_STAGE_OPTIONS;

  // Team Members for Staff Assignment & Filter
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [gstStates, setGstStates] = useState<Array<{ code: string; name: string }>>([]);

  // Filter States
  const [search, setSearch] = useState('');
  const [selectedStage, setSelectedStage] = useState('all');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStaff, setSelectedStaff] = useState('all');
  const [followUpFilter, setFollowUpFilter] = useState<string>('all');
  const [followUpSummary, setFollowUpSummary] = useState<{
    today_count: number;
    overdue_count: number;
    upcoming_count: number;
    total_active: number;
  }>({ today_count: 0, overdue_count: 0, upcoming_count: 0, total_active: 0 });

  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'last_7_days' | 'last_30_days' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  // New Lead Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newProduct, setNewProduct] = useState('');
  const [newSource, setNewSource] = useState('manual');
  const [newCategory, setNewCategory] = useState('WARM');
  const [newDealValue, setNewDealValue] = useState<number>(0);
  const [newCity, setNewCity] = useState('');
  const [newStateCode, setNewStateCode] = useState('');
  const [newGstin, setNewGstin] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // CSV export / import and delete
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [deletedLeads, setDeletedLeads] = useState<Lead[]>([]);
  const [deletedTotal, setDeletedTotal] = useState(0);
  const [restoringId, setRestoringId] = useState('');

  // WhatsApp Follow-up Alert Dispatch State
  const [isSendingWaAlerts, setIsSendingWaAlerts] = useState(false);
  const [waAlertResult, setWaAlertResult] = useState<any>(null);

  const handleSendWhatsAppAlerts = async () => {
    setIsSendingWaAlerts(true);
    setWaAlertResult(null);
    const res = await api.sendFollowupWhatsAppAlerts();
    setIsSendingWaAlerts(false);
    if (isApiError(res)) {
      setWaAlertResult({ status: 'error', message: apiMessage(res, 'Failed to dispatch alerts.') });
      return;
    }
    setWaAlertResult(res);
  };

  // People a lead can be assigned to / filtered by (only needed by those who see the whole team's leads)
  useEffect(() => {
    if (!viewAll && !canAssign) return;
    let alive = true;
    api.getTeamMembers().then((res) => {
      if (!alive || isApiError(res)) return;
      setTeamMembers(Array.isArray(res?.members) ? res.members.filter((m: TeamMember) => m.is_active) : []);
    });
    return () => {
      alive = false;
    };
  }, [viewAll, canAssign]);

  useEffect(() => {
    let alive = true;
    api.getGstStates().then((res) => alive && setGstStates(res));
    return () => {
      alive = false;
    };
  }, []);

  const currentFilters = useCallback(
    () => ({
      search,
      stage: selectedStage === 'all' ? '' : selectedStage,
      source: selectedSource === 'all' ? '' : selectedSource,
      category: selectedCategory === 'all' ? '' : selectedCategory,
      dateFilter: dateFilter === 'all' ? '' : dateFilter,
      startDate: customStartDate,
      endDate: customEndDate,
      // sales staff: the server returns only their own leads whatever is asked for here
      assignedTo: viewAll && selectedStaff !== 'all' ? selectedStaff : '',
      followUpFilter: followUpFilter === 'all' ? '' : followUpFilter,
    }),
    [search, selectedStage, selectedSource, selectedCategory, dateFilter, customStartDate, customEndDate, viewAll, selectedStaff, followUpFilter]
  );

  const loadFollowUpSummary = useCallback(async () => {
    const res = await api.getFollowupsSummary();
    if (!res || isApiError(res)) return;
    setFollowUpSummary({
      today_count: res.today_count || 0,
      overdue_count: res.overdue_count || 0,
      upcoming_count: res.upcoming_count || 0,
      total_active: res.total_active || 0,
    });
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const f = currentFilters();
    const res = await api.getLeads(
      undefined, f.search, f.stage, f.source, f.category, f.dateFilter, f.startDate, f.endDate, f.assignedTo, f.followUpFilter,
      { skip: page * PAGE_SIZE, limit: PAGE_SIZE }
    );
    setLeads(Array.isArray(res.items) ? res.items : []);
    setTotal(res.total || 0);
    setLoading(false);
    loadFollowUpSummary();
  }, [currentFilters, page, loadFollowUpSummary]);

  // a changed filter always starts again from the first page
  useEffect(() => {
    setPage(0);
  }, [search, selectedStage, selectedSource, selectedCategory, selectedStaff, followUpFilter, dateFilter, customStartDate, customEndDate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadLeads();
    }, 250);
    return () => clearTimeout(timer);
  }, [loadLeads, currentUser?.id]);

  const handleAssignLead = async (leadId: string, staffId: string) => {
    const res = await api.assignLead(leadId, staffId === 'unassigned' ? null : staffId);
    if (isApiError(res)) setNotice({ type: 'error', text: apiMessage(res, 'The lead could not be assigned.') });
    loadLeads();
  };

  const newGstinProblem = gstinProblem(newGstin);

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || (!newPhone.trim() && !newEmail.trim()) || newGstinProblem) return;

    setIsCreating(true);
    setCreateError('');
    const res = await api.createLead(undefined, {
      full_name: newName.trim(),
      phone: newPhone.trim(),
      email: newEmail.trim() || undefined,
      company_name: newCompany.trim() || undefined,
      product_inquired: newProduct.trim() || undefined,
      source: newSource,
      category: newCategory,
      deal_value: Number(newDealValue) || 0,
      city: newCity.trim() || undefined,
      state_code: newStateCode || undefined,
      gstin: normalizeGstin(newGstin) || undefined,
    });
    setIsCreating(false);

    if (isApiError(res)) {
      setCreateError(apiMessage(res, 'The lead could not be saved.'));
      return;
    }
    setShowAddModal(false);
    setNewName('');
    setNewPhone('');
    setNewEmail('');
    setNewCompany('');
    setNewProduct('');
    setNewCategory('WARM');
    setNewDealValue(0);
    setNewCity('');
    setNewStateCode('');
    setNewGstin('');
    // an existing contact is not duplicated: the inquiry is added to its history instead
    setNotice({ type: res.is_duplicate ? 'error' : 'success', text: res.message || 'Lead created' });
    loadLeads();
  };

  const handleExport = async () => {
    setIsExporting(true);
    const result = await api.exportLeadsCsv(currentFilters());
    setIsExporting(false);
    if (!result.ok) setNotice({ type: 'error', text: result.message || 'The export could not be created.' });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setNotice({ type: 'error', text: 'Please choose a .csv file.' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setNotice({ type: 'error', text: 'The CSV file is larger than 5 MB.' });
      return;
    }
    setIsImporting(true);
    setImportErrors([]);
    const res = await api.importLeadsCsv(file);
    setIsImporting(false);
    if (isApiError(res)) {
      setNotice({ type: 'error', text: apiMessage(res, 'The file could not be imported.') });
      return;
    }
    setNotice({ type: 'success', text: res.message || 'Import finished.' });
    setImportErrors(Array.isArray(res.errors) ? res.errors.slice(0, 20) : []);
    loadLeads();
  };

  const handleDeleteLead = async () => {
    if (!leadToDelete) return;
    setIsDeleting(true);
    const res = await api.deleteLead(leadToDelete._id || leadToDelete.id || '');
    setIsDeleting(false);
    setLeadToDelete(null);
    if (isApiError(res)) {
      setNotice({ type: 'error', text: apiMessage(res, 'The lead could not be deleted.') });
      return;
    }
    setNotice({ type: 'success', text: 'Lead deleted. It can be restored from "Deleted leads".' });
    loadLeads();
  };

  const loadRecycleBin = useCallback(async () => {
    const res = await api.getDeletedLeads({ limit: 100 });
    setDeletedLeads(Array.isArray(res.items) ? res.items : []);
    setDeletedTotal(res.total || 0);
  }, []);

  const openRecycleBin = () => {
    setShowRecycleBin(true);
    loadRecycleBin();
  };

  const handleRestoreLead = async (lead: Lead) => {
    const id = lead._id || lead.id || '';
    setRestoringId(id);
    const res = await api.restoreLead(id);
    setRestoringId('');
    if (isApiError(res)) {
      setNotice({ type: 'error', text: apiMessage(res, 'The lead could not be restored.') });
      return;
    }
    setNotice({ type: 'success', text: `${lead.full_name} has been restored.` });
    loadRecycleBin();
    loadLeads();
  };

  const handleCategoryChange = async (leadId: string, newCat: string) => {
    setLeads((prev) => prev.map((l) => (l._id === leadId || l.id === leadId ? { ...l, category: newCat } : l)));
    if (onUpdateCategory) {
      onUpdateCategory(leadId, newCat);
      return;
    }
    const res = await api.updateLeadCategory(leadId, newCat);
    if (isApiError(res)) {
      setNotice({ type: 'error', text: apiMessage(res, 'The category could not be changed.') });
      loadLeads();
    }
  };

  const handleStageChange = async (leadId: string, currentStage: string, nextStage: string) => {
    // Optimistic update; the list is reloaded if the server refuses
    setLeads((prev) =>
      prev.map((l) => (l._id === leadId || l.id === leadId ? { ...l, stage: nextStage, next_follow_up: null } : l))
    );
    if (onMoveStage) {
      onMoveStage(leadId, currentStage, nextStage);
      window.setTimeout(loadFollowUpSummary, 800);
      return;
    }
    const res = await api.updateLeadStage(leadId, nextStage);
    if (isApiError(res)) {
      setNotice({ type: 'error', text: apiMessage(res, 'The stage could not be changed.') });
      loadLeads();
      return;
    }
    loadFollowUpSummary();
  };

  const getSourceBadge = (source: string) => {
    switch (source?.toLowerCase()) {
      case 'indiamart':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">IndiaMART</span>;
      case 'tradeindia':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">TradeIndia</span>;
      case 'facebook':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Meta Ads</span>;
      case 'justdial':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">Justdial</span>;
      case 'website':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Website</span>;
      default:
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">{source?.toUpperCase() || 'MANUAL'}</span>;
    }
  };

  const getCategoryBadge = (category?: string) => {
    const cat = (category || 'WARM').toUpperCase();
    if (cat === 'HOT') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
          <span>🔥</span>
          <span>HOT</span>
        </span>
      );
    } else if (cat === 'COLD') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          <span>❄️</span>
          <span>COLD</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <span>☀️</span>
        <span>WARM</span>
      </span>
    );
  };

  const getStageBadge = (stage: string) => {
    switch (stage?.toUpperCase()) {
      case 'NEW':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">New Inquiry</span>;
      case 'CONTACTED':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Contacted</span>;
      case 'DEMO_SCHEDULED':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">Demo Sent</span>;
      case 'PROPOSAL_SENT':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">Proposal Sent</span>;
      case 'NEGOTIATION':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-800 border border-orange-200">Negotiation</span>;
      case 'WON':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Won (Invoiced)</span>;
      case 'LOST':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">Lost</span>;
      default:
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            {stageOptions.find((st) => st.id === stage)?.label || stage}
          </span>
        );
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasActiveFilters = search || selectedStage !== 'all' || selectedSource !== 'all' || selectedCategory !== 'all' || (!isStaff && selectedStaff !== 'all') || dateFilter !== 'all' || followUpFilter !== 'all';

  const resetAllFilters = () => {
    setSearch('');
    setSelectedStage('all');
    setSelectedSource('all');
    setSelectedCategory('all');
    if (!isStaff) setSelectedStaff('all');
    setFollowUpFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setShowCustomPicker(false);
  };

  return (
    <div className="space-y-4">
      {/* Header & New Lead Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">
              {followUpFilter === 'today' ? "🔔 Today's Scheduled Follow-ups" :
               followUpFilter === 'overdue' ? "🚨 Overdue Follow-ups" :
               followUpFilter === 'upcoming' ? "📅 Upcoming Scheduled Follow-ups" :
               "All Inbound & Outbound Leads"}
            </h2>
            {isStaff && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300">
                👤 My Leads Only
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {isStaff 
              ? `Showing only the leads assigned to you (${currentUser?.full_name}).`
              : "Real-time multi-channel lead master with pipeline status, follow-up alerts, CRM category, and 1-click billing."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canDelete && (
            <button
              onClick={openRecycleBin}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              title="Leads that were deleted. They are kept on record and can be restored."
            >
              <Trash2 className="h-4 w-4" />
              <span>Deleted leads</span>
            </button>
          )}
          {canImport && (
            <>
              <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} />
              <button
                onClick={() => fileInput.current?.click()}
                disabled={isImporting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Columns: full_name, phone, email, company_name, city, state, pincode, address, gstin, product_inquired, inquiry_message, deal_value, category"
              >
                <Upload className="h-4 w-4" />
                <span>{isImporting ? 'Importing…' : 'Import CSV'}</span>
              </button>
            </>
          )}
          {canExport && (
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Download the leads that match the current filters. Every export is recorded in the audit trail."
            >
              <Download className="h-4 w-4" />
              <span>{isExporting ? 'Preparing…' : 'Export CSV'}</span>
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => { setCreateError(''); setShowAddModal(true); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Add New Lead</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`p-3 rounded-2xl border text-xs flex items-start justify-between gap-3 ${
            notice.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="space-y-1">
            <span className="font-bold flex items-center gap-1.5">
              {notice.type === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}
              <span>{notice.text}</span>
            </span>
            {importErrors.length > 0 && (
              <ul className="list-disc pl-6 text-[11px] text-slate-600">
                {importErrors.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={() => { setNotice(null); setImportErrors([]); }} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Follow-up Quick View Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-100/80 p-2 rounded-2xl border border-slate-200">
        <button
          onClick={() => setFollowUpFilter('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            followUpFilter === 'all'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>All Leads Master</span>
        </button>

        <button
          onClick={() => setFollowUpFilter('today')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            followUpFilter === 'today'
              ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-300'
              : 'bg-white text-amber-900 hover:bg-amber-50 border border-amber-200'
          }`}
        >
          <Bell className="h-3.5 w-3.5 text-amber-500" />
          <span>🔔 Today's Follow-ups</span>
          {followUpSummary.today_count > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              followUpFilter === 'today' ? 'bg-white text-amber-700' : 'bg-amber-500 text-white'
            }`}>
              {followUpSummary.today_count}
            </span>
          )}
        </button>

        <button
          onClick={() => setFollowUpFilter('overdue')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            followUpFilter === 'overdue'
              ? 'bg-rose-600 text-white shadow-sm ring-2 ring-rose-300'
              : 'bg-white text-rose-800 hover:bg-rose-50 border border-rose-200'
          }`}
        >
          <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
          <span>🚨 Overdue Follow-ups</span>
          {followUpSummary.overdue_count > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              followUpFilter === 'overdue' ? 'bg-white text-rose-700' : 'bg-rose-600 text-white'
            }`}>
              {followUpSummary.overdue_count}
            </span>
          )}
        </button>

        <button
          onClick={() => setFollowUpFilter('upcoming')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            followUpFilter === 'upcoming'
              ? 'bg-emerald-700 text-white shadow-sm ring-2 ring-emerald-300'
              : 'bg-white text-emerald-800 hover:bg-emerald-50 border border-emerald-200'
          }`}
        >
          <Calendar className="h-3.5 w-3.5 text-emerald-600" />
          <span>📅 Upcoming Follow-ups</span>
          {followUpSummary.upcoming_count > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              followUpFilter === 'upcoming' ? 'bg-white text-emerald-700' : 'bg-emerald-600 text-white'
            }`}>
              {followUpSummary.upcoming_count}
            </span>
          )}
        </button>

        {/* WhatsApp Alert Button for Company Admin / Manager */}
        {viewAll && (
          <button
            type="button"
            onClick={handleSendWhatsAppAlerts}
            disabled={isSendingWaAlerts}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
            title="Send WhatsApp Follow-up Reminders to all staff members with pending follow-ups"
          >
            <MessageSquare className="h-3.5 w-3.5 text-white" />
            <span>{isSendingWaAlerts ? 'Dispatching...' : '📲 Send WhatsApp Alerts to Staff'}</span>
          </button>
        )}
      </div>

      {/* WhatsApp Dispatch Result Card */}
      {waAlertResult && (
        <div className={`p-3.5 rounded-2xl border text-xs flex items-start justify-between gap-3 ${
          waAlertResult.status === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <div className="space-y-1">
            <span className="font-bold flex items-center gap-1.5">
              {waAlertResult.status === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-rose-600" />}
              <span>{waAlertResult.message || 'WhatsApp alert dispatch completed.'}</span>
            </span>
            {Array.isArray(waAlertResult.results) && waAlertResult.results.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {waAlertResult.results.map((r: any, idx: number) => (
                  <div key={idx} className="bg-white/90 px-2.5 py-1 rounded-lg border border-emerald-300 text-[11px] flex items-center gap-2">
                    <span className="font-bold text-slate-800">👤 {r.staff_name}:</span>
                    <span className="text-emerald-700 font-semibold">{r.pending_count} pending</span>
                    {safeHttpsUrl(r.whatsapp_link, WHATSAPP_HOSTS) && (
                      <a
                        href={safeHttpsUrl(r.whatsapp_link, WHATSAPP_HOSTS) || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 font-bold underline"
                      >
                        Open WhatsApp Web
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setWaAlertResult(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 1. Main Filter Bar (Search + Dropdowns) */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-2.5">
          {/* Live Search */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search leads by customer name, phone (+91), company, or product..."
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-50/60 text-slate-800 placeholder-slate-400"
            />
          </div>

          {/* Filter: Pipeline Stage */}
          <div className="w-full md:w-44 shrink-0">
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50/60 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
            >
              <option value="all">All Pipeline Stages</option>
              {stageOptions.map((st) => (
                <option key={st.id} value={st.id}>{st.label}</option>
              ))}
            </select>
          </div>

          {/* Filter: Lead Source Channel */}
          <div className="w-full md:w-44 shrink-0">
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50/60 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
            >
              <option value="all">All Lead Sources</option>
              <option value="indiamart">IndiaMART</option>
              <option value="tradeindia">TradeIndia</option>
              <option value="facebook">Meta / FB Ads</option>
              <option value="justdial">Justdial</option>
              <option value="website">Website Form</option>
              <option value="manual">Manual Entry</option>
            </select>
          </div>

          {/* Filter: Lead Category (Hot / Warm / Cold) */}
          <div className="w-full md:w-44 shrink-0">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50/60 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
            >
              <option value="all">All CRM Categories</option>
              <option value="HOT">🔥 Hot (Immediate Close)</option>
              <option value="WARM">☀️ Warm (In Discussion)</option>
              <option value="COLD">❄️ Cold (Nurture)</option>
            </select>
          </div>

          {/* Filter: Staff / Assigned Member (Strictly locked when logged-in as staff) */}
          <div className="w-full md:w-44 shrink-0">
            {isStaff ? (
              <div 
                className="w-full border border-indigo-300 rounded-xl px-3 py-2 text-xs bg-indigo-100/80 text-indigo-900 font-bold flex items-center justify-between" 
                title="You see the leads assigned to you."
              >
                <span className="truncate">👤 {currentUser?.full_name || 'My Leads'}</span>
                <span className="text-[10px] bg-indigo-200 text-indigo-800 px-1.5 py-0.5 rounded font-black shrink-0">MY LEADS</span>
              </div>
            ) : (
              <select
                value={selectedStaff}
                onChange={(e) => setSelectedStaff(e.target.value)}
                className="w-full border border-indigo-200 rounded-xl px-3 py-2 text-xs bg-indigo-50/50 text-indigo-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold cursor-pointer"
              >
                <option value="all">👥 All Team Members (All Leads)</option>
                <option value="unassigned">⚠️ Unassigned Leads (Pool)</option>
                {teamMembers.map((m) => (
                  <option key={m._id} value={m._id}>
                    👤 {m.full_name} ({m.designation || (m.role === 'company_admin' ? 'Company Admin' : m.role === 'manager' ? 'Manager' : 'Staff')})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* 2. Date Filter Sub-Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-1">
              <Calendar className="h-3 w-3 text-indigo-600" />
              <span>Date Filter:</span>
            </span>

            <button
              onClick={() => { setDateFilter('all'); setShowCustomPicker(false); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                dateFilter === 'all' ? 'bg-slate-900 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => { setDateFilter('today'); setShowCustomPicker(false); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                dateFilter === 'today' ? 'bg-indigo-600 text-white shadow-2xs ring-2 ring-indigo-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Clock className="h-3 w-3" />
              <span>Today</span>
            </button>
            <button
              onClick={() => { setDateFilter('last_7_days'); setShowCustomPicker(false); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                dateFilter === 'last_7_days' ? 'bg-indigo-600 text-white shadow-2xs ring-2 ring-indigo-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => { setDateFilter('last_30_days'); setShowCustomPicker(false); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                dateFilter === 'last_30_days' ? 'bg-indigo-600 text-white shadow-2xs ring-2 ring-indigo-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => { setDateFilter('custom'); setShowCustomPicker(!showCustomPicker); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                dateFilter === 'custom' ? 'bg-indigo-600 text-white shadow-2xs ring-2 ring-indigo-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <CalendarRange className="h-3 w-3" />
              <span>Custom Range</span>
            </button>

            {hasActiveFilters && (
              <button
                onClick={resetAllFilters}
                className="flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-lg border border-rose-200 transition-colors ml-1"
              >
                <X className="h-3 w-3" />
                <span>Reset All Filters</span>
              </button>
            )}
          </div>

          <div className="text-[11px] font-semibold text-slate-500">
            Total <span className="font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">{total.toLocaleString('en-IN')}</span> leads matched
          </div>
        </div>

        {/* Custom Date Pickers */}
        {(showCustomPicker || dateFilter === 'custom') && (
          <div className="flex flex-wrap items-center gap-3 bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-200 text-xs text-slate-700">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-indigo-900">From Date:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-indigo-300 bg-white text-slate-800 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-indigo-900">To Date:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-indigo-300 bg-white text-slate-800 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs"
              />
            </div>
            {(customStartDate || customEndDate) && (
              <span className="text-[11px] font-semibold text-indigo-800 bg-white px-2 py-1 rounded-md border border-indigo-200">
                Range: {customStartDate || 'Start'} to {customEndDate || 'Now'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs space-y-2">
            <div className="animate-spin h-6 w-6 border-2 border-indigo-600 border-t-transparent rounded-full mx-auto" />
            <p>Loading filtered leads database...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-xs space-y-2">
            <Users className="h-10 w-10 mx-auto text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No leads found matching your criteria</p>
            <p className="text-[11px] text-slate-400">Try adjusting your search terms, stage, channel, or date filters.</p>
            {hasActiveFilters && (
              <button
                onClick={resetAllFilters}
                className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5">Customer & Company</th>
                  <th className="p-3.5">Phone & Email</th>
                  <th className="p-3.5">Lead Source</th>
                  <th className="p-3.5">Category (Hot/Cold)</th>
                  <th className="p-3.5">Assigned Staff</th>
                  <th className="p-3.5">Next Follow-up</th>
                  <th className="p-3.5">Pipeline Status</th>
                  <th className="p-3.5">Product Inquired</th>
                  <th className="p-3.5 text-right">Deal Value</th>
                  <th className="p-3.5 text-center">Billed?</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((l) => {
                  const leadId = l._id || l.id || '';
                  return (
                    <tr
                      key={leadId}
                      onClick={() => onLeadClick(l)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      {/* Customer & Company */}
                      <td className="p-3.5">
                        <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {l.full_name}
                        </div>
                        {l.company_name && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3 w-3 text-slate-400" />
                            <span>{l.company_name}</span>
                          </div>
                        )}
                        {l.created_at && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {formatIndianDate(l.created_at)}
                          </div>
                        )}
                      </td>

                      {/* Phone & Email */}
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-800 flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400" />
                          <span>{l.phone}</span>
                        </div>
                        {l.email && <div className="text-[10px] text-slate-400 mt-0.5">{l.email}</div>}
                      </td>

                      {/* Source */}
                      <td className="p-3.5">
                        {getSourceBadge(l.source)}
                      </td>

                      {/* Category (Hot, Warm, Cold) with Quick Dropdown */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {getCategoryBadge(l.category)}
                          <select
                            value={(l.category || 'WARM').toUpperCase()}
                            disabled={!canEdit}
                            onChange={(e) => handleCategoryChange(leadId, e.target.value)}
                            className="text-[10px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-700 rounded px-1.5 py-0.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                            title="Update Category"
                          >
                            <option value="HOT">🔥 Hot</option>
                            <option value="WARM">☀️ Warm</option>
                            <option value="COLD">❄️ Cold</option>
                          </select>
                        </div>
                      </td>

                      {/* Assigned Staff (with 1-Click Dropdown for Admin/Manager) */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        {canAssign ? (
                          <select
                            value={l.assigned_to_user_id || 'unassigned'}
                            onChange={(e) => handleAssignLead(leadId, e.target.value)}
                            className="text-[10px] font-semibold bg-indigo-50/70 hover:bg-indigo-100/90 text-indigo-900 rounded-lg px-2 py-1 border border-indigo-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[130px] truncate shadow-2xs"
                            title="Assign to Staff / Sales Rep"
                          >
                            <option value="unassigned">⚠️ Unassigned</option>
                            {teamMembers
                              .filter((m) => m.role !== 'company_admin' && m.role !== 'super_admin')
                              .map((m) => (
                                <option key={m._id} value={m._id}>
                                  👤 {m.full_name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <div>
                            {l.assigned_to_user_name ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                <span>👤</span>
                                <span className="truncate max-w-[100px]">{l.assigned_to_user_name}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                Unassigned
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Next Follow-up */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        {l.next_follow_up && l.next_follow_up.status === 'PENDING' ? (
                          (() => {
                            const sched = new Date(l.next_follow_up.scheduled_at);
                            const now = new Date();
                            const schedDate = new Date(sched.getFullYear(), sched.getMonth(), sched.getDate()).getTime();
                            const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                            const isOverdue = sched < now && schedDate < nowDate;
                            const isToday = schedDate === nowDate;

                            return (
                              <div className="space-y-1">
                                <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border ${
                                  isOverdue
                                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                                    : isToday
                                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                                    : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                }`}>
                                  {isOverdue ? '🚨 Overdue' : isToday ? '🔔 Due Today' : '📅 Upcoming'}
                                </span>
                                <div className="text-[11px] font-bold text-slate-800 truncate max-w-[130px]">
                                  {formatIndianDateTime(l.next_follow_up.scheduled_at, false)}
                                </div>
                                {l.next_follow_up.note && (
                                  <p className="text-[10px] text-slate-500 truncate max-w-[130px]" title={l.next_follow_up.note}>
                                    {l.next_follow_up.note}
                                  </p>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <button
                            onClick={() => onLeadClick(l)}
                            className="text-[10px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <CalendarPlus className="h-3 w-3" />
                            <span>+ Follow-up</span>
                          </button>
                        )}
                      </td>

                      {/* Pipeline Status (Stage) with Quick Dropdown */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {getStageBadge(l.stage)}
                          <select
                            value={l.stage}
                            disabled={!canEdit}
                            onChange={(e) => handleStageChange(leadId, l.stage, e.target.value)}
                            className="text-[10px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer max-w-[100px] truncate"
                            title="Update Pipeline Stage"
                          >
                            {!stageOptions.some((st) => st.id === l.stage) && <option value={l.stage}>{l.stage}</option>}
                            {stageOptions.map((st) => (
                              <option key={st.id} value={st.id}>{st.label}</option>
                            ))}
                          </select>
                        </div>
                      </td>

                      {/* Product Inquired */}
                      <td className="p-3.5 text-slate-700 font-medium">
                        {l.product_inquired ? (
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-semibold text-slate-700">
                            {l.product_inquired}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* Deal Value */}
                      <td className="p-3.5 text-right font-extrabold text-emerald-600">
                        {l.deal_value > 0 ? `₹${Number(l.deal_value).toLocaleString('en-IN')}` : <span className="text-slate-400 font-normal">Open</span>}
                      </td>

                      {/* Billed? */}
                      <td className="p-3.5 text-center">
                        {l.conversion_info?.is_converted ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            {l.conversion_info.invoice_number || 'Invoiced'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">Pending</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-right space-x-1.5" onClick={(e) => e.stopPropagation()}>
                        {canBill && !l.conversion_info?.is_converted && (
                          <button
                            onClick={() => onConvertToBill(l)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                          >
                            Convert to Bill
                          </button>
                        )}
                        <button
                          onClick={() => onLeadClick(l)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          Details
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => setLeadToDelete(l)}
                            aria-label={`Delete ${l.full_name}`}
                            title="Delete lead (can be restored by an administrator)"
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors align-middle"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {(page * PAGE_SIZE + 1).toLocaleString('en-IN')}–{Math.min(total, (page + 1) * PAGE_SIZE).toLocaleString('en-IN')} of{' '}
            {total.toLocaleString('en-IN')}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <span>Page {page + 1} of {pages}</span>
            <button
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 disabled:opacity-40 flex items-center gap-1"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(leadToDelete)}
        title="Delete this lead?"
        message={`${leadToDelete?.full_name || 'This lead'} will be removed from every list. Its history is kept and it can be restored from "Deleted leads". Bills already issued are not affected.`}
        confirmText="Delete lead"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleDeleteLead}
        onCancel={() => setLeadToDelete(null)}
      />

      {/* Recycle bin */}
      {showRecycleBin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 my-auto text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-base text-slate-900">Deleted leads</h3>
                <p className="text-[11px] text-slate-500">{deletedTotal.toLocaleString('en-IN')} kept on record. Deleting and restoring are written to the audit trail.</p>
              </div>
              <button onClick={() => setShowRecycleBin(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
              {deletedLeads.length === 0 && <p className="py-10 text-center text-xs text-slate-400">Nothing has been deleted.</p>}
              {deletedLeads.map((item) => {
                const id = item._id || item.id || '';
                return (
                  <div key={id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span className="font-bold text-slate-900 block truncate">{item.full_name}</span>
                      <span className="text-slate-500 block truncate">
                        {[item.phone, item.company_name, item.product_inquired].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRestoreLead(item)}
                      disabled={Boolean(restoringId)}
                      className="shrink-0 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold disabled:opacity-50"
                    >
                      {restoringId === id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-base text-slate-900">Create New Inbound / Outbound Lead</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {createError && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLead} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  placeholder="e.g. Ramesh Patel"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required={!newEmail.trim()}
                    maxLength={30}
                    placeholder="e.g. 9876543210"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">E-mail</label>
                  <input
                    type="email"
                    maxLength={254}
                    placeholder="name@company.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Company Name</label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="e.g. Patel Engineering Works"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">City</label>
                  <input
                    type="text"
                    maxLength={100}
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">State (for GST)</label>
                  <select
                    value={newStateCode}
                    onChange={(e) => setNewStateCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- Select --</option>
                    {gstStates.map((st) => (
                      <option key={st.code} value={st.code}>{st.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Customer GSTIN (if registered)</label>
                <input
                  type="text"
                  maxLength={15}
                  placeholder="15 characters"
                  value={newGstin}
                  onChange={(e) => setNewGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
                  className={`w-full border rounded-xl px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 ${newGstinProblem ? 'border-rose-400' : 'border-slate-200'}`}
                />
                {newGstinProblem && <p className="text-[10px] text-rose-600 mt-1">{newGstinProblem}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Lead Source</label>
                  <select
                    value={newSource}
                    onChange={(e) => setNewSource(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="manual">Manual Entry</option>
                    <option value="indiamart">IndiaMART</option>
                    <option value="tradeindia">TradeIndia</option>
                    <option value="facebook">Meta / FB Ads</option>
                    <option value="justdial">Justdial</option>
                    <option value="website">Website Form</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">CRM Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                  >
                    <option value="HOT">🔥 Hot (Immediate)</option>
                    <option value="WARM">☀️ Warm (In Discussion)</option>
                    <option value="COLD">❄️ Cold (Nurture)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Product / Requirement Inquired</label>
                <input
                  type="text"
                  maxLength={300}
                  placeholder="e.g. Heavy Lathe Machine 15HP"
                  value={newProduct}
                  onChange={(e) => setNewProduct(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Estimated Deal Value (₹)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="50000"
                  value={newDealValue}
                  onChange={(e) => setNewDealValue(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || Boolean(newGstinProblem)}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50"
                >
                  {isCreating ? 'Saving...' : 'Add Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
