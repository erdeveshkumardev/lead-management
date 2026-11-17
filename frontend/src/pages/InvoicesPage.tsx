import React, { useEffect, useState } from 'react';
import { Invoice, api } from '../services/api';
import { 
  Receipt, 
  Download, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  FileText,
  X
} from 'lucide-react';

interface InvoicesPageProps {
  tenantId?: string;
}

export const InvoicesPage: React.FC<InvoicesPageProps> = ({ tenantId }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<Invoice | null>(null);

  // Payment Form state
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMode, setPayMode] = useState<string>('UPI');
  const [payRef, setPayRef] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);

  const loadInvoices = () => {
    setLoading(true);
    api.getInvoices(tenantId, filterType)
      .then((res) => {
        if (res && res.items) setInvoices(res.items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadInvoices();
  }, [tenantId, filterType]);

  const handleOpenPayment = (inv: Invoice) => {
    setSelectedInvoiceForPayment(inv);
    setPayAmount(inv.financials.balance_due);
    setPayMode('UPI');
    setPayRef('');
  };

  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceForPayment) return;

    setIsRecording(true);
    try {
      await api.recordPayment(selectedInvoiceForPayment._id, {
        amount: Number(payAmount),
        payment_mode: payMode,
        reference_number: payRef,
      });
      setSelectedInvoiceForPayment(null);
      loadInvoices();
    } catch (err) {
      console.error(err);
    } finally {
      setIsRecording(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Fully Paid</span>;
      case 'PARTIALLY_PAID':
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Partially Paid</span>;
      default:
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Unpaid</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Invoices & Billing Ledger</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage GST Tax Invoices, Quotations, and track customer payments.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2">
          {[
            { id: '', label: 'All Documents' },
            { id: 'TAX_INVOICE', label: 'Tax Invoices' },
            { id: 'QUOTATION', label: 'Quotations' },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => setFilterType(btn.id)}
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
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading bills & invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm space-y-2">
            <Receipt className="h-10 w-10 mx-auto text-slate-300" />
            <p>No invoices or quotations generated yet.</p>
            <p className="text-xs text-slate-400">Convert a lead from the Kanban board to create your first bill.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5">Invoice #</th>
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
                {invoices.map((inv) => (
                  <tr key={inv._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-3.5 font-bold text-blue-700">
                      {inv.invoice_number}
                    </td>
                    <td className="p-3.5">
                      <span className="font-semibold text-slate-700">
                        {inv.document_type === 'TAX_INVOICE' ? 'GST Invoice' : 'Quotation'}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="font-semibold text-slate-900">{inv.customer?.company_name || inv.customer?.name}</div>
                      {inv.customer?.gstin && (
                        <span className="text-[10px] text-slate-400">GSTIN: {inv.customer.gstin}</span>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-600">
                      {new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="p-3.5 text-right font-bold text-slate-900">
                      ₹{Number(inv.financials.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-right font-bold text-amber-600">
                      ₹{Number(inv.financials.balance_due).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-center">
                      {getStatusBadge(inv.payment_status)}
                    </td>
                    <td className="p-3.5 text-right space-x-2">
                      {/* Record Payment Button */}
                      {inv.financials.balance_due > 0 && inv.document_type === 'TAX_INVOICE' && (
                        <button
                          onClick={() => handleOpenPayment(inv)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                        >
                          Record Payment
                        </button>
                      )}

                      {/* Download PDF Button */}
                      <a
                        href={api.getInvoicePdfUrl(inv._id, inv.tenant_id || tenantId)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                      >
                        <Download className="h-3 w-3" />
                        <span>PDF</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {selectedInvoiceForPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-base text-slate-900">Record Payment</h3>
              </div>
              <button onClick={() => setSelectedInvoiceForPayment(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <p>Invoice: <span className="font-bold text-slate-800">{selectedInvoiceForPayment.invoice_number}</span></p>
              <p>Customer: <span className="font-semibold text-slate-800">{selectedInvoiceForPayment.customer?.name}</span></p>
              <p>Total Balance Due: <span className="font-bold text-amber-600">₹{selectedInvoiceForPayment.financials.balance_due.toLocaleString('en-IN')}</span></p>
            </div>

            <form onSubmit={handleRecordPaymentSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Amount Paid (₹)</label>
                <input
                  type="number"
                  min="1"
                  max={selectedInvoiceForPayment.financials.balance_due}
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Payment Mode</label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="UPI">UPI (Google Pay / PhonePe / Paytm)</option>
                  <option value="NEFT">NEFT / RTGS / IMPS</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Credit / Debit Card</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Reference Number / UTR</label>
                <input
                  type="text"
                  placeholder="e.g. UTR12938471203"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceForPayment(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRecording || payAmount <= 0}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
                >
                  {isRecording ? 'Saving...' : 'Record Payment Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
