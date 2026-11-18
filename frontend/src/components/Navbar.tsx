import React, { useState } from 'react';
import { CurrentUser, TenantInfo } from '../services/api';
import { 
  LayoutDashboard, 
  KanbanSquare, 
  Users, 
  Receipt, 
  Package, 
  Settings, 
  Zap,
  Building2,
  ShieldCheck,
  Crown,
  ChevronDown,
  UserCheck,
  UserPlus,
  LifeBuoy
} from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  currentUser: CurrentUser;
  tenantInfo: TenantInfo | null;
  onSwitchUser: (role: 'super_admin' | 'company_admin' | 'staff') => void;
  onSimulateWebhook: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  currentUser,
  tenantInfo,
  onSwitchUser,
  onSimulateWebhook,
}) => {
  const [showUserMenu, setShowUserMenu] = useState(false);

  const isSuperAdmin = currentUser.role === 'super_admin';
  const isCompanyAdmin = currentUser.role === 'company_admin';

  // Navigation tabs dynamic by role
  const navItems = isSuperAdmin
    ? [
        { id: 'superadmin', label: 'Tenants & Licensing', icon: Building2 },
        { id: 'dashboard', label: 'Platform Analytics', icon: LayoutDashboard },
        { id: 'support', label: 'Support Hub', icon: LifeBuoy },
        { id: 'settings', label: 'System Settings', icon: Settings },
      ]
    : [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'kanban', label: 'Kanban Pipeline', icon: KanbanSquare },
        { id: 'leads', label: 'All Leads', icon: Users },
        { id: 'invoices', label: 'Invoices & Bills', icon: Receipt },
        ...(isCompanyAdmin ? [{ id: 'team', label: 'Team & Permissions', icon: UserPlus }] : []),
        { id: 'products', label: 'Products Master', icon: Package },
        { id: 'support', label: 'Help & Support', icon: LifeBuoy },
        { id: 'settings', label: 'Company Profile', icon: Settings },
      ];

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'super_admin':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-purple-300 border border-purple-400/30">
            <Crown className="h-3 w-3 text-purple-400" />
            <span>SUPER ADMIN</span>
          </span>
        );
      case 'company_admin':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
            <Building2 className="h-3 w-3 text-emerald-400" />
            <span>COMPANY ADMIN</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30">
            <UserCheck className="h-3 w-3 text-blue-400" />
            <span>SALES STAFF</span>
          </span>
        );
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 text-white shadow-xl backdrop-blur-md bg-slate-900/95">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & Active Workspace */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setCurrentTab(isSuperAdmin ? 'superadmin' : 'dashboard')}>
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-white">Lead-to-Cash</span>
                {getRoleBadge(currentUser.role)}
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                {isSuperAdmin ? 'Platform Management Console' : (tenantInfo?.company_name || 'Apex Machineries')}
              </p>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="hidden md:flex space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id)}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-500/25'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Actions: Webhook Simulator & Role Switcher */}
          <div className="flex items-center space-x-3">
            {!isSuperAdmin && (
              <button
                onClick={onSimulateWebhook}
                className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors shadow-sm"
                title="Test IndiaMART/FB/TradeIndia Lead Ingestion"
              >
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
                <span>Simulate Lead</span>
              </button>
            )}

            {/* Quick Role Switcher Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs font-semibold transition-colors"
              >
                <div className="h-6 w-6 rounded-lg bg-indigo-500/30 text-indigo-300 flex items-center justify-center font-bold text-xs">
                  {currentUser.full_name.charAt(0)}
                </div>
                <span className="hidden sm:inline font-bold text-slate-200">{currentUser.full_name.split(' ')[0]}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-2 z-50 text-xs space-y-1">
                  <div className="px-3 py-2 border-b border-slate-800 text-[11px]">
                    <span className="text-slate-400 block font-medium">Logged in as:</span>
                    <strong className="text-white block text-xs">{currentUser.full_name}</strong>
                    <span className="text-slate-400 font-mono text-[10px]">{currentUser.email}</span>
                  </div>

                  <span className="px-3 pt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    1-Click Switch Account (RBAC Demo):
                  </span>

                  <button
                    onClick={() => {
                      onSwitchUser('super_admin');
                      setShowUserMenu(false);
                      setCurrentTab('superadmin');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl transition-colors flex items-center justify-between ${
                      currentUser.role === 'super_admin' ? 'bg-indigo-900/60 text-white font-bold' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="font-bold flex items-center gap-1.5">
                        <Crown className="h-3.5 w-3.5 text-purple-400" />
                        <span>Super Administrator</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Creates companies & sets user quotas</span>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      onSwitchUser('company_admin');
                      setShowUserMenu(false);
                      setCurrentTab('dashboard');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl transition-colors flex items-center justify-between ${
                      currentUser.role === 'company_admin' ? 'bg-emerald-900/60 text-white font-bold' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="font-bold flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Company Administrator</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Manages team, leads & billing</span>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      onSwitchUser('staff');
                      setShowUserMenu(false);
                      setCurrentTab('kanban');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl transition-colors flex items-center justify-between ${
                      currentUser.role === 'staff' ? 'bg-blue-900/60 text-white font-bold' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="font-bold flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-blue-400" />
                        <span>Sales Staff / Agent</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Pipeline execution & lead conversion</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
