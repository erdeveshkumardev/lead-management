import React from 'react';
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
  Crown,
  UserCheck,
  UserPlus,
  LogOut,
  Globe,
  Sliders,
  ShieldCheck,
  X
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  currentUser: CurrentUser;
  tenantInfo: TenantInfo | null;
  /** Screens this person may open (worked out from their role and permissions). */
  allowedTabs: string[];
  onLogout: () => void;
  onOpenProfile?: () => void;
  /** Phones and tablets: the menu is a drawer that slides in over the page. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const NAV_ITEMS = [
  { id: 'superadmin', label: 'Tenants & Licensing', icon: Building2 },
  { id: 'global_masters', label: 'Global Masters', icon: Globe },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'kanban', label: 'Kanban Pipeline', icon: KanbanSquare },
  { id: 'leads', label: 'All Leads', icon: Users },
  { id: 'invoices', label: 'Invoices & Bills', icon: Receipt },
  { id: 'company_masters', label: 'CRM Masters', icon: Sliders },
  { id: 'team', label: 'Team & Permissions', icon: UserPlus },
  { id: 'products', label: 'Products Master', icon: Package },
  { id: 'settings', label: 'Company & API Settings', icon: Settings },
  { id: 'audit', label: 'Security & Audit Log', icon: ShieldCheck },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  setCurrentTab,
  currentUser,
  tenantInfo,
  allowedTabs,
  onLogout,
  onOpenProfile,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const isSuperAdmin = currentUser.role === 'super_admin';
  const goTo = (tab: string) => {
    setCurrentTab(tab);
    onCloseMobile?.();
  };

  // The menu only lists what this person may open. It is a convenience: the server checks every request.
  const navItems = NAV_ITEMS.filter((item) => allowedTabs.includes(item.id));

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'super_admin':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30">
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
      case 'manager':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30">
            <UserCheck className="h-3 w-3 text-amber-400" />
            <span>MANAGER</span>
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
    <aside
      className={`w-72 max-w-[85vw] bg-slate-900 border-r border-slate-800 text-slate-100 flex flex-col justify-between shrink-0 h-screen shadow-2xl select-none
        fixed inset-y-0 left-0 z-50 transform transition-[transform,visibility] duration-200 ease-out
        lg:sticky lg:top-0 lg:z-40 lg:translate-x-0 lg:visible ${mobileOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'}`}
    >
      {/* Top: Logo & Company Workspace */}
      <div className="p-5 border-b border-slate-800/80 relative">
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close menu"
          className="lg:hidden absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <div 
          onClick={() => goTo(isSuperAdmin ? 'superadmin' : 'dashboard')}
          className="flex items-center space-x-3 cursor-pointer group pr-8 lg:pr-0"
        >
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 group-hover:scale-105 transition-transform">
            <Zap className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-base font-extrabold tracking-tight text-white">Lead-to-Cash</span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium truncate">
              {isSuperAdmin ? 'Platform Administration' : (tenantInfo?.company_name || 'Company workspace')}
            </p>
          </div>
        </div>

        {/* Role Pill */}
        <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Active Role</span>
          {getRoleBadge(currentUser.role)}
        </div>
      </div>

      {/* Middle: Left Menu Navigation */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5 kanban-col">
        <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
          Workspace Navigation
        </span>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => goTo(item.id)}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left ${
                isActive
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-600/25'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span className="flex-1">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom: Authenticated User Card & Logout */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/60 space-y-2">
        <div 
          onClick={() => { onCloseMobile?.(); onOpenProfile?.(); }}
          className="flex items-center space-x-2.5 p-2 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/40 transition-all cursor-pointer group"
          title="My profile, password and two-factor sign-in"
        >
          <div className="h-8 w-8 rounded-xl bg-indigo-500/20 text-indigo-300 font-bold flex items-center justify-center text-xs border border-indigo-400/30 group-hover:scale-105 transition-transform">
            {currentUser.full_name?.charAt(0) || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-white truncate group-hover:text-indigo-300 transition-colors">
              {currentUser.full_name}
            </span>
            <span className="block text-[10px] text-slate-400 truncate">
              {currentUser.mfa_enabled ? '2FA on' : '2FA off'} • Profile &amp; security &rarr;
            </span>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={() => { onCloseMobile?.(); onLogout(); }}
          className="w-full flex items-center justify-center space-x-2 py-2 rounded-xl text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
