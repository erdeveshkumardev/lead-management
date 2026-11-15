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
  Crown,
  UserCheck,
  UserPlus,
  LogOut,
  ChevronDown,
  Sparkles,
  Globe,
  Sliders
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  currentUser: CurrentUser;
  tenantInfo: TenantInfo | null;
  onLogout: () => void;
  onSwitchUser?: (role: 'super_admin' | 'company_admin' | 'staff') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  setCurrentTab,
  currentUser,
  tenantInfo,
  onLogout,
}) => {
  const isSuperAdmin = currentUser.role === 'super_admin';
  const isCompanyAdmin = currentUser.role === 'company_admin';
  const isStaff = currentUser.role === 'staff';

  // Navigation tabs strictly dynamic by role:
  // - Super Admin: Tenants & Licensing, Platform Analytics, System Specs
  // - Company Admin: Dashboard, Kanban, Leads, Invoices, Team & Permissions, Products, Company & API Settings
  // - Sales Staff: Dashboard, Kanban, Leads, Invoices, Products (NO Team & Permissions, NO Company & API Settings)
  const navItems = isSuperAdmin
    ? [
        { id: 'superadmin', label: 'Tenants & Licensing', icon: Building2 },
        { id: 'global_masters', label: 'Global Masters', icon: Globe },
        { id: 'dashboard', label: 'Platform Analytics', icon: LayoutDashboard },
        { id: 'settings', label: 'System Configuration', icon: Settings },
      ]
    : [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'kanban', label: 'Kanban Pipeline', icon: KanbanSquare },
        { id: 'leads', label: 'All Leads', icon: Users },
        { id: 'invoices', label: 'Invoices & Bills', icon: Receipt },
        ...(isCompanyAdmin ? [{ id: 'company_masters', label: 'CRM Masters', icon: Sliders }] : []),
        ...(isCompanyAdmin ? [{ id: 'team', label: 'Team & Permissions', icon: UserPlus }] : []),
        { id: 'products', label: 'Products Master', icon: Package },
        ...(isCompanyAdmin ? [{ id: 'settings', label: 'Company & API Settings', icon: Settings }] : []),
      ];

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
    <aside className="w-64 lg:w-72 bg-slate-900 border-r border-slate-800 text-slate-100 flex flex-col justify-between shrink-0 h-screen sticky top-0 shadow-2xl z-40 select-none">
      {/* Top: Logo & Company Workspace */}
      <div className="p-5 border-b border-slate-800/80">
        <div 
          onClick={() => setCurrentTab(isSuperAdmin ? 'superadmin' : 'dashboard')}
          className="flex items-center space-x-3 cursor-pointer group"
        >
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 group-hover:scale-105 transition-transform">
            <Zap className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-base font-extrabold tracking-tight text-white">Lead-to-Cash</span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium truncate">
              {isSuperAdmin ? 'Platform Authority' : (tenantInfo?.company_name || 'Apex Machineries')}
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
              onClick={() => setCurrentTab(item.id)}
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
        <div className="flex items-center space-x-2.5 p-2 rounded-2xl bg-slate-800/60 border border-slate-700/60">
          <div className="h-8 w-8 rounded-xl bg-indigo-500/20 text-indigo-300 font-bold flex items-center justify-center text-xs border border-indigo-400/30">
            {currentUser.full_name?.charAt(0) || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-white truncate">{currentUser.full_name}</span>
            <span className="block text-[10px] text-slate-400 truncate">{currentUser.email}</span>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center space-x-2 py-2 rounded-xl text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
