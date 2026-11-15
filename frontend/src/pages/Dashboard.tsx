import React, { useEffect, useState } from 'react';
import { api, Lead } from '../services/api';
import { 
  Users, 
  Receipt, 
  TrendingUp, 
  Wallet, 
  ArrowUpRight, 
  Clock, 
  Sparkles,
  Phone,
  Building2,
  Calendar,
  ChevronRight,
  Zap
} from 'lucide-react';

interface DashboardProps {
  tenantId?: string;
  onNavigateToKanban: () => void;
  onNavigateToInvoices: () => void;
  onLeadClick?: (lead: Lead) => void;
  onConvertToBill?: (lead: Lead) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  tenantId,
  onNavigateToKanban,
  onNavigateToInvoices,
  onLeadClick,
  onConvertToBill,
}) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadMetrics = () => {
    setLoading(true);
    api.getDashboardMetrics(tenantId)
      .then((res) => {
        setMetrics(res);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load dashboard metrics:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadMetrics();
  }, [tenantId]);

  if (loading) {
    return (
      <div className="py-24 text-center text-slate-400 text-xs space-y-2">
        <div className="animate-spin h-6 w-6 border-2 border-indigo-600 border-t-transparent rounded-full mx-auto" />
        <p>Loading real-time company analytics & leads...</p>
      </div>
    );
  }

  const lm = metrics?.leads_metrics || {
    total_leads: 0,
    converted_leads: 0,
    conversion_rate_percentage: 0,
    source_breakdown: {},
    stage_breakdown: {},
  };

  const fm = metrics?.financial_metrics || {
    total_invoices_count: 0,
    total_billed_amount: 0,
    total_collected_amount: 0,
    total_pending_amount: 0,
  };

  const recentLeads: Lead[] = metrics?.recent_leads || [];

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
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">{source || 'Direct'}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/30 text-blue-100 border border-blue-400/30 inline-flex items-center gap-1 mb-2">
            <Sparkles className="h-3 w-3" />
            <span>Lead-to-Cash Command Center</span>
          </span>
          <h2 className="text-2xl font-bold tracking-tight">Sales & Revenue Dashboard</h2>
          <p className="text-blue-100 text-xs sm:text-sm mt-1 max-w-xl">
            Real-time pipeline performance. Review inbound inquiries, track conversion velocity, and generate compliant GST Tax Invoices.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onNavigateToKanban}
            className="px-4 py-2.5 rounded-xl bg-white text-blue-700 font-bold text-xs hover:bg-blue-50 transition-colors shadow-sm"
          >
            Open Pipeline
          </button>
          <button
            onClick={onNavigateToInvoices}
            className="px-4 py-2.5 rounded-xl bg-blue-600/60 hover:bg-blue-600 text-white font-bold text-xs border border-white/20 transition-colors"
          >
            View Invoices
          </button>
        </div>
      </div>

      {/* 4 Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Leads */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Leads</span>
            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900">{lm.total_leads}</span>
            <span className="text-xs text-emerald-600 font-bold">
              Active Opportunities
            </span>
          </div>
        </div>

        {/* Won & Billed Leads */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Converted / Billed</span>
            <div className="h-8 w-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900">{lm.converted_leads}</span>
            <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
              {lm.conversion_rate_percentage}% Win Rate
            </span>
          </div>
        </div>

        {/* Total Invoiced Amount */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Billed (GST)</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900">
              ₹{Number(fm.total_billed_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-slate-400 font-medium">{fm.total_invoices_count} Bills</span>
          </div>
        </div>

        {/* Pending Receivables */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Balance Due</span>
            <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-amber-600">
              ₹{Number(fm.total_pending_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-emerald-600 font-semibold">
              ₹{Number(fm.total_collected_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Paid
            </span>
          </div>
        </div>
      </div>

      {/* Sources and Pipeline Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Sources Distribution */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-slate-900">Inbound Leads by Channel</h3>
          <div className="space-y-3">
            {[
              { key: 'indiamart', label: 'IndiaMART Marketplace', color: 'bg-red-500' },
              { key: 'tradeindia', label: 'TradeIndia B2B', color: 'bg-amber-500' },
              { key: 'facebook', label: 'Meta / Facebook Ads', color: 'bg-blue-600' },
              { key: 'justdial', label: 'Justdial Lead Push', color: 'bg-orange-500' },
              { key: 'website', label: 'Website & Contact Webhooks', color: 'bg-emerald-500' },
              { key: 'manual', label: 'Direct / Referral Inquiries', color: 'bg-slate-500' },
            ].map((src) => {
              const count = lm.source_breakdown[src.key] || 0;
              const pct = lm.total_leads > 0 ? (count / lm.total_leads) * 100 : 0;
              return (
                <div key={src.key} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                    <span>{src.label}</span>
                    <span>{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${src.color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pipeline Distribution */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-slate-900">Pipeline Stages Summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { stage: 'NEW', label: 'New Inquiry' },
              { stage: 'CONTACTED', label: 'Contacted' },
              { stage: 'DEMO_SCHEDULED', label: 'Demo / Spec' },
              { stage: 'PROPOSAL_SENT', label: 'Quote Sent' },
              { stage: 'NEGOTIATION', label: 'Negotiation' },
              { stage: 'WON', label: 'Won / Invoiced' },
            ].map((st) => (
              <div key={st.stage} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                <span className="text-xl font-extrabold text-slate-800 block">
                  {lm.stage_breakdown[st.stage] || 0}
                </span>
                <span className="text-[11px] font-semibold text-slate-500">{st.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RECENT INCOMING LEADS TABLE ON DASHBOARD */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900">Recent Inquiries & Leads</h3>
            <p className="text-xs text-slate-500">Live incoming prospects from marketplace channels.</p>
          </div>
          <button
            onClick={onNavigateToKanban}
            className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
          >
            <span>View Kanban Board</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {recentLeads.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs space-y-2">
            <Users className="h-8 w-8 mx-auto text-slate-300" />
            <p>No leads received yet. Click "Simulate Lead Webhook" above to test lead ingestion!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-4">Prospect Name</th>
                  <th className="p-4">Contact & Company</th>
                  <th className="p-4">Source Channel</th>
                  <th className="p-4">Product Inquired</th>
                  <th className="p-4">Deal Value</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentLeads.map((lead, idx) => {
                  const normalizedLead = { ...lead, id: lead.id || lead._id };
                  return (
                    <tr 
                      key={lead.id || lead._id || idx}
                      onClick={() => onLeadClick && onLeadClick(normalizedLead)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <td className="p-4">
                        <div className="font-bold text-sm text-slate-900">{lead.full_name}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(lead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center gap-1 text-slate-700 font-medium">
                        <Phone className="h-3 w-3 text-slate-400" />
                        <span>{lead.phone}</span>
                      </div>
                      {lead.company_name && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          <span>{lead.company_name}</span>
                        </div>
                      )}
                    </td>

                    <td className="p-4">
                      {getSourceBadge(lead.source)}
                    </td>

                    <td className="p-4">
                      <span className="font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                        {lead.product_inquired || 'General Inquiry'}
                      </span>
                    </td>

                    <td className="p-4">
                      <span className="font-extrabold text-emerald-600">
                        ₹{Number(lead.deal_value || 0).toLocaleString('en-IN')}
                      </span>
                    </td>

                    <td className="p-4 text-center">
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {lead.stage}
                      </span>
                    </td>

                    <td className="p-4 text-right">
                      {lead.conversion_info?.is_converted ? (
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                          Invoiced
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onConvertToBill) onConvertToBill(normalizedLead);
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                        >
                          Convert to Bill
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
    </div>
  );
};
