import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './components/LoginPage';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { KanbanBoard } from './components/KanbanBoard';
import { ConvertToBillModal } from './components/ConvertToBillModal';
import { LeadDetailModal } from './components/LeadDetailModal';
import { PipelineStagesModal } from './components/PipelineStagesModal';
import { Dashboard } from './pages/Dashboard';
import { LeadsPage } from './pages/LeadsPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ProductsPage } from './pages/ProductsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { SuperAdminPortal } from './pages/superadmin/SuperAdminPortal';
import { GlobalMastersPortal } from './pages/superadmin/GlobalMastersPortal';
import { CompanyMastersPage } from './pages/masters/CompanyMastersPage';
import { TeamManager } from './pages/team/TeamManager';
import { FirstLoginPasswordModal } from './components/FirstLoginPasswordModal';
import { UserProfileModal } from './components/UserProfileModal';
import { TwoFactorSetup } from './components/TwoFactorSetup';
import { Lead, PipelineStage, SessionState, api, apiMessage, can, getSession, isApiError, onSessionChange } from './services/api';
import { Zap, X, CheckCircle2, Sliders, ShieldCheck, Building2, Bell, ChevronRight, AlertCircle, LogOut, Loader2, Menu } from 'lucide-react';

/** Reads the one-time token from a "#/reset-password?token=…" link (the part after # never reaches a server). */
const readResetToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  if (!hash.startsWith('#/reset-password')) return null;
  const token = new URLSearchParams(hash.split('?')[1] || '').get('token');
  return token && token.length >= 20 && token.length <= 200 ? token : null;
};

/** Screens each kind of user may open. The server enforces the same rules on every request. */
const tabsFor = (session: SessionState | null): string[] => {
  const user = session?.user;
  if (!user) return [];
  if (user.role === 'super_admin') return ['superadmin', 'global_masters', 'audit'];
  const tabs = ['dashboard', 'kanban', 'leads', 'products'];
  if (can(user, 'billing_view')) tabs.push('invoices');
  if (can(user, 'team_manage')) tabs.push('team');
  if (can(user, 'settings_manage')) tabs.push('company_masters', 'settings');
  if (can(user, 'audit_view')) tabs.push('audit');
  return tabs;
};

