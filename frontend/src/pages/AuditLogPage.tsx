import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { formatIndianDateTime } from '../utils/dateUtils';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';

interface AuditLogPageProps {
  /** true: platform-wide trail for the super admin. false: the signed-in user's own company. */
  platform: boolean;
}

interface AuditEntry {
  _id?: string;
  id?: string;
  tenant_id?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  action: string;
  status: string;
  entity_type?: string | null;
  entity_id?: string | null;
  ip?: string | null;
  request_id?: string | null;
  details?: Record<string, unknown>;
  created_at: string;
}

const PAGE_SIZE = 50;

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'auth.', label: 'Sign-in & passwords' },
  { value: 'security.', label: 'Blocked attempts' },
  { value: 'team.', label: 'Team & permissions' },
  { value: 'lead.', label: 'Leads' },
  { value: 'invoice.', label: 'Billing' },
  { value: 'tenant.', label: 'Company settings & integrations' },
  { value: 'product.', label: 'Products' },
  { value: 'platform.', label: 'Platform administration' },
];

const describeDetails = (details?: Record<string, unknown>): string => {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
    .slice(0, 300);
};

/** Read-only view of the append-only audit trail. Entries cannot be edited or deleted from the application. */
export const AuditLogPage: React.FC<AuditLogPageProps> = ({ platform }) => {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = { action: category || undefined, status: status || undefined, skip: page * PAGE_SIZE, limit: PAGE_SIZE };
    const res = platform ? await api.getPlatformAuditLogs(params) : await api.getAuditLogs(params);
    setItems(Array.isArray(res.items) ? res.items : []);
    setTotal(res.total || 0);
    setLoading(false);
  }, [platform, category, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">Security & Audit Trail</h2>
            <p className="text-xs text-slate-500">
              {platform ? 'Every company on the platform' : 'Your company only'} · {total.toLocaleString('en-IN')} entries · records are
              kept read-only
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={category}
            onChange={(e) => { setPage(0); setCategory(e.target.value); }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-700"
            aria-label="Filter by kind of activity"
          >
            {CATEGORIES.filter((c) => platform || c.value !== 'platform.').map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => { setPage(0); setStatus(e.target.value); }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-700"
            aria-label="Filter by result"
          >
            <option value="">Any result</option>
            <option value="success">Succeeded</option>
            <option value="failure">Failed / blocked</option>
          </select>
          <button
            onClick={load}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-2xl">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-3 py-2.5 text-left font-bold">When</th>
              <th className="px-3 py-2.5 text-left font-bold">Who</th>
              <th className="px-3 py-2.5 text-left font-bold">Action</th>
              <th className="px-3 py-2.5 text-left font-bold">Result</th>
              <th className="px-3 py-2.5 text-left font-bold">From (IP)</th>
              <th className="px-3 py-2.5 text-left font-bold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((entry, index) => (
              <tr key={entry._id || entry.id || index} className={entry.status === 'failure' ? 'bg-rose-50/50' : ''}>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{formatIndianDateTime(entry.created_at)}</td>
                <td className="px-3 py-2.5">
                  <span className="font-bold text-slate-900 block">{entry.actor_email || 'Not signed in / system'}</span>
                  <span className="text-[10px] text-slate-400">
                    {(entry.actor_role || '').replace('_', ' ')}
                    {platform && entry.tenant_id ? ` · company ${entry.tenant_id}` : ''}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-slate-800">{entry.action}</td>
                <td className="px-3 py-2.5">
                  {entry.status === 'failure' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold text-[10px]">
                      <AlertTriangle className="h-3 w-3" /> Failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]">
                      <CheckCircle2 className="h-3 w-3" /> OK
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">{entry.ip || '—'}</td>
                <td className="px-3 py-2.5 text-slate-500 max-w-md break-words">
                  {describeDetails(entry.details)}
                  {entry.entity_type ? <span className="text-slate-400"> [{entry.entity_type}]</span> : null}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">No audit entries match these filters.</td>
              </tr>
            )}
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Page {page + 1} of {pages}</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 disabled:opacity-40 flex items-center gap-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Newer
          </button>
          <button
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 disabled:opacity-40 flex items-center gap-1"
          >
            Older <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
