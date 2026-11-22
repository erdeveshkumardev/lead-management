import React, { useCallback, useEffect, useState } from 'react';
import { CurrentUser, Invoice, api, can } from '../services/api';
import { Receipt, Eye, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { InvoiceViewModal } from '../components/InvoiceViewModal';
import { RecordPaymentModal } from '../components/RecordPaymentModal';
import { PdfDownloadButton } from '../components/PdfDownloadButton';
import { canTakePayment, documentShortLabel, money, paymentStatusMeta } from '../utils/billing';
import { formatIndianDate } from '../utils/dateUtils';

interface InvoicesPageProps {
  tenantId?: string;
  currentUser?: CurrentUser | null;
}

const PAGE_SIZE = 50;

export const InvoicesPage: React.FC<InvoicesPageProps> = ({ currentUser }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<Invoice | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);

  const mayRecordPayments = can(currentUser, 'billing_payments');

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const res = await api.getInvoices(undefined, filterType, {
      payment_status: filterStatus || undefined,
      search: search || undefined,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    setInvoices(Array.isArray(res.items) ? res.items : []);
    setTotal(res.total || 0);
    setLoading(false);
  }, [filterType, filterStatus, search, page]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // search as you type, without sending a request for every key press
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(0);
      setSearch(searchText.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Invoices & Billing Ledger</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            GST tax invoices, quotations and proformas, with the payment ledger. Issued documents are cancelled with a reason, never deleted.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="search"
              maxLength={100}
              placeholder="Number or customer"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs w-44"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => { setPage(0); setFilterStatus(e.target.value); }}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600"
            aria-label="Filter by payment status"
          >
            <option value="">Any status</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_PAID">Partially paid</option>
            <option value="OVERDUE">Overdue</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          {[
            { id: '', label: 'All Documents' },
            { id: 'TAX_INVOICE', label: 'Tax Invoices' },
            { id: 'QUOTATION', label: 'Quotations' },
            { id: 'PROFORMA', label: 'Proformas' },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => { setPage(0); setFilterType(btn.id); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                filterType === btn.id
                  ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {loading && invoices.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading bills & invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm space-y-2">
            <Receipt className="h-10 w-10 mx-auto text-slate-300" />
            <p>No documents match.</p>
            <p className="text-xs text-slate-400">Convert a lead from the Kanban board to create a quotation or bill.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5">Number</th>
                  <th className="p-3.5">Document Type</th>
                  <th className="p-3.5">Customer / Company</th>
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5 text-right">Grand Total (₹)</th>
                  <th className="p-3.5 text-right">Balance Due (₹)</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const status = paymentStatusMeta(inv.payment_status);
                  const isBill = inv.document_type === 'TAX_INVOICE';
                  return (
                    <tr key={inv._id} className={`hover:bg-slate-50/70 transition-colors ${inv.payment_status === 'CANCELLED' ? 'opacity-60' : ''}`}>
                      <td className="p-3.5 font-bold text-blue-700 whitespace-nowrap">{inv.invoice_number}</td>
                      <td className="p-3.5">
                        <span className="font-semibold text-slate-700">{documentShortLabel(inv.document_type)}</span>
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-900">{inv.customer?.company_name || inv.customer?.name}</div>
                        {inv.customer?.gstin && <span className="text-[10px] text-slate-400">GSTIN: {inv.customer.gstin}</span>}
                      </td>
                      <td className="p-3.5 text-slate-600 whitespace-nowrap">{formatIndianDate(inv.invoice_date)}</td>
                      <td className="p-3.5 text-right font-bold text-slate-900">{money(inv.financials?.grand_total)}</td>
                      <td className="p-3.5 text-right font-bold text-amber-600">{isBill ? money(inv.financials?.balance_due) : '—'}</td>
                      <td className="p-3.5 text-center">
                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${status.className}`}>{status.label}</span>
                      </td>
                      <td className="p-3.5 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => setViewingInvoice(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors cursor-pointer"
                          title="View document, payments and actions"
                        >
                          <Eye className="h-3 w-3" />
                          <span>View</span>
                        </button>

                        {mayRecordPayments && canTakePayment(inv) && (
                          <button
                            onClick={() => setSelectedInvoiceForPayment(inv)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
                          >
                            Record Payment
                          </button>
                        )}

                        <PdfDownloadButton invoiceId={inv._id} invoiceNumber={inv.invoice_number} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{total.toLocaleString('en-IN')} documents · page {page + 1} of {pages}</span>
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
      )}

      {selectedInvoiceForPayment && (
        <RecordPaymentModal
          invoice={selectedInvoiceForPayment}
          onClose={() => setSelectedInvoiceForPayment(null)}
          onRecorded={() => {
            setSelectedInvoiceForPayment(null);
            loadInvoices();
          }}
        />
      )}

      {viewingInvoice && (
        <InvoiceViewModal
          invoice={viewingInvoice}
          currentUser={currentUser}
          onClose={() => setViewingInvoice(null)}
          onRecordPayment={(inv) => setSelectedInvoiceForPayment(inv)}
          onChanged={loadInvoices}
        />
      )}
    </div>
  );
};