export function App() {
  // The session lives in memory only. After a reload it is resumed from the HttpOnly refresh cookie.
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<SessionState | null>(getSession);
  const [sessionNotice, setSessionNotice] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(readResetToken);
  const hadSession = useRef(Boolean(getSession()));
  const expectingSignOut = useRef(false);
  const loginPassword = useRef('');

  const currentUser = session?.user ?? null;
  const tenantInfo = session?.tenant ?? null;
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const mustChangePassword = Boolean(session?.mustChangePassword);
  const [mfaFlowOpen, setMfaFlowOpen] = useState(false);
  // while a security step is outstanding the server refuses every other call, so nothing is loaded
  const gated = mustChangePassword || Boolean(session?.mfaEnrollmentRequired) || mfaFlowOpen;
  const allowedTabs = useMemo(() => tabsFor(session), [session]);
  const canSimulate = Boolean(session?.features?.lead_simulator) && can(currentUser, 'settings_manage') && !isSuperAdmin;
  const canManageStages = can(currentUser, 'settings_manage') && !isSuperAdmin;

  const [currentTab, setCurrentTab] = useState<string>('kanban');
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [kanbanData, setKanbanData] = useState<Record<string, Lead[]>>({});
  const [selectedLeadForDetail, setSelectedLeadForDetail] = useState<Lead | null>(null);
  const [selectedLeadForBill, setSelectedLeadForBill] = useState<Lead | null>(null);
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [showStagesModal, setShowStagesModal] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false); // phones / tablets: the menu is a drawer
  const signedInUserId = session?.user?.id;
  useEffect(() => {
    setMobileNavOpen(false); // a new sign-in always starts with the menu closed
  }, [signedInUserId]);
  const [simulateSuccess, setSimulateSuccess] = useState<string>('');
  const [simulateError, setSimulateError] = useState<string>('');
  const [simulating, setSimulating] = useState(false);
  const [toast, setToast] = useState<string>('');

  // kept for the screens that still take a tenant id prop; the server ignores it and uses the session
  const activeTenantId = tenantInfo?.id || currentUser?.tenant_id || '';

  const [followUpSummary, setFollowUpSummary] = useState<{
    today_count: number;
    overdue_count: number;
    upcoming_count: number;
    total_active: number;
  }>({ today_count: 0, overdue_count: 0, upcoming_count: 0, total_active: 0 });

  // ---- session bootstrap -------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    const unsubscribe = onSessionChange((next) => {
      if (!alive) return;
      if (!next && hadSession.current && !expectingSignOut.current) {
        setSessionNotice('Your session has ended. Please sign in again.');
      }
      if (next) setSessionNotice('');
      hadSession.current = Boolean(next);
      expectingSignOut.current = false;
      setSession(next);
    });
    api.restoreSession().finally(() => {
      if (alive) setBooting(false);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // take the reset token out of the address bar and the browser history as soon as it has been read
  useEffect(() => {
    if (window.location.hash.startsWith('#/reset-password')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  // a different person signed in (or nobody is): never show the previous person's data
  useEffect(() => {
    setKanbanData({});
    setStages([]);
    setSelectedLeadForDetail(null);
    setSelectedLeadForBill(null);
    setShowProfileModal(false);
    setShowSimulateModal(false);
    setShowStagesModal(false);
    setFollowUpSummary({ today_count: 0, overdue_count: 0, upcoming_count: 0, total_active: 0 });
    setCurrentTab(currentUser?.role === 'super_admin' ? 'superadmin' : 'kanban');
    if (!currentUser) {
      loginPassword.current = '';
      setMfaFlowOpen(false);
    }
  }, [currentUser?.id]);

  // roles that must use two-factor sign-in are walked through enrolment before anything else
  useEffect(() => {
    if (session?.mfaEnrollmentRequired && !session.mustChangePassword) setMfaFlowOpen(true);
  }, [session?.mfaEnrollmentRequired, session?.mustChangePassword]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ---- data --------------------------------------------------------------------------------------
  const loadStages = useCallback(async () => {
    const res = await api.getPipelineStages();
    if (isApiError(res)) return;
    const stageList = Array.isArray(res) ? res : res?.stages || [];
    if (Array.isArray(stageList) && stageList.length > 0) setStages(stageList);
  }, []);

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

  // Which leads come back is decided by the server: sales staff only ever receive their own.
  const loadKanban = useCallback(async () => {
    setKanbanData(await api.getKanbanBoard());
  }, []);

  const workspaceReady = Boolean(currentUser) && !isSuperAdmin && !gated;

  useEffect(() => {
    if (!workspaceReady) return;
    loadStages();
    loadKanban();
    loadFollowUpSummary();
  }, [workspaceReady, currentUser?.id, loadStages, loadKanban, loadFollowUpSummary]);

  useEffect(() => {
    if (workspaceReady && (currentTab === 'kanban' || currentTab === 'dashboard')) {
      loadKanban();
      loadFollowUpSummary();
    }
  }, [currentTab]);

  // Navigation guard (a convenience only: the API refuses anything the person may not do)
  useEffect(() => {
    if (currentUser && allowedTabs.length > 0 && !allowedTabs.includes(currentTab)) {
      setCurrentTab(allowedTabs.includes('kanban') ? 'kanban' : allowedTabs[0]);
    }
  }, [currentUser, currentTab, allowedTabs]);

  const handleLogout = async () => {
    expectingSignOut.current = true;
    loginPassword.current = '';
    await api.logout();
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

    // 2. The server decides; on refusal the board is reloaded so it shows the truth again
    const res = await api.updateLeadStage(leadId, nextStage);
    if (isApiError(res)) setToast(apiMessage(res, 'The stage could not be changed.'));
    loadKanban();
    loadFollowUpSummary();
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

    const res = await api.updateLeadCategory(leadId, category);
    if (isApiError(res)) setToast(apiMessage(res, 'The category could not be changed.'));
    loadKanban();
  };

  // Test-lead simulator: goes through the authenticated API. The public webhook URLs need a secret
  // token that the browser never holds, so they cannot be called from here any more.
  const handleSimulateWebhook = async (source: string) => {
    setSimulateSuccess('');
    setSimulateError('');
    setSimulating(true);
    const res = await api.simulateLead(source);
    setSimulating(false);
    if (isApiError(res)) {
      setSimulateError(apiMessage(res, 'The test lead could not be created.'));
      return;
    }
    setSimulateSuccess(res.message || 'Test lead ingested successfully');
    loadKanban();
    window.setTimeout(() => {
      setSimulateSuccess('');
      setShowSimulateModal(false);
    }, 2000);
  };

  // 0. While the saved session is being resumed
  if (booting) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-xs gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Checking your session…</span>
      </div>
    );
  }

  // 1. Password-reset link from an e-mail
  if (resetToken && !currentUser) {
    return <ResetPasswordPage token={resetToken} onDone={() => setResetToken(null)} />;
  }

  // 2. Without a session, render the login page only
  if (!currentUser) {
    return (
      <LoginPage
        notice={sessionNotice}
        onLoginSuccess={(passwordUsed) => {
          loginPassword.current = passwordUsed;
        }}
      />
    );
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
        return { title: 'Company & Marketplace API Settings', subtitle: 'IndiaMART, Facebook, TradeIndia, Justdial API credentials, GST profile & bank ledger' };
      case 'audit':
        return isSuperAdmin
          ? { title: 'Platform Security & Audit Trail', subtitle: 'Sign-ins, administrative actions and blocked attempts across every company' }
          : { title: 'Security & Audit Trail', subtitle: 'Who did what, when and from where inside your company workspace' };
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
        allowedTabs={allowedTabs}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfileModal(true)}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 3. Main Workspace Area */}
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden bg-slate-950">
        {/* Top Header Bar */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 px-3 sm:px-6 flex items-center justify-between shrink-0 backdrop-blur-md z-30">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="lg:hidden mr-2 p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition-colors shrink-0"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 mr-2 sm:mr-4 flex-1">
            <h1 className="text-sm sm:text-base font-extrabold text-white tracking-tight truncate">{headerInfo.title}</h1>
            <p className="text-[11px] text-slate-400 hidden sm:block truncate">{headerInfo.subtitle}</p>
          </div>

          {/* Quick Action Badges */}
          <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0 whitespace-nowrap">
            {/* Pipeline Stage Customizer Button (when on Kanban) */}
            {currentTab === 'kanban' && canManageStages && !gated && (
              <button
                onClick={() => setShowStagesModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-all shadow-sm"
              >
                <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Customize Stages</span>
              </button>
            )}

            {/* Test-lead simulator: administrators only, and only where the server has it switched on */}
            {canSimulate && !gated && (
              <button
                onClick={() => { setSimulateError(''); setSimulateSuccess(''); setShowSimulateModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all shadow-sm"
              >
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Create Test Lead</span>
                <span className="sm:hidden">Test</span>
              </button>
            )}

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
            {!isSuperAdmin && !gated && (
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
        {(followUpSummary.today_count > 0 || followUpSummary.overdue_count > 0) && !isSuperAdmin && !gated && (
          <div 
            onClick={() => setCurrentTab('leads')}
            className="mx-2 sm:mx-6 lg:mx-8 mt-2 sm:mt-3.5 p-3 bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-indigo-500/15 border border-amber-500/30 rounded-2xl flex items-center justify-between cursor-pointer hover:border-amber-400/60 transition-all text-xs shadow-lg group shrink-0"
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
                  {can(currentUser, 'leads_view_all') ? 'Your sales team has' : 'You have'}{' '}
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
        <main className="flex-1 overflow-y-auto p-2 sm:p-6 lg:p-8 bg-slate-900/40">
          <div className="bg-white rounded-2xl sm:rounded-3xl p-3 sm:p-8 shadow-2xl border border-slate-200/80 min-h-full text-slate-900">
            {gated ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center text-slate-500 gap-2">
                <ShieldCheck className="h-8 w-8 text-indigo-500" />
                <p className="text-sm font-bold text-slate-800">One security step left</p>
                <p className="text-xs max-w-sm">Finish the step shown on screen to open your workspace.</p>
              </div>
            ) : (
              <>
                {/* Platform administration (super admin only) */}
                {currentTab === 'superadmin' && isSuperAdmin && <SuperAdminPortal />}
                {currentTab === 'global_masters' && isSuperAdmin && <GlobalMastersPortal />}

                {/* Security & audit trail */}
                {currentTab === 'audit' && allowedTabs.includes('audit') && <AuditLogPage platform={isSuperAdmin} />}

                {/* Company CRM masters */}
                {currentTab === 'company_masters' && allowedTabs.includes('company_masters') && <CompanyMastersPage tenantId={activeTenantId} />}

                {/* Team & permissions */}
                {currentTab === 'team' && allowedTabs.includes('team') && <TeamManager tenantId={activeTenantId} currentUser={currentUser} />}

                {/* Sales dashboard */}
                {currentTab === 'dashboard' && !isSuperAdmin && (
                  <Dashboard
                    tenantId={activeTenantId}
                    currentUser={currentUser}
                    onNavigateToKanban={() => setCurrentTab('kanban')}
                    onNavigateToInvoices={() => setCurrentTab('invoices')}
                    onLeadClick={(lead) => setSelectedLeadForDetail(lead)}
                    onConvertToBill={(lead) => setSelectedLeadForBill(lead)}
                  />
                )}

                {/* Kanban pipeline with the company's own stages */}
                {currentTab === 'kanban' && !isSuperAdmin && (
                  <KanbanBoard
                    kanbanData={kanbanData}
                    stages={stages}
                    onLeadClick={(lead) => setSelectedLeadForDetail(lead)}
                    onConvertToBill={(lead) => setSelectedLeadForBill(lead)}
                    onMoveStage={handleMoveStage}
                    onUpdateCategory={handleUpdateCategory}
                    onOpenStagesModal={canManageStages ? () => setShowStagesModal(true) : undefined}
                    canEdit={can(currentUser, 'leads_create_edit')}
                    canBill={can(currentUser, 'billing_convert')}
                  />
                )}

                {/* All leads */}
                {currentTab === 'leads' && !isSuperAdmin && (
                  <LeadsPage
                    tenantId={activeTenantId}
                    currentUser={currentUser}
                    stages={stages}
                    onLeadClick={(lead) => setSelectedLeadForDetail(lead)}
                    onConvertToBill={(lead) => setSelectedLeadForBill(lead)}
                    onUpdateCategory={handleUpdateCategory}
                    onMoveStage={handleMoveStage}
                  />
                )}

                {/* Invoices & bills */}
                {currentTab === 'invoices' && allowedTabs.includes('invoices') && <InvoicesPage tenantId={activeTenantId} currentUser={currentUser} />}

                {/* Products */}
                {currentTab === 'products' && !isSuperAdmin && <ProductsPage currentUser={currentUser} />}

                {/* Company settings */}
                {currentTab === 'settings' && allowedTabs.includes('settings') && <SettingsPage currentUser={currentUser} tenantId={activeTenantId} />}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Convert to Bill Modal */}
      {selectedLeadForBill && !gated && (
        <ConvertToBillModal
          lead={selectedLeadForBill}
          currentUser={currentUser}
          onClose={() => setSelectedLeadForBill(null)}
          onSuccess={() => {
            loadKanban();
            loadFollowUpSummary();
          }}
        />
      )}

      {/* Lead Detail & Timeline Modal */}
      {selectedLeadForDetail && !gated && (
        <LeadDetailModal
          lead={selectedLeadForDetail}
          currentUser={currentUser}
          tenantId={activeTenantId}
          stages={stages}
          onClose={() => setSelectedLeadForDetail(null)}
          onConvertToBill={(lead) => {
            setSelectedLeadForDetail(null);
            setSelectedLeadForBill(lead);
          }}
          onLeadUpdated={() => {
            loadKanban();
            loadFollowUpSummary();
          }}
        />
      )}

      {/* Customizable Pipeline Stages Modal */}
      {showStagesModal && canManageStages && !gated && (
        <PipelineStagesModal
          tenantId={activeTenantId}
          initialStages={stages}
          onClose={() => setShowStagesModal(false)}
          onSaved={() => {
            loadStages();
            loadKanban();
          }}
        />
      )}

      {/* 4. A temporary password must be replaced before anything else */}
      {mustChangePassword && (
        <FirstLoginPasswordModal
          currentUser={currentUser}
          knownCurrentPassword={loginPassword.current}
          onPasswordChanged={() => {
            loginPassword.current = '';
          }}
          onLogout={handleLogout}
        />
      )}

      {/* 5. Roles that must use two-factor sign-in enrol before they can work */}
      {mfaFlowOpen && !mustChangePassword && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto" style={{ colorScheme: 'light' }}>
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden text-slate-900 my-auto">
            <div className="p-6 bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-600 text-white text-center">
              <div className="h-14 w-14 rounded-2xl bg-white/20 mx-auto flex items-center justify-center mb-3 border border-white/20">
                <ShieldCheck className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-xl font-black tracking-tight text-white">Turn On Two-Factor Sign-In</h3>
              <p className="text-xs text-indigo-100 mt-1 max-w-sm mx-auto">
                Your role can reach sensitive data, so a password alone is not enough. This takes about a minute.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <TwoFactorSetup onCompleted={() => setMfaFlowOpen(false)} />
              <div className="text-center pt-2 border-t border-slate-100">
                <button type="button" onClick={handleLogout} className="text-xs font-bold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1.5">
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. My profile, password, two-factor sign-in and signed-in devices */}
      {showProfileModal && !gated && (
        <UserProfileModal currentUser={currentUser} onClose={() => setShowProfileModal(false)} onLogout={handleLogout} />
      )}

      {/* Something the server refused (for example a permission) */}
      {toast && (
        <div role="alert" className="fixed bottom-5 right-5 z-[80] max-w-sm p-3.5 rounded-2xl bg-rose-600 text-white text-xs font-bold shadow-2xl flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast('')} aria-label="Dismiss" className="text-white/80 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Test-lead simulator */}
      {showSimulateModal && canSimulate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-base text-slate-900">Create a Test Lead</h3>
              </div>
              <button onClick={() => setShowSimulateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Sends a sample inquiry through the same pipeline real marketplace leads use (clean-up, duplicate check, open pool). Test
              leads are marked as such and recorded in the audit trail.
            </p>

            {simulateError && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{simulateError}</span>
              </div>
            )}

            {simulateSuccess ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                <p className="text-xs font-bold text-emerald-800">{simulateSuccess}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  onClick={() => handleSimulateWebhook('indiamart')}
                  disabled={simulating}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-red-200 bg-red-50/50 hover:bg-red-50 text-left transition-colors"
                >
                  <div>
                    <h5 className="font-bold text-xs text-red-900">Sample IndiaMART inquiry</h5>
                    <p className="text-[11px] text-red-700">Buyer, product and a unique query id</p>
                  </div>
                  <span className="text-xs font-bold text-red-700">Trigger</span>
                </button>

                <button
                  onClick={() => handleSimulateWebhook('facebook')}
                  disabled={simulating}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-blue-200 bg-blue-50/50 hover:bg-blue-50 text-left transition-colors"
                >
                  <div>
                    <h5 className="font-bold text-xs text-blue-900">Sample Meta / Facebook lead ad</h5>
                    <p className="text-[11px] text-blue-700">Lead-form fields as Meta delivers them</p>
                  </div>
                  <span className="text-xs font-bold text-blue-700">Trigger</span>
                </button>

                <button
                  onClick={() => handleSimulateWebhook('website')}
                  disabled={simulating}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-left transition-colors"
                >
                  <div>
                    <h5 className="font-bold text-xs text-emerald-900">Sample website form inquiry</h5>
                    <p className="text-[11px] text-emerald-700">Contact-us form submission</p>
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
