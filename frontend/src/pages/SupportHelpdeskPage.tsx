import React, { useState, useEffect } from 'react';
import { 
  CurrentUser, 
  TenantInfo, 
  SupportTicket, 
  api 
} from '../services/api';
import { 
  LifeBuoy, 
  Plus, 
  Search, 
  Filter, 
  Building2, 
  User, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  RefreshCw, 
  MessageSquare, 
  Sparkles,
  ChevronRight,
  ShieldAlert,
  Compass,
  Receipt,
  Users,
  Bug,
  Tag
} from 'lucide-react';
import { CreateTicketModal } from '../components/CreateTicketModal';
import { TicketDetailModal } from '../components/TicketDetailModal';

interface SupportHelpdeskPageProps {
  currentUser: CurrentUser;
  tenantInfo: TenantInfo | null;
}

const CATEGORY_ICONS: Record<string, any> = {
  webhooks: Compass,
  billing: Receipt,
  whatsapp_sms: MessageSquare,
  leads: Users,
  team_access: ShieldAlert,
  general_bug: Bug,
};

const STATUS_TABS = [
  { id: 'all', label: 'All Tickets' },
  { id: 'OPEN', label: 'Open' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'WAITING_FOR_CLIENT', label: 'Waiting for Client' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: 'CLOSED', label: 'Closed' },
];

