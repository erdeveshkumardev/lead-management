import React from 'react';
import { Invoice, api } from '../services/api';
import { 
  X, 
  Download, 
  Printer, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Building2, 
  User, 
  Phone, 
  Mail, 
  Receipt,
  FileText
} from 'lucide-react';

interface InvoiceViewModalProps {
  invoice: Invoice;
  tenantId?: string;
  onClose: () => void;
  onRecordPayment?: (invoice: Invoice) => void;
}

export const InvoiceViewModal: React.FC<InvoiceViewModalProps> = ({
  invoice,
  tenantId,
  onClose,
  onRecordPayment,
}) => {
  const isInvoice = invoice.document_type === 'TAX_INVOICE';
  const isPaid = invoice.payment_status === 'PAID';
  const isPartial = invoice.payment_status === 'PARTIALLY_PAID';

  const statusBadge = () => {
    if (isPaid) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          <span>PAID</span>
        </span>
      );
    }
    if (isPartial) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300">
          <Clock className="h-3.5 w-3.5 text-amber-600" />
          <span>PARTIALLY PAID</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-300">
        <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
        <span>UNPAID</span>
      </span>
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const pdfUrl = api.getInvoicePdfUrl(invoice._id, invoice.tenant_id || tenantId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Top Action Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  {isInvoice ? 'GST Tax Invoice' : 'Commercial Quotation'}
                </h3>
                {statusBadge()}
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Doc Number: <span className="text-indigo-300 font-bold">{invoice.invoice_number}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-all cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download PDF</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body (Clean Invoice Preview) */}
        <div className="p-6 md:p-8 overflow-y-auto flex-1 space-y-6 text-slate-900 bg-slate-50/50">
          {/* Symmetrical Dual Party Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Supplier / Seller */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                Issued By (Supplier)
              </span>
              <h4 className="font-bold text-sm text-slate-900">{invoice.seller?.company_name || 'LeadCRM Business'}</h4>
              <p className="text-xs text-slate-500">{invoice.seller?.name}</p>
              <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                <p><b>GSTIN:</b> {invoice.seller?.gstin || 'N/A'}</p>
                <p><b>Phone:</b> {invoice.seller?.phone || 'N/A'}</p>
              </div>
            </div>

            {/* Customer / Billed To */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                  Billed To (Customer)
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  Date: <b>{new Date(invoice.invoice_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b>
                </span>
              </div>
              <h4 className="font-bold text-sm text-slate-900">{invoice.customer?.company_name || invoice.customer?.name}</h4>
              <p className="text-xs text-slate-500">Contact: {invoice.customer?.name}</p>
              <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                <p><b>GSTIN:</b> {invoice.customer?.gstin || 'Unregistered Buyer'}</p>
                <p><b>Phone:</b> {invoice.customer?.phone || 'N/A'}</p>
                <p><b>State:</b> {invoice.customer?.state || 'N/A'}</p>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900 text-white font-bold text-xs flex items-center justify-between">
              <span>Itemized Commercial Particulars</span>
              <span className="text-slate-400 font-normal text-[11px]">{invoice.items?.length || 0} line items</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-bold">#</th>
                    <th className="py-2.5 px-4 font-bold">Item Description</th>
                    <th className="py-2.5 px-4 font-bold">HSN/SAC</th>
                    <th className="py-2.5 px-4 font-bold text-right">Qty</th>
                    <th className="py-2.5 px-4 font-bold text-right">Unit Rate</th>
                    <th className="py-2.5 px-4 font-bold text-right">Taxable</th>
                    <th className="py-2.5 px-4 font-bold text-center">GST %</th>
                    <th className="py-2.5 px-4 font-bold text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.items?.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">{idx + 1}</td>
                      <td className="py-3 px-4 font-bold text-slate-900">{item.name}</td>
                      <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{item.hsn_sac_code || '-'}</td>
                      <td className="py-3 px-4 text-right font-medium text-slate-700">{item.quantity} {item.unit}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700">₹{item.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">₹{item.taxable_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px]">
                          {item.gst_rate}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-indigo-950">₹{item.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Split: Terms & Payment Ledger on Left, Financials Summary on Right */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Left: Terms & Payment Records */}
            <div className="space-y-4">
              {/* Payment History Card */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 text-emerald-600" />
                    <span>Payment Records & Receipts</span>
                  </h4>
                  <span className="text-[10px] font-bold text-slate-500">
                    {invoice.payments?.length || 0} Transactions
                  </span>
                </div>

                {(!invoice.payments || invoice.payments.length === 0) ? (
                  <p className="text-xs text-slate-400 italic py-2">No payment transactions recorded yet.</p>
                ) : (
                  <div className="space-y-2 pt-1">
                    {invoice.payments.map((p: any, pIdx: number) => (
                      <div key={pIdx} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">₹{p.amount?.toLocaleString('en-IN')}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {p.payment_mode || 'Payment'}
                            </span>
                          </div>
                          {p.reference_number && (
                            <span className="text-[10px] font-mono text-slate-400">Ref: {p.reference_number}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-IN') : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Terms and conditions */}
              {invoice.terms_and_conditions && (
                <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs text-xs space-y-1">
                  <h5 className="font-bold text-slate-700 text-[11px]">Terms & Conditions:</h5>
                  <p className="text-slate-500 whitespace-pre-line text-[11px] leading-relaxed">
                    {invoice.terms_and_conditions}
                  </p>
                </div>
              )}
            </div>

            {/* Right: Totals Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
              <h4 className="font-bold text-xs text-slate-900 border-b border-slate-100 pb-2">
                Financial Summary & Tax Ledger
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Taxable Subtotal:</span>
                  <span className="font-mono font-bold text-slate-800">
                    ₹{invoice.financials?.taxable_subtotal?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {invoice.financials?.total_cgst > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Central GST (CGST):</span>
                    <span className="font-mono text-slate-800">
                      ₹{invoice.financials.total_cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                {invoice.financials?.total_sgst > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>State GST (SGST):</span>
                    <span className="font-mono text-slate-800">
                      ₹{invoice.financials.total_sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                {invoice.financials?.total_igst > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Integrated GST (IGST):</span>
                    <span className="font-mono text-slate-800">
                      ₹{invoice.financials.total_igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-sm font-black text-indigo-950 pt-2 border-t-2 border-slate-900">
                  <span>Grand Total (INR):</span>
                  <span className="font-mono text-base text-indigo-700">
                    ₹{invoice.financials?.grand_total?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex justify-between text-xs text-slate-600 pt-1">
                  <span>Total Paid:</span>
                  <span className="font-mono font-bold text-emerald-700">
                    ₹{invoice.financials?.paid_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex justify-between text-xs font-bold pt-1 border-t border-slate-100">
                  <span className={invoice.financials?.balance_due > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                    Balance Due:
                  </span>
                  <span className={`font-mono text-sm ${invoice.financials?.balance_due > 0 ? 'text-rose-700 font-black' : 'text-emerald-700'}`}>
                    ₹{invoice.financials?.balance_due?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer with Actions */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {/* Record Payment Button */}
            {invoice.financials?.balance_due > 0 && onRecordPayment && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRecordPayment(invoice);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                <CreditCard className="h-4 w-4" />
                <span>Record Payment / Mark as Paid</span>
              </button>
            )}

            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition-all cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>Download PDF</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
