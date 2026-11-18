import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './components/LoginPage';
import { KanbanBoard } from './components/KanbanBoard';
import { ConvertToBillModal } from './components/ConvertToBillModal';
import { LeadDetailModal } from './components/LeadDetailModal';
import { PipelineStagesModal } from './components/PipelineStagesModal';
import { Dashboard } from './pages/Dashboard';
import { LeadsPage } from './pages/LeadsPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ProductsPage } from './pages/ProductsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SupportHelpdeskPage } from './pages/SupportHelpdeskPage';
import { SuperAdminPortal } from './pages/superadmin/SuperAdminPortal';
import { GlobalMastersPortal } from './pages/superadmin/GlobalMastersPortal';
import { CompanyMastersPage } from './pages/masters/CompanyMastersPage';
import { TeamManager } from './pages/team/TeamManager';
import { FirstLoginPasswordModal } from './components/FirstLoginPasswordModal';
import { UserProfileModal } from './components/UserProfileModal';
import { Lead, PipelineStage, CurrentUser, TenantInfo, api, API_BASE_URL } from './services/api';
import { Zap, X, CheckCircle2, Sliders, ShieldCheck, Building2, Bell, ChevronRight, AlertCircle } from 'lucide-react';

export function App() {
  // Current Logged-in User & Tenant from localStorage (Session persistence)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    try {
      const savedUser = localStorage.getItem('leadcrm_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(() => {
    try {
      const savedTenant = localStorage.getItem('leadcrm_tenant');
      return savedTenant ? JSON.parse(savedTenant) : null;
    } catch {
      return null;
    }
  });

  const [currentTab, setCurrentTab] = useState<string>(() => {
    try {
      const savedUser = localStorage.getItem('leadcrm_user');
      const user = savedUser ? JSON.parse(savedUser) : null;
      if (user?.role === 'super_admin') return 'superadmin';
      return 'kanban';
    } catch {
      return 'kanban';
    }
  });
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [kanbanData, setKanbanData] = useState<Record<string, Lead[]>>({});
  const [selectedLeadForDetail, setSelectedLeadForDetail] = useState<Lead | null>(null);
  const [selectedLeadForBill, setSelectedLeadForBill] = useState<Lead | null>(null);
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [showStagesModal, setShowStagesModal] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [simulateSuccess, setSimulateSuccess] = useState<string>('');

  const activeTenantId = tenantInfo?.id || currentUser?.tenant_id || 'demo_tenant_01';

  const [followUpSummary, setFollowUpSummary] = useState<{
    today_count: number;
    overdue_count: number;
    upcoming_count: number;
    total_active: number;
  }>({ today_count: 0, overdue_count: 0, upcoming_count: 0, total_active: 0 });

  // Load custom pipeline stages per company
  const loadStages = async (tenantId = activeTenantId) => {
    try {
      const res = await api.getPipelineStages(tenantId);
      const stageList = Array.isArray(res) ? res : (res?.stages || []);
      if (Array.isArray(stageList) && stageList.length > 0) {
        setStages(stageList);
      }
    } catch (err) {
      console.error('Failed to load stages:', err);
    }
  };

  const loadFollowUpSummary = async (tenantId = activeTenantId) => {
    try {
      const isCompanyAdmin = currentUser?.role === 'company_admin' || currentUser?.role === 'super_admin';
      const res = await api.getFollowupsSummary(tenantId, !isCompanyAdmin ? currentUser?.id : undefined);
      if (res) {
        setFollowUpSummary({
          today_count: res.today_count || 0,
          overdue_count: res.overdue_count || 0,
          upcoming_count: res.upcoming_count || 0,
          total_active: res.total_active || 0,
        });
      }
    } catch (err) {
      console.error('Failed to load follow-up summary:', err);
    }
  };

  const loadKanban = async (tenantId = activeTenantId) => {
    try {
      // Unassigned leads are strictly visible to Company Admin / Super Admin only!
      // Staff members only receive leads assigned to their own user ID.
      const isCompanyAdmin = currentUser?.role === 'company_admin' || currentUser?.role === 'super_admin';
      const data = await api.getKanbanBoard(tenantId, !isCompanyAdmin ? currentUser?.id : undefined);
      setKanbanData(data);
    } catch (err) {
      console.error('Failed to load kanban:', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      loadStages(activeTenantId);
      loadKanban(activeTenantId);
      loadFollowUpSummary(activeTenantId);
    }
  }, [currentUser, activeTenantId]);

  useEffect(() => {
    if (currentUser && (currentTab === 'kanban' || currentTab === 'dashboard')) {
      loadKanban(activeTenantId);
      loadFollowUpSummary(activeTenantId);
    }
  }, [currentTab]);

  // Role Access Guard: Ensure staff cannot access settings, team, masters, or superadmin
  useEffect(() => {
    if (currentUser?.role === 'staff') {
      if (
        currentTab === 'settings' ||
        currentTab === 'team' ||
        currentTab === 'superadmin' ||
        currentTab === 'company_masters' ||
        currentTab === 'global_masters'
      ) {
        setCurrentTab('kanban');
      }
    } else if (currentUser?.role === 'company_admin') {
      if (currentTab === 'superadmin' || currentTab === 'global_masters') {
        setCurrentTab('dashboard');
      }
    } else if (currentUser?.role === 'super_admin') {
      if (
        currentTab === 'kanban' ||
        currentTab === 'leads' ||
        currentTab === 'invoices' ||
        currentTab === 'company_masters' ||
        currentTab === 'team'
      ) {
        setCurrentTab('superadmin');
      }
    }
  }, [currentUser, currentTab]);

  // Login Success Handler
  const handleLoginSuccess = (user: CurrentUser, tenant: TenantInfo | null) => {
    setCurrentUser(user);
    setTenantInfo(tenant);
    if (user.role === 'super_admin') {
      setCurrentTab('superadmin');
    } else {
      setCurrentTab('kanban');
    }
    if (tenant?.id) {
      loadStages(tenant.id);
      loadKanban(tenant.id);
    }
  };

  // Logout Handler
  const handleLogout = () => {
    localStorage.removeItem('leadcrm_user');
    localStorage.removeItem('leadcrm_tenant');
    setCurrentUser(null);
    setTenantInfo(null);
    setCurrentTab('kanban');
  };

  // Switch role handler (Instant Demonstration of Multi-Tenant RBAC)
  const handleSwitchUser = async (targetRole: 'super_admin' | 'company_admin' | 'staff') => {
    let email = 'admin@apexmachineries.com';
    if (targetRole === 'super_admin') email = 'superadmin@leadcash.com';
    else if (targetRole === 'staff') email = 'rajesh@apexmachineries.com';

    try {
      const res = await api.login(email);
      if (res.user) {
        localStorage.setItem('leadcrm_user', JSON.stringify(res.user));
        if (res.tenant) {
          localStorage.setItem('leadcrm_tenant', JSON.stringify(res.tenant));
        } else {
          localStorage.removeItem('leadcrm_tenant');
        }
        setCurrentUser(res.user);
        setTenantInfo(res.tenant || null);

        if (targetRole === 'super_admin') {
          setCurrentTab('superadmin');
        } else if (targetRole === 'company_admin') {
          setCurrentTab('dashboard');
        } else {
          setCurrentTab('kanban');
        }
      }
    } catch (err) {
      console.error('Failed to switch user:', err);
    }
  };

  const handleMoveStage = async (leadId: string, _currentStage: string, nextStage: string) => {
    // 1. Optimistic UI update for instant visual feedback on drag-and-drop
    setKanbanData((prev) => {
      const nextData = { ...prev };
      let movedLead: Lead | null = null;
      for (const [stgId, leadList] of Object.entries(nextData)) {
        const found = (leadList || []).find((l) => (l._id === leadId || l.id === leadId));
        if (found) {
          movedLead = { ...found, stage: nextStage };
          nextData[stgId] = (leadList || []).filter((l) => (l._id !== leadId && l.id !== leadId));
          break;
        }
      }
      if (movedLead) {
        movedLead = { ...movedLead, next_follow_up: null };
        nextData[nextStage] = [movedLead, ...(nextData[nextStage] || [])];
      }
      return nextData;
    });

    try {
      await api.updateLeadStage(leadId, nextStage, undefined, activeTenantId);
      loadKanban(activeTenantId);
      loadFollowUpSummary(activeTenantId);
    } catch (err) {
      console.error('Failed to update stage on server:', err);
      loadKanban(activeTenantId);
      loadFollowUpSummary(activeTenantId);
    }
  };

  const handleUpdateCategory = async (leadId: string, category: string) => {
    setKanbanData((prev) => {
      const nextData = { ...prev };
      for (const [stgId, leadList] of Object.entries(nextData)) {
        const idx = (leadList || []).findIndex((l) => (l._id === leadId || l.id === leadId));
        if (idx !== -1) {
          const updated = { ...leadList[idx], category };
          nextData[stgId] = leadList.map((l, i) => (i === idx ? updated : l));
          break;
        }
      }
      return nextData;
    });

    try {
      await api.updateLeadCategory(leadId, category, undefined, activeTenantId);
      loadKanban(activeTenantId);
    } catch (err) {
      console.error('Failed to update category on server:', err);
      loadKanban(activeTenantId);
    }
  };

  // Inbound Webhook Simulator (IndiaMART, Facebook, Website)
  const handleSimulateWebhook = async (source: string) => {
    setSimulateSuccess('');
    let payload = {};

    if (source === 'indiamart') {
      payload = {
        SENDER_NAME: 'Vikas Sharma',
        SENDER_MOBILE: '9825012345',
        SENDER_EMAIL: 'vikas@sharmatools.com',
        SENDER_COMPANY: 'Sharma Engineering Works',
        SENDER_CITY: 'Surat',
        SENDER_STATE: 'Gujarat',
        PRODUCT_NAME: 'CNC Milling Center 3-Axis',
        QUERY_MESSAGE: 'Looking for prompt quotation and technical spec sheet for 2 units.',
        UNIQUE_QUERY_ID: `IM_${Date.now()}`,
      };
    } else if (source === 'facebook') {
      payload = {
        full_name: 'Anita Desai',
        phone_number: '9898011223',
        email: 'anita@desaiinteriors.com',
        city: 'Mumbai',
        state: 'Maharashtra',
        message: 'Inquired from Meta Lead Ad campaign',
        budget: '₹5,00,000+',
      };
    } else {
      payload = {
        name: 'Karan Mehra',
        phone: '9811122334',
        email: 'karan@mehraexports.com',
        company: 'Mehra Global Exports',
        city: 'Delhi',
        product: 'Hydraulic Press Machine 50 Ton',
        message: 'Need delivery in 30 days with installation warranty.',
      };
    }

    try {
      const webhookUrl = source === 'website' 
        ? `${API_BASE_URL}/webhooks/${source}/${activeTenantId}?token=${activeTenantId}`
        : `${API_BASE_URL}/webhooks/${source}/${activeTenantId}`;
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setSimulateSuccess(data.message || 'Lead ingested successfully!');
      loadKanban(activeTenantId);
      setTimeout(() => {
        setSimulateSuccess('');
        setShowSimulateModal(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to simulate webhook:', err);
    }
  };

  // 1. Without Login, render Login Page ONLY (Protected View)
  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Helper for page title
  const getPageTitle = () => {
    switch (currentTab) {
      case 'superadmin':
        return { title: 'Super Admin Portal', subtitle: 'Manage company tenants, subscriptions & user seat limits' };
      case 'global_masters':
        return { title: 'Global Platform Masters Center', subtitle: 'Standardize States & GST codes, Countries, Cities, and Industries across the ecosystem' };
      case 'company_masters':
        return { title: 'Company CRM Masters Configuration', subtitle: 'Manage Lead Categories (Hot/Warm/Cold), Sources, Lost Reasons, Follow-up Types, & Campaigns' };
      case 'team':
        return { title: 'Team & Granular Permission Manager', subtitle: 'Add managers, sales staff, and allocate permissions' };
      case 'dashboard':
        return { title: 'Sales Performance & Financial Analytics', subtitle: 'Real-time overview of revenue, conversion rates & pipelines' };
      case 'kanban':
        return { title: 'Customizable Lead Pipeline & Stages', subtitle: 'Track opportunities, move stages & convert won leads to GST bills' };
      case 'leads':
        return { title: 'Centralized Lead Ingestion Master', subtitle: 'All inbound inquiries from IndiaMART, TradeIndia, Meta & Website' };
      case 'invoices':
        return { title: 'Invoices, Quotations & GST Billing', subtitle: 'Compliant tax invoices with HSN/SAC codes & 1-click payment ledger' };
      case 'products':
        return { title: 'Product & Pricing Catalog', subtitle: 'Master items with GST tax rates and SKU management' };
      case 'settings':
        return currentUser?.role === 'super_admin'
          ? { title: 'Lead-to-Cash Platform & System Specifications', subtitle: 'Central platform architecture, cloud MongoDB Atlas cluster & global gateway' }
          : { title: 'Company & Marketplace API Settings', subtitle: 'IndiaMART, Facebook, TradeIndia, Justdial API credentials, GST profile & bank ledger' };
      default:
        return { title: 'Lead Management Workspace', subtitle: '' };
    }
  };

  const headerInfo = getPageTitle();

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans selection:bg-indigo-600 selection:text-white">
      {/* 2. Left Full-Height Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        currentUser={currentUser}
        tenantInfo={tenantInfo}
        onLogout={handleLogout}
        onSwitchUser={handleSwitchUser}
        onOpenProfile={() => setShowProfileModal(true)}
      />

      {/* 3. Main Workspace Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-950">
        {/* Top Header Bar */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 px-6 flex items-center justify-between shrink-0 backdrop-blur-md z-30">
          <div>
            <h1 className="text-sm sm:text-base font-extrabold text-white tracking-tight">{headerInfo.title}</h1>
            <p className="text-[11px] text-slate-400 hidden sm:block">{headerInfo.subtitle}</p>
          </div>

          {/* Quick Action Badges */}
          <div className="flex items-center space-x-3">
            {/* Pipeline Stage Customizer Button (when on Kanban) */}
            {currentTab === 'kanban' && (
              <button
                onClick={() => setShowStagesModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-all shadow-sm"
              >
                <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                <span>Customize Stages</span>
              </button>
            )}

            {/* Ingestion Simulator Button */}
            <button
              onClick={() => setShowSimulateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all shadow-sm"
            >
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Simulate Lead Webhook</span>
              <span className="sm:hidden">Simulate</span>
            </button>

            {/* Tenant Badge */}
            {tenantInfo && (
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-semibold text-slate-200">{tenantInfo.company_name}</span>
                <span className="text-[10px] text-indigo-400 font-bold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                  Seat Limit: {tenantInfo.max_users_limit || 5}
                </span>
              </div>
            )}

            {/* Notification Bell (Follow-up Alerts) */}
            {currentUser?.role !== 'super_admin' && (
              <button
                onClick={() => setCurrentTab('leads')}
                className="relative p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition-colors cursor-pointer"
                title={`${followUpSummary.today_count} Today, ${followUpSummary.overdue_count} Overdue Follow-ups`}
              >
                <Bell className="h-4 w-4" />
                {(followUpSummary.today_count > 0 || followUpSummary.overdue_count > 0) && (
                  <span className={`absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full text-[10px] font-black flex items-center justify-center text-white ${
                    followUpSummary.overdue_count > 0 ? 'bg-rose-600 animate-pulse' : 'bg-amber-500'
                  }`}>
                    {followUpSummary.today_count + followUpSummary.overdue_count}
                  </span>
                )}
              </button>
            )}

            {/* User Profile Pill */}
            {currentUser && (
              <button
                onClick={() => setShowProfileModal(true)}
                className="flex items-center gap-2 p-1.5 pr-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition-colors cursor-pointer group"
                title="View & Edit Profile / Change Password"
              >
                <div className="h-7 w-7 rounded-lg bg-indigo-500/20 text-indigo-300 font-bold flex items-center justify-center text-xs border border-indigo-400/30 group-hover:scale-105 transition-transform">
                  {currentUser.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <span className="text-xs font-bold text-white hidden sm:inline max-w-[110px] truncate">
                  {currentUser.full_name}
                </span>
              </button>
            )}
          </div>
        </header>

        {/* Due Follow-ups Reminder Banner */}
        {(followUpSummary.today_count > 0 || followUpSummary.overdue_count > 0) && currentUser?.role !== 'super_admin' && (
          <div 
            onClick={() => setCurrentTab('leads')}
            className="mx-4 sm:mx-6 lg:mx-8 mt-3.5 p-3 bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-indigo-500/15 border border-amber-500/30 rounded-2xl flex items-center justify-between cursor-pointer hover:border-amber-400/60 transition-all text-xs shadow-lg group shrink-0"
          >
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center font-bold shrink-0 border border-amber-400/30">
                <Bell className="h-4 w-4 animate-bounce text-amber-400" />
              </div>
              <div>
                <span className="font-extrabold text-amber-200 block text-xs">
                  Follow-up Action Required!
                </span>
                <p className="text-slate-300 text-[11px]">
                  {currentUser?.role === 'staff' ? 'You have' : 'Your sales team has'}{' '}
                  {followUpSummary.today_count > 0 && (
                    <strong className="text-amber-300 font-bold">{followUpSummary.today_count} follow-up{followUpSummary.today_count > 1 ? 's' : ''} due today</strong>
                  )}
                  {followUpSummary.today_count > 0 && followUpSummary.overdue_count > 0 && ' and '}
                  {followUpSummary.overdue_count > 0 && (
                    <strong className="text-rose-400 font-bold">{followUpSummary.overdue_count} overdue follow-up{followUpSummary.overdue_count > 1 ? 's' : ''}</strong>
                  )}
                  . Click here to open and contact them.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-300 group-hover:translate-x-1 transition-transform shrink-0">
              <span>View Follow-ups</span>
              <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        )}

        {/* Scrollable Content Body */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-900/40">
          <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-200/80 min-h-full text-slate-900">
            {/* Tab: Super Admin Portal */}
            {currentTab === 'superadmin' && <SuperAdminPortal />}

            {/* Tab: Global Masters Portal (Super Admin only) */}
            {currentTab === 'global_masters' && <GlobalMastersPortal />}

            {/* Tab: Company CRM Masters (Company Admin only) */}
            {currentTab === 'company_masters' && <CompanyMastersPage tenantId={activeTenantId} />}

            {/* Tab: Company Team & Granular Permission Manager */}
            {currentTab === 'team' && <TeamManager tenantId={activeTenantId} />}

            {/* Tab: Sales Dashboard */}
            {currentTab === 'dashboard' && (
              <Dashboard
                tenantId={activeTenantId}
                currentUser={currentUser}
                onNavigateToKanban={() => setCurrentTab('kanban')}
                onNavigateToInvoices={() => setCurrentTab('invoices')}
                onLeadClick={(lead) => setSelectedLeadForDetail(lead)}
                onConvertToBill={(lead) => setSelectedLeadForBill(lead)}
              />
            )}

            {/* Tab: Kanban Pipeline with Dynamic Stages */}
            {currentTab === 'kanban' && (
              <KanbanBoard
                kanbanData={kanbanData}
                stages={stages}
                onLeadClick={(lead) => setSelectedLeadForDetail(lead)}
                onConvertToBill={(lead) => setSelectedLeadForBill(lead)}
                onMoveStage={handleMoveStage}
                onUpdateCategory={handleUpdateCategory}
                onOpenStagesModal={() => setShowStagesModal(true)}
              />
            )}

            {/* Tab: All Leads Master */}
            {currentTab === 'leads' && (
              <LeadsPage
                tenantId={activeTenantId}
                currentUser={currentUser}
                onLeadClick={(lead) => setSelectedLeadForDetail(lead)}
                onConvertToBill={(lead) => setSelectedLeadForBill(lead)}
                onUpdateCategory={handleUpdateCategory}
                onMoveStage={handleMoveStage}
              />
            )}

            {/* Tab: Invoices & Bills */}
            {currentTab === 'invoices' && <InvoicesPage tenantId={activeTenantId} />}

            {/* Tab: Products Master */}
            {currentTab === 'products' && <ProductsPage />}

            {/* Tab: Support & Helpdesk Hub */}
            {currentTab === 'support' && (
              <SupportHelpdeskPage
                currentUser={currentUser}
                tenantInfo={tenantInfo}
              />
            )}

            {/* Tab: Settings */}
            {currentTab === 'settings' && <SettingsPage currentUser={currentUser} tenantId={activeTenantId} />}
          </div>
        </main>
      </div>

      {/* Convert to Bill Modal */}
      {selectedLeadForBill && (
        <ConvertToBillModal
          lead={selectedLeadForBill}
          onClose={() => setSelectedLeadForBill(null)}
          onSuccess={() => {
            loadKanban(activeTenantId);
            loadFollowUpSummary(activeTenantId);
          }}
        />
      )}

      {/* Lead Detail & Timeline Modal */}
      {selectedLeadForDetail && (
        <LeadDetailModal
          lead={selectedLeadForDetail}
          currentUser={currentUser}
          tenantId={activeTenantId}
          onClose={() => setSelectedLeadForDetail(null)}
          onConvertToBill={(lead) => {
            setSelectedLeadForDetail(null);
            setSelectedLeadForBill(lead);
          }}
          onLeadUpdated={() => {
            loadKanban(activeTenantId);
            loadFollowUpSummary(activeTenantId);
          }}
        />
      )}

      {/* Customizable Pipeline Stages Modal */}
      {showStagesModal && (
        <PipelineStagesModal
          tenantId={activeTenantId}
          initialStages={stages}
          onClose={() => setShowStagesModal(false)}
          onSaved={() => {
            loadStages(activeTenantId);
            loadKanban(activeTenantId);
          }}
        />
      )}

      {/* 4. First-Time Sign In Forced Password Reset Modal */}
      {currentUser && currentUser.is_first_login && (
        <FirstLoginPasswordModal
          currentUser={currentUser}
          onPasswordChanged={(updated) => {
            setCurrentUser(updated);
          }}
          onOpenProfile={() => setShowProfileModal(true)}
        />
      )}

      {/* 5. Comprehensive User Profile & Password Change Modal */}
      {showProfileModal && currentUser && (
        <UserProfileModal
          currentUser={currentUser}
          onClose={() => setShowProfileModal(false)}
          onUserUpdated={(updated) => {
            setCurrentUser(updated);
          }}
        />
      )}

      {/* Lead Ingestion Simulator Modal */}
      {showSimulateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-base text-slate-900">Lead Ingestion Simulator</h3>
              </div>
              <button onClick={() => setShowSimulateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Select an inbound marketplace source to fire an ingestion webhook into FastAPI. Tests normalization, deduplication, and auto-assignment.
            </p>

            {simulateSuccess ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                <p className="text-xs font-bold text-emerald-800">{simulateSuccess}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  onClick={() => handleSimulateWebhook('indiamart')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-red-200 bg-red-50/50 hover:bg-red-50 text-left transition-colors"
                >
                  <div>
                    <h5 className="font-bold text-xs text-red-900">Simulate IndiaMART Lead</h5>
                    <p className="text-[11px] text-red-700">Payload: SENDER_MOBILE, PRODUCT_NAME, QUERY_ID</p>
                  </div>
                  <span className="text-xs font-bold text-red-700">Trigger</span>
                </button>

                <button
                  onClick={() => handleSimulateWebhook('facebook')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-blue-200 bg-blue-50/50 hover:bg-blue-50 text-left transition-colors"
                >
                  <div>
                    <h5 className="font-bold text-xs text-blue-900">Simulate Meta / FB Lead Ad</h5>
                    <p className="text-[11px] text-blue-700">Payload: LeadGen Ad Form with Custom Budget</p>
                  </div>
                  <span className="text-xs font-bold text-blue-700">Trigger</span>
                </button>

                <button
                  onClick={() => handleSimulateWebhook('website')}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-left transition-colors"
                >
                  <div>
                    <h5 className="font-bold text-xs text-emerald-900">Simulate Website Form Lead</h5>
                    <p className="text-[11px] text-emerald-700">Payload: Contact Us inquiry form</p>
                  </div>
                  <span className="text-xs font-bold text-emerald-700">Trigger</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