export const SupportHelpdeskPage: React.FC<SupportHelpdeskPageProps> = ({
  currentUser,
  tenantInfo,
}) => {
  const isSuperAdmin = currentUser.role === 'super_admin';
  const effectiveTenantId = isSuperAdmin ? 'all' : (tenantInfo?.id || currentUser.tenant_id || 'demo_tenant_01');

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    open: number;
    in_progress: number;
    urgent: number;
    resolved: number;
  }>({ total: 0, open: 0, in_progress: 0, urgent: 0, resolved: 0 });

  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [companyFilter, setCompanyFilter] = useState<string>('all');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);

  // Available tenant list for Super Admin filter
  const [tenantList, setTenantList] = useState<Array<{ id: string; company_name: string }>>([]);

  const loadTenants = async () => {
    if (!isSuperAdmin) return;
    try {
      const data = await api.getSuperAdminCompanies();
      if (Array.isArray(data)) {
        setTenantList(data.map((t: any) => ({ id: t._id || t.id, company_name: t.company_name })));
      }
    } catch (err) {
      console.error('Failed to load tenants for filter:', err);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);

      const targetTenantId = isSuperAdmin 
        ? (companyFilter !== 'all' ? companyFilter : 'all') 
        : effectiveTenantId;

      const [ticketsRes, statsRes] = await Promise.all([
        api.getSupportTickets({
          tenantId: targetTenantId,
          userRole: currentUser.role,
          status: statusFilter,
          priority: priorityFilter,
          category: categoryFilter,
          search: searchQuery.trim() || undefined,
        }),
        api.getSupportStats(targetTenantId, currentUser.role)
      ]);

      if (Array.isArray(ticketsRes)) {
        setTickets(ticketsRes);
      } else {
        setTickets([]);
      }

      if (statsRes && !statsRes.detail) {
        setStats(statsRes);
      }
    } catch (err) {
      console.error('Failed to load support tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, [isSuperAdmin]);

  useEffect(() => {
    loadData();
  }, [statusFilter, priorityFilter, categoryFilter, companyFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>OPEN</span>
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="h-3 w-3 text-blue-500" />
            <span>IN PROGRESS</span>
          </span>
        );
      case 'WAITING_FOR_CLIENT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <span>WAITING CLIENT</span>
          </span>
        );
      case 'RESOLVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-purple-50 text-purple-700 border border-purple-200">
            <CheckCircle2 className="h-3 w-3 text-purple-600" />
            <span>RESOLVED</span>
          </span>
        );
      case 'CLOSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 border border-slate-300">
            <span>CLOSED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-700 border border-red-300 animate-pulse">
            <span>CRITICAL URGENT</span>
          </span>
        );
      case 'HIGH':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
            <span>HIGH</span>
          </span>
        );
      case 'MEDIUM':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
            <span>MEDIUM</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <span>LOW</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center space-x-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 shrink-0">
            <LifeBuoy className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                {isSuperAdmin ? 'Central Support & Helpdesk Hub' : 'Help & Support Desk'}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wider">
                {isSuperAdmin ? 'Platform-Wide View' : 'Dedicated Support'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              {isSuperAdmin 
                ? 'Centralized command center to monitor, triage and resolve customer issues across all organizations.'
                : 'Need help with Webhooks, Billing, WhatsApp API or Lead Pipeline? Raise a ticket and get instant assistance.'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <button
            onClick={() => loadData()}
            className="p-2.5 rounded-2xl border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
            title="Refresh Tickets"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold text-xs shadow-lg shadow-indigo-600/25 active:scale-95 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Raise Support Ticket</span>
          </button>
        </div>
      </div>

      {/* Stats Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700">
            <Tag className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Logged</span>
            <span className="text-xl font-black text-slate-900">{stats.total}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Open Tickets</span>
            <span className="text-xl font-black text-emerald-700">{stats.open}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">In Progress</span>
            <span className="text-xl font-black text-blue-700">{stats.in_progress}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-red-50 text-red-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block">Urgent / Critical</span>
            <span className="text-xl font-black text-red-700">{stats.urgent}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Resolved</span>
            <span className="text-xl font-black text-purple-700">{stats.resolved}</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-4">
        
        {/* Top Controls: Search & Super Admin Filter */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          
          {/* Search form */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ticket #, subject, requester..."
              className="w-full pl-10 pr-4 py-2 rounded-2xl border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
            />
          </form>

          {/* Super Admin Company Selector */}
          {isSuperAdmin && (
            <div className="flex items-center space-x-2">
              <Building2 className="h-4 w-4 text-slate-500 shrink-0" />
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="px-3 py-2 rounded-2xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">🏢 All Companies / Tenants</option>
                {tenantList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.company_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-2xl border border-slate-200 text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Categories</option>
            <option value="webhooks">Webhooks & Ingestion</option>
            <option value="billing">Billing & Invoices</option>
            <option value="whatsapp_sms">WhatsApp & SMS</option>
            <option value="leads">Leads & Pipeline</option>
            <option value="team_access">Team & Permissions</option>
            <option value="general_bug">UI Bug / Issue</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 rounded-2xl border border-slate-200 text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Priorities</option>
            <option value="URGENT">Critical Urgent</option>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low Priority</option>
          </select>
        </div>

        {/* Status Tabs Navigation */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 kanban-col pt-1 border-t border-slate-100">
          {STATUS_TABS.map((tab) => {
            const isActive = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ticket List View */}
      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-3">
          <div className="h-8 w-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-500">Loading support tickets...</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-4">
          <div className="h-16 w-16 bg-slate-100 text-slate-400 rounded-3xl flex items-center justify-center mx-auto">
            <LifeBuoy className="h-8 w-8 text-slate-400" />
          </div>
          <div className="space-y-1">
            <h4 className="text-base font-bold text-slate-800">No Support Tickets Found</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {searchQuery || statusFilter !== 'all' || categoryFilter !== 'all'
                ? 'No tickets match your active filter criteria. Try resetting filters or search query.'
                : 'Everything is running smoothly! If you ever face an issue or need assistance, click the button below.'}
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>Raise a Ticket Now</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const CatIcon = CATEGORY_ICONS[t.category] || Compass;
            const messageCount = (t.messages || []).length;

            return (
              <div
                key={t._id}
                onClick={() => setSelectedTicket(t)}
                className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-indigo-400/60 hover:shadow-md transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Left: TCK number, Company Tag, Subject, Description preview */}
                <div className="flex items-start space-x-3.5 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-slate-100 group-hover:bg-indigo-50 text-slate-600 group-hover:text-indigo-600 flex items-center justify-center shrink-0 transition-colors">
                    <CatIcon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                        {t.ticket_number}
                      </span>

                      {/* Tagged Company Tag */}
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                        <Building2 className="h-3 w-3 text-slate-500" />
                        <span>{t.company_name}</span>
                      </span>

                      {getStatusBadge(t.status)}
                      {getPriorityBadge(t.priority)}
                    </div>

                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                      {t.subject}
                    </h4>
                    
                    <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                      {t.description}
                    </p>
                  </div>
                </div>

                {/* Right: Requester info, replies count, action button */}
                <div className="flex items-center justify-between md:justify-end space-x-4 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 text-xs">
                  <div className="text-left md:text-right">
                    <div className="flex items-center gap-1 text-slate-700 font-semibold">
                      <User className="h-3.5 w-3.5 text-slate-400" />
                      <span>{t.user_name}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block">
                      {new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-bold text-xs">
                    <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
                    <span>{messageCount}</span>
                  </div>

                  <button
                    type="button"
                    className="p-2 rounded-xl bg-slate-100 group-hover:bg-indigo-600 text-slate-600 group-hover:text-white transition-all"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Ticket Modal */}
      <CreateTicketModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        currentUser={currentUser}
        tenantInfo={tenantInfo}
        defaultContextPage={isSuperAdmin ? 'Super Admin Console' : 'CRM Main Dashboard'}
        onTicketCreated={(newTicket) => {
          loadData();
          setSelectedTicket(newTicket);
        }}
      />

      {/* Ticket Detail & Thread Modal */}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          currentUser={currentUser}
          onClose={() => setSelectedTicket(null)}
          onTicketUpdated={(updated) => {
            setSelectedTicket(updated);
            loadData();
          }}
        />
      )}

    </div>
  );
};
