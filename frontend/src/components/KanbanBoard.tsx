import React, { useState } from 'react';
import { Lead, PipelineStage } from '../services/api';
import { parseUtcDate } from '../utils/dateUtils';
import { 
  Building2, 
  Phone, 
  Receipt, 
  ChevronRight, 
  Sliders,
  GripVertical,
  Sparkles,
  MoveHorizontal,
  LayoutGrid,
  Rows,
  Calendar,
  Clock,
  CalendarRange,
  X,
  Filter
} from 'lucide-react';

interface KanbanBoardProps {
  kanbanData: Record<string, Lead[]>;
  stages: PipelineStage[];
  onLeadClick: (lead: Lead) => void;
  onConvertToBill: (lead: Lead) => void;
  onMoveStage: (leadId: string, currentStage: string, nextStage: string) => void;
  onUpdateCategory?: (leadId: string, category: string) => void;
  onOpenStagesModal?: () => void;
}

const COLOR_CLASSES: Record<string, { bg: string; border: string; glow: string }> = {
  blue: { bg: 'bg-blue-50 text-blue-700', border: 'border-blue-200', glow: 'ring-blue-400 bg-blue-50/50' },
  amber: { bg: 'bg-amber-50 text-amber-800', border: 'border-amber-200', glow: 'ring-amber-400 bg-amber-50/50' },
  indigo: { bg: 'bg-indigo-50 text-indigo-700', border: 'border-indigo-200', glow: 'ring-indigo-400 bg-indigo-50/50' },
  purple: { bg: 'bg-purple-50 text-purple-700', border: 'border-purple-200', glow: 'ring-purple-400 bg-purple-50/50' },
  orange: { bg: 'bg-orange-50 text-orange-800', border: 'border-orange-200', glow: 'ring-orange-400 bg-orange-50/50' },
  emerald: { bg: 'bg-emerald-50 text-emerald-700', border: 'border-emerald-200', glow: 'ring-emerald-400 bg-emerald-50/50' },
  rose: { bg: 'bg-rose-50 text-rose-700', border: 'border-rose-200', glow: 'ring-rose-400 bg-rose-50/50' },
  slate: { bg: 'bg-slate-100 text-slate-700', border: 'border-slate-300', glow: 'ring-slate-400 bg-slate-50/50' },
};

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  kanbanData,
  stages,
  onLeadClick,
  onConvertToBill,
  onMoveStage,
  onUpdateCategory,
  onOpenStagesModal,
}) => {
  // Drag and Drop States
  const [draggedLead, setDraggedLead] = useState<{ id: string; fromStage: string } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Density Toggle: Compact View (Default for max leads visibility) vs Standard View
  const [isCompact, setIsCompact] = useState<boolean>(true);

  // Filter States: Date Range & CRM Lead Category (Hot, Warm, Cold)
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'HOT' | 'WARM' | 'COLD'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'last_7_days' | 'last_30_days' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);

  const getCategoryBadge = (category?: string) => {
    const cat = (category || 'WARM').toUpperCase();
    if (cat === 'HOT') {
      return (
        <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200" title="Category: Hot (Immediate Close / 4h SLA)">
          <span>🔥</span>
          <span>HOT</span>
        </span>
      );
    } else if (cat === 'COLD') {
      return (
        <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200" title="Category: Cold (Nurture / 72h SLA)">
          <span>❄️</span>
          <span>COLD</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200" title="Category: Warm (In Discussion / 24h SLA)">
        <span>☀️</span>
        <span>WARM</span>
      </span>
    );
  };

  const getSourceBadge = (source: string) => {
    switch (source?.toLowerCase()) {
      case 'indiamart':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">IndiaMART</span>;
      case 'tradeindia':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">TradeIndia</span>;
      case 'facebook':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Meta</span>;
      case 'website':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Web</span>;
      default:
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">{source || 'Direct'}</span>;
    }
  };

  const stageList = stages && stages.length > 0 ? stages : [
    { id: 'NEW', label: 'New Inquiries', color: 'blue', order: 0 },
    { id: 'CONTACTED', label: 'Contacted', color: 'amber', order: 1 },
    { id: 'DEMO_SCHEDULED', label: 'Demo / Spec Sent', color: 'indigo', order: 2 },
    { id: 'PROPOSAL_SENT', label: 'Quotation Sent', color: 'purple', order: 3 },
    { id: 'NEGOTIATION', label: 'Negotiation', color: 'orange', order: 4 },
    { id: 'WON', label: 'Won (Invoiced)', color: 'emerald', order: 5 },
    { id: 'LOST', label: 'Lost', color: 'slate', order: 6 },
  ];

  // Combined Date & Category Filtering Predicate
  const filterLead = (lead: Lead) => {
    // 1. Category Filter
    if (categoryFilter !== 'all') {
      const cat = (lead.category || 'WARM').toUpperCase();
      if (cat !== categoryFilter) return false;
    }

    // 2. Date Filter
    if (dateFilter === 'all') return true;
    if (!lead.created_at) return true;

    const leadDate = parseUtcDate(lead.created_at) || new Date(lead.created_at);
    if (isNaN(leadDate.getTime())) return true;

    const now = new Date();

    if (dateFilter === 'today') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return leadDate >= startOfToday && leadDate <= endOfToday;
    }

    if (dateFilter === 'last_7_days') {
      const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
      return leadDate >= sevenDaysAgo;
    }

    if (dateFilter === 'last_30_days') {
      const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0);
      return leadDate >= thirtyDaysAgo;
    }

    if (dateFilter === 'custom') {
      let matches = true;
      if (customStartDate) {
        const s = new Date(customStartDate);
        s.setHours(0, 0, 0, 0);
        matches = matches && leadDate >= s;
      }
      if (customEndDate) {
        const e = new Date(customEndDate);
        e.setHours(23, 59, 59, 999);
        matches = matches && leadDate <= e;
      }
      return matches;
    }

    return true;
  };

  // Total and Filtered Leads Count
  const totalLeadsCount = Object.values(kanbanData).reduce((acc, curr) => acc + (curr?.length || 0), 0);
  const filteredLeadsCount = Object.values(kanbanData).reduce(
    (acc, curr) => acc + (curr ? curr.filter(filterLead).length : 0),
    0
  );

  // Drag Handlers
  const handleDragStart = (e: React.DragEvent, lead: Lead, fromStage: string) => {
    const leadId = lead._id || lead.id || '';
    setDraggedLead({ id: leadId, fromStage });
    e.dataTransfer.setData('application/json', JSON.stringify({ leadId, fromStage }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStage !== stageId) {
      setDragOverStage(stageId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverStage(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setDragOverStage(null);

    let leadId = draggedLead?.id;
    let fromStage = draggedLead?.fromStage;

    if (!leadId) {
      try {
        const parsed = JSON.parse(e.dataTransfer.getData('application/json'));
        leadId = parsed.leadId;
        fromStage = parsed.fromStage;
      } catch {
        // fallback
      }
    }

    setDraggedLead(null);

    if (leadId && targetStageId && fromStage !== targetStageId) {
      onMoveStage(leadId, fromStage || '', targetStageId);
    }
  };

  const handleDragEnd = () => {
    setDraggedLead(null);
    setDragOverStage(null);
  };

  return (
    <div className="space-y-3">
      {/* 1. Top Control Bar (Drag & Drop Notice + Density View + Customize Button) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-gradient-to-r from-slate-50 via-indigo-50/25 to-slate-50 py-2 px-3 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-2 text-xs text-slate-700">
          <div className="p-1 rounded-lg bg-indigo-100 text-indigo-700 shrink-0">
            <MoveHorizontal className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold text-slate-800 text-[11px] sm:text-xs">
            Drag & Drop Active: <span className="text-slate-500 font-normal">Card ko pakad kar kisi bhi stage me drop karein.</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View Density Switcher: Compact vs Standard */}
          <div className="flex items-center bg-white p-0.5 rounded-xl border border-slate-200 shadow-2xs text-[11px]">
            <button
              onClick={() => setIsCompact(true)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold transition-all ${
                isCompact
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Compact View (Fits multiple leads nicely without scrolling)"
            >
              <LayoutGrid className="h-3 w-3" />
              <span>Compact View</span>
            </button>
            <button
              onClick={() => setIsCompact(false)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold transition-all ${
                !isCompact
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Standard View (Larger cards)"
            >
              <Rows className="h-3 w-3" />
              <span>Comfortable</span>
            </button>
          </div>

          {onOpenStagesModal && (
            <button
              onClick={onOpenStagesModal}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition-all shadow-2xs"
            >
              <Sliders className="h-3.5 w-3.5 text-indigo-600" />
              <span>Customize Stages</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Date Filter Bar (Today, Last 7 Days, Last 30 Days, Custom Range) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1 mr-1">
            <Filter className="h-3.5 w-3.5 text-indigo-600" />
            <span>Date Range:</span>
          </span>

          {/* Preset: All Time */}
          <button
            onClick={() => {
              setDateFilter('all');
              setShowCustomPicker(false);
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              dateFilter === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Leads
          </button>

          {/* Preset: Today */}
          <button
            onClick={() => {
              setDateFilter('today');
              setShowCustomPicker(false);
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              dateFilter === 'today'
                ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-300'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Clock className="h-3 w-3" />
            <span>Today</span>
          </button>

          {/* Preset: Last 7 Days */}
          <button
            onClick={() => {
              setDateFilter('last_7_days');
              setShowCustomPicker(false);
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              dateFilter === 'last_7_days'
                ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-300'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Last 7 Days
          </button>

          {/* Preset: Last 30 Days */}
          <button
            onClick={() => {
              setDateFilter('last_30_days');
              setShowCustomPicker(false);
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              dateFilter === 'last_30_days'
                ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-300'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Last 30 Days
          </button>

          {/* Preset: Custom Dates */}
          <button
            onClick={() => {
              setDateFilter('custom');
              setShowCustomPicker(!showCustomPicker);
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              dateFilter === 'custom'
                ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-300'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <CalendarRange className="h-3 w-3" />
            <span>Custom Dates</span>
          </button>

          {/* CRM Lead Category Filter (Hot, Warm, Cold) */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 ml-1">
            <span className="text-[10px] font-bold text-slate-500 px-1.5">Category:</span>
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                categoryFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setCategoryFilter('HOT')}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                categoryFilter === 'HOT'
                  ? 'bg-rose-500 text-white shadow-2xs'
                  : 'text-rose-700 hover:bg-rose-100'
              }`}
            >
              🔥 Hot
            </button>
            <button
              onClick={() => setCategoryFilter('WARM')}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                categoryFilter === 'WARM'
                  ? 'bg-amber-500 text-white shadow-2xs'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              ☀️ Warm
            </button>
            <button
              onClick={() => setCategoryFilter('COLD')}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                categoryFilter === 'COLD'
                  ? 'bg-blue-500 text-white shadow-2xs'
                  : 'text-blue-700 hover:bg-blue-100'
              }`}
            >
              ❄️ Cold
            </button>
          </div>

          {/* Reset Filter Button */}
          {(dateFilter !== 'all' || categoryFilter !== 'all') && (
            <button
              onClick={() => {
                setDateFilter('all');
                setCategoryFilter('all');
                setCustomStartDate('');
                setCustomEndDate('');
                setShowCustomPicker(false);
              }}
              className="flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded-lg border border-rose-200 transition-colors ml-1"
            >
              <X className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Right: Showing Match Counts */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">
            Showing <span className="font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">{filteredLeadsCount}</span> of {totalLeadsCount} leads
          </span>
        </div>
      </div>

      {/* 3. Custom Date Range Pickers (Visible when custom dates selected) */}
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
            <span className="text-[11px] font-semibold text-indigo-800 bg-white px-2 py-1 rounded-md border border-indigo-200 shadow-2xs">
              Filtering: {customStartDate ? new Date(customStartDate).toLocaleDateString('en-IN') : 'Start'} to{' '}
              {customEndDate ? new Date(customEndDate).toLocaleDateString('en-IN') : 'Now'}
            </span>
          )}
        </div>
      )}

      {/* 4. Columns Container */}
      <div className="flex gap-3 overflow-x-auto pb-4 pt-1 kanban-col min-h-[calc(100vh-250px)] select-none">
        {stageList.map((stg, idx) => {
          const colorCfg = COLOR_CLASSES[stg.color] || COLOR_CLASSES['blue'];
          const rawLeads = kanbanData[stg.id] || [];
          const leads = rawLeads.filter(filterLead);
          const nextStageObj = idx < stageList.length - 1 ? stageList[idx + 1] : null;
          const isOver = dragOverStage === stg.id;
          const isSourceOfDrag = draggedLead?.fromStage === stg.id;

          // Responsive column width: Compact is 270px so 5-6 columns fit easily; Standard is 310px
          const colWidth = isCompact ? 'w-[270px]' : 'w-80';

          return (
            <div
              key={stg.id}
              onDragOver={(e) => handleDragOver(e, stg.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stg.id)}
              className={`flex-shrink-0 ${colWidth} rounded-2xl p-2.5 flex flex-col border transition-all duration-150 ${
                isOver && !isSourceOfDrag
                  ? 'ring-2 ring-indigo-500 bg-indigo-50/80 border-indigo-300 shadow-md scale-[1.01]'
                  : 'bg-slate-100/75 border-slate-200 shadow-inner'
              }`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center space-x-1.5">
                  <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-lg border ${colorCfg.bg} ${colorCfg.border}`}>
                    {stg.label}
                  </span>
                  <span className="text-[11px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded-full border border-slate-200 shadow-xs">
                    {leads.length}
                  </span>
                </div>

                {isOver && !isSourceOfDrag && (
                  <span className="flex items-center gap-1 text-[9px] font-black text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full animate-pulse">
                    <Sparkles className="h-2.5 w-2.5" />
                    Drop Target
                  </span>
                )}
              </div>

              {/* Leads Cards List & Drop Zone */}
              <div className={`space-y-2 overflow-y-auto flex-1 pr-1 kanban-col ${isCompact ? 'space-y-2' : 'space-y-3'}`}>
                {/* Active Drop Placeholder at the top when dragging over this stage */}
                {isOver && !isSourceOfDrag && (
                  <div className="py-2.5 px-3 border-2 border-dashed border-indigo-500 bg-indigo-100/70 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-bold text-indigo-700 animate-pulse">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Drop in {stg.label}</span>
                  </div>
                )}

                {leads.length === 0 ? (
                  <div
                    className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-xs p-3 text-center transition-all ${
                      isCompact ? 'h-24' : 'h-32'
                    } ${
                      isOver && !isSourceOfDrag
                        ? 'border-indigo-400 bg-indigo-100/50 text-indigo-700 font-bold'
                        : 'border-slate-200 text-slate-400'
                    }`}
                  >
                    {isOver && !isSourceOfDrag ? (
                      <>
                        <Sparkles className="h-5 w-5 mb-1 text-indigo-600 animate-bounce" />
                        <span className="text-xs">Release to drop</span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-[11px]">No leads</span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {dateFilter !== 'all' ? 'None in this date range' : 'Drag & drop here'}
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  leads.map((lead) => {
                    const leadId = lead._id || lead.id || '';
                    const isDraggingThis = draggedLead?.id === leadId;

                    return (
                      <div
                        key={leadId}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, lead, stg.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => onLeadClick(lead)}
                        className={`group bg-white rounded-xl border transition-all duration-150 relative cursor-grab active:cursor-grabbing hover:shadow-md ${
                          isCompact ? 'p-2.5' : 'p-3.5'
                        } ${
                          isDraggingThis
                            ? 'opacity-30 scale-95 border-dashed border-indigo-400 shadow-inner'
                            : 'border-slate-200/90 hover:border-indigo-400'
                        }`}
                      >
                        {/* 1. Header: Grip + Name + Source Badge */}
                        <div className="flex items-center justify-between gap-1.5 mb-1">
                          <div className="flex items-center gap-1 min-w-0">
                            <div className="text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0">
                              <GripVertical className="h-3.5 w-3.5" />
                            </div>
                            <h4 className="font-bold text-xs text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                              {lead.full_name}
                            </h4>
                          </div>
                          <div className="shrink-0 flex items-center gap-1">
                            {getCategoryBadge(lead.category)}
                            {getSourceBadge(lead.source)}
                          </div>
                        </div>

                        {/* 2. Company & Product (Inline compact tag row) */}
                        {(lead.company_name || lead.product_inquired) && (
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mb-1.5 overflow-hidden">
                            {lead.company_name && (
                              <span className="flex items-center gap-1 text-slate-500 font-medium truncate max-w-[130px]" title={lead.company_name}>
                                <Building2 className="h-2.5 w-2.5 shrink-0 text-slate-400" />
                                <span className="truncate">{lead.company_name}</span>
                              </span>
                            )}
                            {lead.company_name && lead.product_inquired && (
                              <span className="text-slate-300 shrink-0">•</span>
                            )}
                            {lead.product_inquired && (
                              <span 
                                className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[120px]" 
                                title={lead.product_inquired}
                              >
                                {lead.product_inquired}
                              </span>
                            )}
                          </div>
                        )}

                        {/* 3. Phone & Deal Value + Lead Date */}
                        <div className="flex items-center justify-between text-[11px] mb-1.5 text-slate-500">
                          <div className="flex items-center gap-1 text-slate-600 font-medium">
                            <Phone className="h-2.5 w-2.5 text-slate-400" />
                            <span>{lead.phone}</span>
                            {lead.created_at && (
                              <span className="text-[10px] text-slate-400 ml-1">
                                ({(parseUtcDate(lead.created_at) || new Date(lead.created_at)).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })})
                              </span>
                            )}
                          </div>
                          {lead.deal_value > 0 ? (
                            <span className="font-extrabold text-emerald-600 text-xs">
                              ₹{Number(lead.deal_value).toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-medium">Open Val</span>
                          )}
                        </div>

                        {/* 4. Bottom Action Bar (Ultra-Compact) */}
                        <div 
                          className="flex items-center justify-between pt-1.5 border-t border-slate-100 gap-1.5" 
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Invoice / Convert Button */}
                          {lead.conversion_info?.is_converted ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              <Receipt className="h-2.5 w-2.5" />
                              <span className="truncate max-w-[70px]">{lead.conversion_info.invoice_number || 'Billed'}</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => onConvertToBill(lead)}
                              className="flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md border border-blue-200 transition-colors"
                            >
                              <Receipt className="h-2.5 w-2.5" />
                              <span>Bill</span>
                            </button>
                          )}

                          {/* Category Switcher, Stage Selector & Move Right Arrow */}
                          <div className="flex items-center gap-1">
                            <select
                              value={(lead.category || 'WARM').toUpperCase()}
                              onChange={(e) => {
                                if (onUpdateCategory) onUpdateCategory(leadId, e.target.value);
                              }}
                              className="text-[10px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-700 rounded px-1.5 py-0.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                              title="Change Lead Category (Hot / Warm / Cold)"
                            >
                              <option value="HOT">🔥 Hot</option>
                              <option value="WARM">☀️ Warm</option>
                              <option value="COLD">❄️ Cold</option>
                            </select>

                            <select
                              value={stg.id}
                              onChange={(e) => {
                                const target = e.target.value;
                                if (target && target !== stg.id) {
                                  onMoveStage(leadId, stg.id, target);
                                }
                              }}
                              className="text-[10px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[95px] truncate"
                              title="Directly select stage"
                            >
                              {stageList.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>

                            {nextStageObj && (
                              <button
                                onClick={() => onMoveStage(leadId, stg.id, nextStageObj.id)}
                                title={`Move to next: ${nextStageObj.label}`}
                                className="p-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
