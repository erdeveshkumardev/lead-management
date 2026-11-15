import React, { useEffect, useState } from 'react';
import { Lead, api, CurrentUser, TeamMember } from '../services/api';
import { formatIndianDate } from '../utils/dateUtils';
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
  UserCheck
} from 'lucide-react';

interface LeadsPageProps {
  tenantId?: string;
  currentUser?: CurrentUser | null;
  onLeadClick: (lead: Lead) => void;
  onConvertToBill: (lead: Lead) => void;
  onUpdateCategory?: (leadId: string, category: string) => void;
  onMoveStage?: (leadId: string, currentStage: string, nextStage: string) => void;
}

export const LeadsPage: React.FC<LeadsPageProps> = ({ 
  tenantId, 
  currentUser,
  onLeadClick, 
  onConvertToBill,
  onUpdateCategory,
  onMoveStage
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Team Members for Staff Assignment & Filter
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const canAssign = !currentUser || currentUser.role === 'company_admin' || currentUser.role === 'manager' || currentUser.role === 'super_admin';

  // Filter States
  const [search, setSearch] = useState('');
  const [selectedStage, setSelectedStage] = useState('all');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStaff, setSelectedStaff] = useState('all');
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
  const [isCreating, setIsCreating] = useState(false);

  // Load team members for assignment
  useEffect(() => {
    api.getTeamMembers(tenantId || 'demo_tenant_01')
      .then((res) => {
        if (res && res.members) {
          setTeamMembers(res.members.filter((m: TeamMember) => m.is_active));
        }
      })
      .catch((err) => console.error('Failed to load team members:', err));
  }, [tenantId]);

  const loadLeads = () => {
    setLoading(true);
    api.getLeads(
      tenantId,
      search,
      selectedStage === 'all' ? '' : selectedStage,
      selectedSource === 'all' ? '' : selectedSource,
      selectedCategory === 'all' ? '' : selectedCategory,
      dateFilter === 'all' ? '' : dateFilter,
      customStartDate,
      customEndDate,
      selectedStaff === 'all' ? '' : selectedStaff
    )
      .then((res) => {
        if (res && res.items) setLeads(res.items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadLeads();
    }, 250);
    return () => clearTimeout(timer);
  }, [tenantId, search, selectedStage, selectedSource, selectedCategory, selectedStaff, dateFilter, customStartDate, customEndDate]);

  const handleAssignLead = async (leadId: string, staffId: string) => {
    try {
      const finalUserId = staffId === 'unassigned' ? null : staffId;
      await api.assignLead(leadId, finalUserId, undefined, currentUser?.full_name || 'Admin', tenantId);
      loadLeads();
    } catch (err) {
      console.error('Failed to assign lead:', err);
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPhone) return;

    setIsCreating(true);
    try {
      await api.createLead(tenantId, {
        full_name: newName,
        phone: newPhone,
        email: newEmail || undefined,
        company_name: newCompany || undefined,
        product_inquired: newProduct || undefined,
        source: newSource,
        category: newCategory,
        deal_value: Number(newDealValue) || 0,
      });
      setShowAddModal(false);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setNewCompany('');
      setNewProduct('');
      setNewCategory('WARM');
      loadLeads();
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCategoryChange = async (leadId: string, newCat: string) => {
    try {
      if (onUpdateCategory) {
        onUpdateCategory(leadId, newCat);
      } else {
        await api.updateLeadCategory(leadId, newCat, undefined, tenantId);
      }
      setLeads((prev) =>
        prev.map((l) => (l._id === leadId || l.id === leadId ? { ...l, category: newCat } : l))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleStageChange = async (leadId: string, currentStage: string, nextStage: string) => {
    try {
      if (onMoveStage) {
        onMoveStage(leadId, currentStage, nextStage);
      } else {
        await api.updateLeadStage(leadId, nextStage, undefined, tenantId);
      }
      setLeads((prev) =>
        prev.map((l) => (l._id === leadId || l.id === leadId ? { ...l, stage: nextStage } : l))
      );
    } catch (err) {
      console.error(err);
    }
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
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">{stage}</span>;
    }
  };

  const hasActiveFilters = search || selectedStage !== 'all' || selectedSource !== 'all' || selectedCategory !== 'all' || selectedStaff !== 'all' || dateFilter !== 'all';

  const resetAllFilters = () => {
    setSearch('');
    setSelectedStage('all');
    setSelectedSource('all');
    setSelectedCategory('all');
    setSelectedStaff('all');
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
          <h2 className="text-xl font-bold text-slate-900">All Inbound & Outbound Leads</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time multi-channel lead master with pipeline status, CRM category (Hot/Warm/Cold), and 1-click billing.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Add New Lead</span>
        </button>
      </div>

      {/* 1. Main Filter Bar (Search + Dropdowns) */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-2.5">
          {/* Live Search */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search leads by customer name, phone (+91), company, or product..."
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
              <option value="NEW">New Inquiry</option>
              <option value="CONTACTED">Contacted</option>
              <option value="DEMO_SCHEDULED">Demo / Spec Sent</option>
              <option value="PROPOSAL_SENT">Proposal Sent</option>
              <option value="NEGOTIATION">Negotiation</option>
              <option value="WON">Won (Invoiced)</option>
              <option value="LOST">Lost</option>
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

          {/* Filter: Staff / Assigned Member */}
          <div className="w-full md:w-44 shrink-0">
            <select
              value={selectedStaff}
              onChange={(e) => setSelectedStaff(e.target.value)}
              className="w-full border border-indigo-200 rounded-xl px-3 py-2 text-xs bg-indigo-50/50 text-indigo-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold cursor-pointer"
            >
              <option value="all">👤 All Staff Members</option>
              <option value="unassigned">⚠️ Unassigned Leads</option>
              {teamMembers.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.full_name}
                </option>
              ))}
            </select>
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
            Total <span className="font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">{leads.length}</span> leads matched
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
                            {teamMembers.map((m) => (
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

                      {/* Pipeline Status (Stage) with Quick Dropdown */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {getStageBadge(l.stage)}
                          <select
                            value={l.stage}
                            onChange={(e) => handleStageChange(leadId, l.stage, e.target.value)}
                            className="text-[10px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer max-w-[100px] truncate"
                            title="Update Pipeline Stage"
                          >
                            <option value="NEW">New Inquiry</option>
                            <option value="CONTACTED">Contacted</option>
                            <option value="DEMO_SCHEDULED">Demo / Spec Sent</option>
                            <option value="PROPOSAL_SENT">Proposal Sent</option>
                            <option value="NEGOTIATION">Negotiation</option>
                            <option value="WON">Won (Invoiced)</option>
                            <option value="LOST">Lost</option>
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
                        {!l.conversion_info?.is_converted && (
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-base text-slate-900">Create New Inbound / Outbound Lead</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Patel"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Phone Number *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 9876543210"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Company Name</label>
                <input
                  type="text"
                  placeholder="e.g. Patel Engineering Works"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
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
                  disabled={isCreating}
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
